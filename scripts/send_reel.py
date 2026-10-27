#!/usr/bin/env python3
"""Send the morning reel MP4 by e-mail, ready to post on Instagram from a phone.

Through the Gmail account already used for the GO prices and the failure alerts (GO_GMAIL_USER /
GO_GMAIL_APP_PASSWORD), to itself, or to REEL_TO when that secret is set (comma-separated).
Does nothing without those secrets.

    python scripts/send_reel.py out/reel/reel-2026-10-27-fr.mp4
"""
import os
import smtplib
import sys
from email.message import EmailMessage


def main():
    user, pwd = os.environ.get('GO_GMAIL_USER'), os.environ.get('GO_GMAIL_APP_PASSWORD')
    if not user or not pwd:
        print('no GO_GMAIL_* secrets: reel not sent')
        return 0
    path = sys.argv[1]
    day = os.path.basename(path)[5:15]
    m = EmailMessage()
    m['Subject'] = f'PowerKlock · réel du {day}'
    m['From'] = user
    m['To'] = os.environ.get('REEL_TO') or user
    m.set_content(f'Le réel du matin ({day}), 1080 × 1920, prêt à publier sur Instagram.\n\n'
                  'Légende proposée : Le marché de l’électricité ce matin en France ⚡ Prix spot, profil de la journée, '
                  'marché à terme et brief. #électricité #énergie #marchés\n\n— PowerKlock')
    with open(path, 'rb') as f:
        m.add_attachment(f.read(), maintype='video', subtype='mp4', filename=os.path.basename(path))
    with smtplib.SMTP_SSL('smtp.gmail.com', 465, timeout=60) as s:
        s.login(user, pwd)
        s.send_message(m)
    print('reel sent to', m['To'])
    return 0


if __name__ == '__main__':
    sys.exit(main())
