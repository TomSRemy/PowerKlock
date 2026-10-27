#!/usr/bin/env python3
"""Record the morning reel (reel.html) to a vertical MP4, 1080 x 1920, for Instagram.

Serves the repository on a local port, opens reel.html?once in Chromium at 1080 x 1920, waits for the last scene,
then converts Playwright's WebM to H.264 MP4 with ffmpeg (the one on the runner, or imageio-ffmpeg's).

    python scripts/record_reel.py                    # today (Paris), French, every reel → out/reel/reel-YYYY-MM-DD-<reel>-fr.mp4
    python scripts/record_reel.py --reel batterie --lang en --date 2026-10-27
"""
import argparse
import functools
import http.server
import os
import shutil
import subprocess
import sys
import threading
from datetime import datetime
from zoneinfo import ZoneInfo

REELS = ('jour', 'batterie', 'europe', 'mix')    # reel.html?r=…
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'out', 'reel')


def ffmpeg():
    exe = shutil.which('ffmpeg')
    if exe:
        return exe
    import imageio_ffmpeg                          # pip install imageio-ffmpeg where no ffmpeg is installed
    return imageio_ffmpeg.get_ffmpeg_exe()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--date', default=datetime.now(ZoneInfo('Europe/Paris')).strftime('%Y-%m-%d'))
    ap.add_argument('--lang', default='fr', choices=('fr', 'en'))
    ap.add_argument('--reel', choices=REELS, help='one reel (default: all)')
    a = ap.parse_args()
    from playwright.sync_api import sync_playwright

    class Quiet(http.server.SimpleHTTPRequestHandler):
        def log_message(self, *args):
            pass
    handler = functools.partial(Quiet, directory=ROOT)
    srv = http.server.ThreadingHTTPServer(('127.0.0.1', 0), handler)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    os.makedirs(OUT, exist_ok=True)
    tmp = os.path.join(OUT, 'tmp')
    done = []
    with sync_playwright() as pw:
        b = pw.chromium.launch()
        for reel in ([a.reel] if a.reel else REELS):
            shutil.rmtree(tmp, ignore_errors=True)
            url = f'http://127.0.0.1:{srv.server_port}/reel.html?once&r={reel}&d={a.date}' + ('#en' if a.lang == 'en' else '')
            ctx = b.new_context(viewport={'width': 1080, 'height': 1920}, record_video_dir=tmp, record_video_size={'width': 1080, 'height': 1920})
            p = ctx.new_page()
            p.goto(url)
            p.wait_for_function('window.REEL_MS', timeout=30000)
            scenes, ms = p.evaluate('[window.REEL_SCENES, window.REEL_MS]')
            p.wait_for_function('window.REEL_DONE === true', timeout=ms + 20000)
            p.wait_for_timeout(600)
            video = p.video.path()
            ctx.close()
            if scenes < 2:                     # a reel without its data shows one "not published yet" card: not sent
                print(f'{reel}: no data, skipped')
                continue
            out = os.path.join(OUT, f'reel-{a.date}-{reel}-{a.lang}.mp4')
            # the first second is the page loading its data and fonts: cut it, and keep the reel at the length of its scenes
            subprocess.run([ffmpeg(), '-y', '-loglevel', 'error', '-ss', '1.0', '-i', video, '-t', f'{ms / 1000 + 0.4:.1f}',
                            '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'medium', '-crf', '20', '-r', '30', '-movflags', '+faststart', out], check=True)
            done.append(out)
            print(f'{out}: {scenes} scenes, {ms / 1000:.1f} s, {os.path.getsize(out) / 1e6:.1f} MB')
        b.close()
    srv.shutdown()
    shutil.rmtree(tmp, ignore_errors=True)
    return 0 if done else 1


if __name__ == '__main__':
    sys.exit(main())
