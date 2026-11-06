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
    CAP = {'jour': 'Le marché français de l’électricité ce matin ⚡ Spot, prévision de demain, Europe, nucléaire, météo, Cal, CO₂ et la news du jour.',
           'semaine': 'La semaine sur le marché français de l’électricité 📊 Spot, Cal, courbe à terme, PPA, nucléaire, conso, spark et batterie.',
           'mois': 'Le mois sur le marché français de l’électricité 🗓️ Spot, M0 solaire et éolien, Cal, PPA, stocks de gaz et batterie.',
           'batterie': 'Une batterie de 1 MW aujourd’hui : elle achète au creux, revend au pic 🔋 Combien elle gagne.',
           'europe': 'Où l’électricité est-elle la moins chère aujourd’hui en Europe ? 🇪🇺',
           'mix': 'Hier heure par heure : comment la production fait le prix ☀️💨⚛️'}
    NAME = {'jour': 'réel du jour', 'semaine': 'réel de la semaine', 'mois': 'réel du mois'}
    # one mail per reel: a long video stays under Gmail's 25 MB per message
    with smtplib.SMTP_SSL('smtp.gmail.com', 465, timeout=60) as s:
        s.login(user, pwd)
        for path in paths:
            kind = os.path.basename(path)[16:].rsplit('-', 1)[0]
            m = EmailMessage()
            m['Subject'] = f'PowerKlock · {NAME.get(kind, "réel " + kind)} · {day}'
            m['From'] = user
            m['To'] = os.environ.get('REEL_TO') or user
            # the text first: once a file is attached the message is multipart and set_content refuses it
            m.set_content('\n'.join([f'{NAME.get(kind, "Réel").capitalize()} du {day}, 1080 × 1920, prêt à publier sur Instagram.', '',
                                     f'Légende proposée : {CAP.get(kind, "")} #électricité #énergie', '', '— PowerKlock']))
            with open(path, 'rb') as f:
                m.add_attachment(f.read(), maintype='video', subtype='mp4', filename=os.path.basename(path))
            s.send_message(m)
    print(len(paths), 'reels sent to', os.environ.get('REEL_TO') or user)
    return 0


if __name__ == '__main__':
    sys.exit(main())
