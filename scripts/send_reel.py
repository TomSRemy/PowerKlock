#!/usr/bin/env python3
"""Send the morning reels (MP4) by e-mail, ready to post on Instagram from a phone.

Through the Gmail account already used for the GO prices and the failure alerts (GO_GMAIL_USER /
GO_GMAIL_APP_PASSWORD), to itself, or to REEL_TO when that secret is set (comma-separated).
Does nothing without those secrets.

    python scripts/send_reel.py out/reel/*.mp4
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
    paths = sorted(sys.argv[1:])
    if not paths:
        print('no reel to send')
        return 0
    day = os.path.basename(paths[0])[5:15]
    m = EmailMessage()
    m['Subject'] = f'PowerKlock · réels du {day}'
    m['From'] = user
    m['To'] = os.environ.get('REEL_TO') or user
    CAP = {'jour': 'Le marché de l’électricité ce matin en France ⚡ Prix spot, profil de la journée, marché à terme et brief.',
           'batterie': 'Une batterie de 1 MW aujourd’hui : elle achète au creux, revend au pic 🔋 Combien elle gagne.',
           'europe': 'Où l’électricité est-elle la moins chère aujourd’hui en Europe ? 🇪🇺',
           'mix': 'Hier heure par heure : comment la production fait le prix ☀️💨⚛️'}
    lines = [f'Les réels du matin ({day}), 1080 × 1920, prêts à publier sur Instagram.', '']
    for path in paths:
        kind = os.path.basename(path)[16:].rsplit('-', 1)[0]
        lines.append(f'· {os.path.basename(path)} — légende proposée : {CAP.get(kind, "")} #électricité #énergie')
    # the text first: once a file is attached the message is multipart and set_content refuses it
    m.set_content('\n'.join(lines + ['', '— PowerKlock']))
    for path in paths:
        with open(path, 'rb') as f:
            m.add_attachment(f.read(), maintype='video', subtype='mp4', filename=os.path.basename(path))
    with smtplib.SMTP_SSL('smtp.gmail.com', 465, timeout=60) as s:
        s.login(user, pwd)
        s.send_message(m)
    print(len(paths), 'reels sent to', m['To'])
    return 0


if __name__ == '__main__':
    sys.exit(main())
