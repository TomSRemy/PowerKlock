#!/usr/bin/env python3
"""Post the morning reels (MP4) to Instagram as Reels, free, through Meta's own Graph API (Instagram Login) —
no paid middleman. Needs META_ACCESS_TOKEN (a long-lived Instagram user token, see scripts/refresh_meta_token.py)
and META_IG_USER_ID (the Instagram Business account's numeric ID), both as secrets. Does nothing without them:
the e-mail (send_reel.py) still goes out either way.

Meta's publish endpoint needs the video at a public HTTPS URL — it cannot take the file's bytes directly — so
the workflow step just before this one pushes out/reel/*.mp4 to the reel-public branch (force-pushed, one
file per reel kind, never accumulating: see .github/workflows/reel.yml) and this script reads it back from
https://raw.githubusercontent.com/<repo>/reel-public/<kind>.mp4.

    python scripts/post_reel.py out/reel/*.mp4
"""
import os
import sys
import time

import requests

API = 'https://graph.instagram.com/v23.0'
CAP = {'jour': 'Le marché français de l’électricité ce matin ⚡ Spot, prévision de demain, Europe, nucléaire, météo, Cal, CO₂ et la news du jour. #électricité #énergie',
       'semaine': 'La semaine sur le marché français de l’électricité 📊 Spot, Cal, courbe à terme, PPA, nucléaire, conso, spark et batterie. #électricité #énergie',
       'mois': 'Le mois sur le marché français de l’électricité 🗓️ Spot, M0 solaire et éolien, Cal, PPA, stocks de gaz et batterie. #électricité #énergie',
       'batterie': 'Une batterie de 1 MW aujourd’hui : elle achète au creux, revend au pic 🔋 Combien elle gagne. #électricité #énergie',
       'europe': 'Où l’électricité est-elle la moins chère aujourd’hui en Europe ? 🇪🇺 #électricité #énergie',
       'mix': 'Hier heure par heure : comment la production fait le prix ☀️💨⚛️ #électricité #énergie'}
POLL_EVERY, POLL_FOR = 10, 180   # seconds: Meta processes the video asynchronously before it can be published


def post_one(kind, token, ig_user):
    repo = os.environ['GITHUB_REPOSITORY']   # set by GitHub Actions
    video_url = f'https://raw.githubusercontent.com/{repo}/reel-public/{kind}.mp4'
    r = requests.post(f'{API}/{ig_user}/media', timeout=60,
                       data={'media_type': 'REELS', 'video_url': video_url, 'caption': CAP.get(kind, ''), 'access_token': token})
    r.raise_for_status()
    container = r.json()['id']
    t0 = time.time()
    while time.time() - t0 < POLL_FOR:
        time.sleep(POLL_EVERY)
        s = requests.get(f'{API}/{container}', params={'fields': 'status_code', 'access_token': token}, timeout=30).json()
        status = s.get('status_code')
        if status == 'FINISHED':
            break
        if status == 'ERROR':
            raise RuntimeError(f'Meta failed to process the video: {s}')
    else:
        raise RuntimeError(f'still not FINISHED after {POLL_FOR}s: {status}')
    r = requests.post(f'{API}/{ig_user}/media_publish', timeout=60, data={'creation_id': container, 'access_token': token})
    r.raise_for_status()
    return r.json()


def main():
    token, ig_user = os.environ.get('META_ACCESS_TOKEN'), os.environ.get('META_IG_USER_ID')
    if not token or not ig_user:
        print('no META_* secrets: reel not posted')
        return 0
    paths = sorted(sys.argv[1:])
    if not paths:
        print('no reel to post')
        return 0
    failed = False
    for path in paths:
        kind = os.path.basename(path)[16:].rsplit('-', 1)[0]
        try:
            print(os.path.basename(path), 'posted:', post_one(kind, token, ig_user))
        except Exception as e:
            failed = True
            print(os.path.basename(path), 'FAILED:', str(e)[:300])
    return 1 if failed else 0


if __name__ == '__main__':
    sys.exit(main())
