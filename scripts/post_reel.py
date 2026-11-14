#!/usr/bin/env python3
"""Post the morning reels (MP4) to Instagram as Reels, through upload-post.com (UPLOAD_POST_API_KEY /
UPLOAD_POST_USER — the account connected once in the upload-post.com dashboard under "Manage Users").
Does nothing without those secrets: the e-mail (send_reel.py) still goes out either way.

    python scripts/post_reel.py out/reel/*.mp4
"""
import os
import sys

import requests

API = 'https://api.upload-post.com/api/upload'
CAP = {'jour': 'Le marché français de l’électricité ce matin ⚡ Spot, prévision de demain, Europe, nucléaire, météo, Cal, CO₂ et la news du jour. #électricité #énergie',
       'semaine': 'La semaine sur le marché français de l’électricité 📊 Spot, Cal, courbe à terme, PPA, nucléaire, conso, spark et batterie. #électricité #énergie',
       'mois': 'Le mois sur le marché français de l’électricité 🗓️ Spot, M0 solaire et éolien, Cal, PPA, stocks de gaz et batterie. #électricité #énergie',
       'batterie': 'Une batterie de 1 MW aujourd’hui : elle achète au creux, revend au pic 🔋 Combien elle gagne. #électricité #énergie',
       'europe': 'Où l’électricité est-elle la moins chère aujourd’hui en Europe ? 🇪🇺 #électricité #énergie',
       'mix': 'Hier heure par heure : comment la production fait le prix ☀️💨⚛️ #électricité #énergie'}


def main():
    key, user = os.environ.get('UPLOAD_POST_API_KEY'), os.environ.get('UPLOAD_POST_USER')
    if not key or not user:
        print('no UPLOAD_POST_* secrets: reel not posted')
        return 0
    paths = sorted(sys.argv[1:])
    if not paths:
        print('no reel to post')
        return 0
    failed = False
    for path in paths:
        kind = os.path.basename(path)[16:].rsplit('-', 1)[0]
        with open(path, 'rb') as f:
            r = requests.post(API, headers={'Authorization': f'Apikey {key}'},
                               files={'video': f},
                               data={'title': CAP.get(kind, ''), 'user': user, 'platform[]': 'instagram'},
                               timeout=300)
        if r.ok:
            print(os.path.basename(path), 'posted:', r.json())
        else:
            failed = True
            print(os.path.basename(path), 'FAILED:', r.status_code, r.text[:300])
    return 1 if failed else 0


if __name__ == '__main__':
    sys.exit(main())
