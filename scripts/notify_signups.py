#!/usr/bin/env python3
"""E-mail the admins (public.news_admin) once about each new account waiting for approval (public.user_access)."""
import os
import smtplib
import sys
from email.message import EmailMessage

import psycopg

SITE = 'https://powerklock.com'


def main():
    db = os.environ.get('SUPABASE_DB_URL')
    if not db:
        print('No database URL: sign-up notices skipped.')
        return 0
    with psycopg.connect(db, prepare_threshold=None) as conn, conn.cursor() as cur:
        cur.execute("select to_regclass('public.user_access') is not null")
        if not cur.fetchone()[0]:
            print('public.user_access does not exist yet (run the warehouse sync once).')
            return 0
        cur.execute("select user_id, email, requested_at from public.user_access where status = 'pending' and notified_at is null order by requested_at")
        pending = cur.fetchall()
        cur.execute('select email from public.news_admin')
        admins = [r[0] for r in cur.fetchall()]
        print(f'{len(pending)} new account(s) waiting for approval')
        if not pending or not admins:
            return 0
        if not all(os.environ.get(k) for k in ('SMTP_HOST', 'SMTP_USER', 'SMTP_PASS')):
            print('SMTP not configured: notice not sent.')
            return 0
        lines = [f'• {email} (since {at:%d/%m %H:%M} UTC)' for _, email, at in pending]
        approve = '\n'.join(f"update public.user_access set status = 'approved', decided_at = now() where email = '{email}';" for _, email, _ in pending)
        msg = EmailMessage()
        msg['Subject'] = f'PowerKlock: {len(pending)} account(s) to approve'
        msg['From'] = os.environ.get('ALERT_FROM') or os.environ['SMTP_USER']
        msg['To'] = ', '.join(admins)
        msg.set_content('New accounts waiting for approval:\n' + '\n'.join(lines) +
                        '\n\nTo approve, in Supabase › SQL editor (or ask Claude):\n' + approve + f'\n\n{SITE}\n')
        with smtplib.SMTP(os.environ['SMTP_HOST'], int(os.environ.get('SMTP_PORT') or 587), timeout=60) as s:
            s.starttls()
            s.login(os.environ['SMTP_USER'], os.environ['SMTP_PASS'])
            s.send_message(msg)
        cur.execute('update public.user_access set notified_at = now() where user_id = any(%s)', ([u for u, _, _ in pending],))
        conn.commit()
        print('notice sent')
    return 0


if __name__ == '__main__':
    sys.exit(main())
