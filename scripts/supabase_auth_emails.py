#!/usr/bin/env python3
"""The account e-mails, set in Supabase by a script (Actions › Account e-mails › Run workflow): the mail server
(the newsletter's, from the SMTP_* secrets), the two PowerKlock e-mails of config/auth_emails/ (confirm the address,
choose a new password), their subjects, and the addresses the links may lead back to. Nothing is copied by hand.

Env  SUPABASE_ACCESS_TOKEN (a personal access token, supabase.com › Account › Access tokens), SMTP_HOST, SMTP_PORT,
     SMTP_USER, SMTP_PASS; optional ALERT_FROM (the sender address, else SMTP_USER)
"""
import json
import os
import sys
import urllib.error
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REF = 'xtqeslyjtjrbjpffpixn'
API = f'https://api.supabase.com/v1/projects/{REF}/config/auth'
SITES = ['https://powerklock.com/**', 'https://www.powerklock.com/**']


def call(method, body=None):
    req = urllib.request.Request(API, method=method, data=json.dumps(body).encode() if body is not None else None,
                                 headers={'Authorization': 'Bearer ' + os.environ['SUPABASE_ACCESS_TOKEN'],
                                          'Content-Type': 'application/json', 'User-Agent': 'powerklock-auth-config'})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return json.loads(r.read() or b'{}')
    except urllib.error.HTTPError as e:   # say why: a token without « Auth Config › Read & Write » gets 403 on the write
        print(f'::error::Supabase answered {e.code} to {method}: {e.read().decode(errors="replace")[:400]}')
        raise SystemExit(1)


def main():
    if not os.environ.get('SUPABASE_ACCESS_TOKEN'):
        print('::warning::Not set yet: add the SUPABASE_ACCESS_TOKEN secret (supabase.com › Account › Access tokens), then run again.')
        return 0
    if not all(os.environ.get(k) for k in ('SMTP_HOST', 'SMTP_USER', 'SMTP_PASS')):
        print('::error::The SMTP secrets are missing: the account e-mails need the same server as the newsletter.')
        return 1
    cur = call('GET')
    allow = [u for u in (cur.get('uri_allow_list') or '').split(',') if u.strip()]
    tpl = lambda n: open(os.path.join(ROOT, 'config', 'auth_emails', n), encoding='utf-8').read()  # noqa: E731
    patch = {
        'site_url': 'https://powerklock.com',
        'uri_allow_list': ','.join(dict.fromkeys(allow + SITES)),
        'smtp_host': os.environ['SMTP_HOST'], 'smtp_port': str(os.environ.get('SMTP_PORT') or 587),
        'smtp_user': os.environ['SMTP_USER'], 'smtp_pass': os.environ['SMTP_PASS'],
        'smtp_admin_email': os.environ.get('ALERT_FROM') or os.environ['SMTP_USER'], 'smtp_sender_name': 'PowerKlock',
        'mailer_subjects_confirmation': 'Confirmez votre adresse PowerKlock',
        'mailer_templates_confirmation_content': tpl('confirm_signup.html'),
        'mailer_subjects_recovery': 'Votre nouveau mot de passe PowerKlock',
        'mailer_templates_recovery_content': tpl('reset_password.html'),
    }
    call('PATCH', patch)
    after = call('GET')
    # Supabase does not give the mail server's settings back to every token: each field is checked when it comes back
    shown = {k: after.get(k) for k in patch if k != 'smtp_pass' and after.get(k) is not None}
    wrong = sorted(k for k, v in shown.items() if v != patch[k])
    hidden = sorted(k for k in patch if k != 'smtp_pass' and k not in shown)
    ok = not wrong and 'mailer_templates_confirmation_content' in shown
    print(f"account e-mails {'set' if ok else 'NOT set'}: {len(shown) - len(wrong)} settings checked"
          + (f", different: {', '.join(wrong)}" if wrong else '') + (f", not shown back by Supabase: {', '.join(hidden)}" if hidden else ''))
    return 0 if ok else 1


if __name__ == '__main__':
    sys.exit(main())
