#!/usr/bin/env python3
"""Regenerate .claude/skills/powerklock-sql/reference/schema.md from meta.dictionary.

Run after a migration that adds or changes tables/views:
  WAREHOUSE_DB_URL=postgresql://… python warehouse/export_skill_schema.py
"""
import os
from collections import OrderedDict

import psycopg

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, '.claude', 'skills', 'powerklock-sql', 'reference', 'schema.md')
ORDER = ['analytics', 'market', 'meta', 'ops']
SKIP = {'file_state', 'schema_migrations'}


def main():
    db = os.environ.get('WAREHOUSE_DB_URL') or os.environ.get('SUPABASE_DB_URL')
    with psycopg.connect(db) as conn, conn.cursor() as cur:
        cur.execute("""select schema, object, kind, column_name, data_type, description from meta.dictionary
                       where schema = any(%s) order by array_position(%s, schema::text), object, column_name nulls first""", (ORDER, ORDER))
        rows = cur.fetchall()
    objs = OrderedDict()
    for schema, obj, kind, col, typ, desc in rows:
        if obj in SKIP:
            continue
        o = objs.setdefault((schema, obj), {'kind': None, 'desc': '', 'cols': []})
        if col is None:
            o['kind'], o['desc'] = kind, desc or ''
        else:
            o['cols'].append((col, typ, desc or ''))
    lines = ['# PowerKlock warehouse — schema', '',
             'Generated from `meta.dictionary` by `warehouse/export_skill_schema.py`. '
             'Prefer the `analytics` views; `market` holds the raw tables (arrays of 96 quarter-hours or 24 hours, Paris clock).', '']
    cur_schema = None
    for (schema, obj), o in objs.items():
        if schema != cur_schema:
            lines += ['', f'## {schema}', '']
            cur_schema = schema
        lines.append(f'### {schema}.{obj} ({o["kind"] or "table"})')
        if o['desc']:
            lines.append(o['desc'])
        lines.append('')
        lines.append('| column | type | note |')
        lines.append('|---|---|---|')
        for col, typ, desc in o['cols']:
            lines.append(f'| {col} | {typ} | {desc.replace("|", "/")} |')
        lines.append('')
    with open(OUT, 'w') as f:
        f.write('\n'.join(lines) + '\n')
    print(f'{OUT}: {len(objs)} objects')


if __name__ == '__main__':
    main()
