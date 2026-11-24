#!/usr/bin/env python3
"""The site's key pair for alert notifications (Web Push, VAPID), made once (Actions › Push keys › Run workflow): the
private key goes straight into the database's vault (vault.secrets, name pk_vapid_private), the public key into
public.push_config (the phone app reads it to subscribe). Nothing is printed but the public key. Run again with
--rotate to replace them (every device then has to turn notifications on again).

Env  SUPABASE_DB_URL
"""
import base64
import os
import sys

import psycopg
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec


def b64(b):
    return base64.urlsafe_b64encode(b).rstrip(b'=').decode()


def main():
    db = os.environ.get('SUPABASE_DB_URL')
    if not db:
        print('::error::SUPABASE_DB_URL is missing.')
        return 1
    rotate = '--rotate' in sys.argv
    with psycopg.connect(db, prepare_threshold=None) as conn, conn.cursor() as cur:
        cur.execute("select v from public.push_config where k = 'vapid_public'")
        row = cur.fetchone()
        if row and not rotate:
            print('keys already made; public key:', row[0])
            return 0
        key = ec.generate_private_key(ec.SECP256R1())
        priv = b64(key.private_numbers().private_value.to_bytes(32, 'big'))
        pub = b64(key.public_key().public_bytes(serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint))
        cur.execute("select id from vault.secrets where name = 'pk_vapid_private'")
        old = cur.fetchone()
        if old:
            cur.execute('select vault.update_secret(%s, %s)', (old[0], priv))
        else:
            cur.execute("select vault.create_secret(%s, 'pk_vapid_private', 'PowerKlock Web Push private key (scripts/push_keys.py)')", (priv,))
        cur.execute("insert into public.push_config (k, v) values ('vapid_public', %s) on conflict (k) do update set v = excluded.v", (pub,))
        if rotate:
            cur.execute('delete from public.push_subscription')
        conn.commit()
        print('keys made; public key:', pub)
    return 0


if __name__ == '__main__':
    sys.exit(main())
