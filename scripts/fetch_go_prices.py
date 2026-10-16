"""
fetch_go_prices.py — Parse les mails Commerg Market Week et appende dans go_prices.csv
Usage : python fetch_go_prices.py

Auth : IMAP + mot de passe d'application Gmail (pas OAuth). Nécessite la
validation en 2 étapes activée sur le compte, puis un mot de passe généré sur
https://myaccount.google.com/apppasswords — ce mot de passe ne expire pas tant
qu'il n'est pas révoqué, pas de refresh token/credentials.json à gérer.
"""
import os
import re
import csv
import imaplib
import email as email_lib
from email.utils import parsedate_to_datetime
from datetime import date
from pathlib import Path

# ── Config ────────────────────────────────────────────────────────────────────
IMAP_HOST       = "imap.gmail.com"
SENDER_FILTER   = "trading@commerg.com"
SUBJECT_FILTER  = "Commerg Market Week"
OUTPUT_CSV      = Path("data/go_prices.csv")
GMAIL_USER_ENV  = "GO_GMAIL_USER"
GMAIL_PASS_ENV  = "GO_GMAIL_APP_PASSWORD"

CSV_HEADERS = [
    "parsed_date", "mail_date", "week_num", "source",
    "product", "year", "bid", "ask", "delta", "term",
]

# ── Auth ──────────────────────────────────────────────────────────────────────
def get_imap():
    user = os.environ.get(GMAIL_USER_ENV)
    app_password = os.environ.get(GMAIL_PASS_ENV)
    if not user or not app_password:
        raise RuntimeError(
            f"Missing {GMAIL_USER_ENV} / {GMAIL_PASS_ENV} env vars — "
            "set them as repo secrets (an IMAP app password, not the account password)."
        )
    imap = imaplib.IMAP4_SSL(IMAP_HOST)
    imap.login(user, app_password)
    imap.select("INBOX")
    return imap


# ── Mail fetching ─────────────────────────────────────────────────────────────
def get_commerg_emails(imap, max_results=10):
    status, data = imap.search(
        None, f'(FROM "{SENDER_FILTER}" SUBJECT "{SUBJECT_FILTER}")'
    )
    if status != "OK" or not data or not data[0]:
        return []
    # IMAP SEARCH returns ids oldest→newest; keep the most recent N.
    return data[0].split()[-max_results:]


def get_email_body(imap, msg_id):
    status, data = imap.fetch(msg_id, "(RFC822)")
    if status != "OK" or not data or not data[0]:
        return date.today(), ""
    msg = email_lib.message_from_bytes(data[0][1])

    mail_date_str = msg.get("Date", "")
    try:
        mail_date = parsedate_to_datetime(mail_date_str).date()
    except Exception:
        mail_date = date.today()

    # Extract text/plain body (skip attachments)
    body = ""
    if msg.is_multipart():
        for part in msg.walk():
            if part.get_content_type() == "text/plain" and not part.get_filename():
                charset = part.get_content_charset() or "utf-8"
                payload = part.get_payload(decode=True)
                if payload:
                    body = payload.decode(charset, errors="replace")
                    break
    else:
        charset = msg.get_content_charset() or "utf-8"
        payload = msg.get_payload(decode=True)
        if payload:
            body = payload.decode(charset, errors="replace")

    return mail_date, body


# ── Parsing ───────────────────────────────────────────────────────────────────
def parse_week_number(subject_or_body):
    """Extract week number from subject like 'Commerg Market Week #2'"""
    m = re.search(r"Week\s*#?(\d+)", subject_or_body, re.IGNORECASE)
    return int(m.group(1)) if m else None


ROW_RE = re.compile(
    r"^(20\d{2})\s+([\d.,]+)\s+([\d.,]+)\s+([+-]?[\d.,]+)$"
)


def parse_go_block(block_text, product_name):
    """
    Parse a GO price block — each product/year is one line:
    2025         1.7500 1.8000 +0.0650
    2026         1.8300 1.8600 +0.1350
    ...
    Returns list of dicts with year/bid/ask/delta
    """
    rows = []
    lines = [l.strip() for l in block_text.strip().splitlines() if l.strip()]

    for line in lines:
        m = ROW_RE.match(line)
        if not m:
            continue
        year_s, bid_s, ask_s, delta_s = m.groups()
        try:
            rows.append({
                "product": product_name,
                "year": int(year_s),
                "bid": float(bid_s.replace(",", ".")),
                "ask": float(ask_s.replace(",", ".")),
                "delta": float(delta_s.replace(",", ".")),
                "term": None,  # calculé après
            })
        except ValueError:
            continue
    return rows


def parse_email_body(body):
    """Main parser — returns list of price rows."""
    rows = []

    # Extract week number from header line
    week_num = parse_week_number(body)

    # Block patterns — find each product section
    block_patterns = [
        (r"GO AIB Hydro/Wind/Solar.*?(?=GO AIB|\Z)", "GO AIB HWS"),
        (r"GO AIB Renewable.*?(?=GO AIB|\Z)",         "GO AIB Renewable"),
        (r"GO AIB Wind.*?(?=GO AIB|\Z)",              "GO AIB Wind"),
        (r"GO AIB Solar.*?(?=GO AIB|\Z)",             "GO AIB Solar"),
    ]

    for pattern, product_name in block_patterns:
        match = re.search(pattern, body, re.DOTALL | re.IGNORECASE)
        if not match:
            continue
        block = match.group(0)

        # Skip header lines (PRODUCT, BID, ASK, + / -)
        block_clean = re.sub(
            r"GO AIB[^\n]*\n|PRODUCT[^\n]*\n|BID\n|ASK\n|\+\s*/\s*-\n",
            "", block
        )
        parsed = parse_go_block(block_clean, product_name)
        if parsed:
            rows.extend(parsed)
            # Once we found HWS rows, skip Renewable if it's a subset
            # (Commerg notes Renewable includes HWS — keep both for completeness)

    return week_num, rows


# ── CSV management ────────────────────────────────────────────────────────────
def load_existing(csv_path):
    """Return set of (mail_date, product, year) already in CSV."""
    existing = set()
    if not csv_path.exists():
        return existing
    with open(csv_path, newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            existing.add((row["mail_date"], row["product"], row["year"]))
    return existing


def append_rows(csv_path, rows):
    csv_path.parent.mkdir(parents=True, exist_ok=True)
    write_header = not csv_path.exists()
    with open(csv_path, "a", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=CSV_HEADERS)
        if write_header:
            writer.writeheader()
        writer.writerows(rows)
    print(f"  → {len(rows)} ligne(s) ajoutée(s) dans {csv_path}")


# ── Main ──────────────────────────────────────────────────────────────────────
def main():
    print("=== fetch_go_prices.py ===")
    imap     = get_imap()
    existing = load_existing(OUTPUT_CSV)
    messages = get_commerg_emails(imap, max_results=20)

    if not messages:
        print("Aucun mail Commerg trouvé.")
        imap.logout()
        return

    print(f"{len(messages)} mail(s) trouvé(s).")
    new_rows = []

    for msg_id in messages:
        mail_date, body = get_email_body(imap, msg_id)
        week_num, parsed = parse_email_body(body)

        if not parsed:
            print(f"  [{mail_date}] Aucune donnée parsée — format inattendu ?")
            continue

        print(f"  [{mail_date}] Semaine #{week_num} — {len(parsed)} produit(s)/année(s)")

        for r in parsed:
            key = (str(mail_date), r["product"], str(r["year"]))
            if key in existing:
                continue  # déjà en base
            new_rows.append({
                "parsed_date": date.today().isoformat(),
                "mail_date":   str(mail_date),
                "week_num":    week_num,
                "source":      "Commerg",
                "product":     r["product"],
                "year":        r["year"],
                "bid":         r["bid"],
                "ask":         r["ask"],
                "delta":       r["delta"],
                "term":        f"Y + {r['year'] - mail_date.year}",
            })
            existing.add(key)

    if new_rows:
        append_rows(OUTPUT_CSV, new_rows)
    else:
        print("Aucune nouvelle ligne à ajouter.")

    imap.logout()
    print("Done.")


if __name__ == "__main__":
    main()
