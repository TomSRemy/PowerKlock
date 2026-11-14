#!/usr/bin/env python3
"""Refresh the Instagram long-lived access token before it expires (Meta: valid 60 days, refreshable once it
is at least 24 h old). Run every ~45 days (.github/workflows/refresh_meta_token.yml).

The refreshed token is NOT written back to the GitHub secret automatically — GITHUB_TOKEN cannot write repo
secrets, only a personal access token could, and that is one more credential to hold for little gain here.
Instead this mails the new token (through the same Gmail used for the GO prices and failure alerts) so the
secret META_ACCESS_TOKEN can be updated by hand in Settings › Secrets. Does nothing without the secrets.

    python scripts/refresh_meta_token.py
"""
import os
import smtplib
import sys
from email.message import EmailMessage

import requests


def main():
    token = os.environ.get('META_ACCESS_TOKEN')
    gmail_user, gmail_pwd = os.environ.get('GO_GMAIL_USER'), os.environ.get('GO_GMAIL_APP_PASSWORD')
    if not token or not gmail_user or not gmail_pwd:
        print('no META_ACCESS_TOKEN or GO_GMAIL_* secrets: nothing to refresh')
        return 0
    r = requests.get('https://graph.instagram.com/refresh_access_token',
                      params={'grant_type': 'ig_refresh_token', 'access_token': token}, timeout=30)
    r.raise_for_status()
    new_token = r.json()['access_token']
    m = EmailMessage()
    m['Subject'] = 'PowerKlock · nouveau jeton Instagram (à mettre dans META_ACCESS_TOKEN)'
    m['From'] = m['To'] = gmail_user
    m.set_content('\n'.join([
        'Jeton Instagram renouvelé (valable encore ~60 jours) :', '', new_token, '',
        'À coller dans Settings › Secrets and variables › Actions › META_ACCESS_TOKEN, en remplacement de l’ancien.',
        '— PowerKlock']))
    with smtplib.SMTP_SSL('smtp.gmail.com', 465, timeout=60) as s:
        s.login(gmail_user, gmail_pwd)
        s.send_message(m)
    print('new token e-mailed to', gmail_user)
    return 0


if __name__ == '__main__':
    sys.exit(main())
