import json, sys, time
import numpy as np
sys.path.insert(0, '/home/ubuntu/PowerKlock/.claude/worktrees/bridge-cse_019SBz1eD5ytFRZxqbyv9hcG/scripts')
import fetch_region_hourly as R
from pathlib import Path
for y in range(2019, 2027):
    for c in ('DE', 'BE', 'NL', 'AT', 'CH', 'IT', 'ES'):
        f = Path(f'/tmp/mo/full/{c}_{y}.json')
        if f.exists(): continue
        pw = R.get(c.lower(), y)
        if not pw: print(y, c, 'none', flush=True); continue
        ts = pw['unix_seconds']; out = {}
        for p in pw['production_types']:
            out[p['name']] = R.by_paris_day(R.hourly(ts, p['data']), y)
        f.write_text(json.dumps(out)); print(y, c, len(out), flush=True); time.sleep(2)
