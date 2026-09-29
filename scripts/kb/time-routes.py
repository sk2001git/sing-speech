"""
Time a spoken question end to end on each route, as the phone sends it: the recording as
base64 to /api/search, against the dev server.

    python scripts/kb/time-routes.py [--routes openai-ws,cloudflare] [--clips a.mp4,b.mp4] [--runs 2]

Prints the time to the answer per clip and route, and the server's own stage timings when it
sends a Server-Timing header. Costs a few cents of model calls per run.
"""
import argparse, base64, json, statistics, time, urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
ap = argparse.ArgumentParser()
# 127.0.0.1, not localhost: on Windows, Python tries IPv6 first and every request waited 2 s more.
ap.add_argument('--base', default='http://127.0.0.1:4388')
ap.add_argument('--routes', default='openai-ws,cloudflare')
ap.add_argument('--clips', default='chas-clean.mp4,appt-clean-noise.mp4,appt-two-needs.mp4')
ap.add_argument('--runs', type=int, default=2)
args = ap.parse_args()

def post(route, audio):
    body = json.dumps({'kind': 'speech', 'audioBase64': audio, 'mimeType': 'audio/mp4', 'reply': 'en', 'route': route}).encode()
    req = urllib.request.Request(f'{args.base}/api/search', data=body, headers={'content-type': 'application/json'})
    t = time.time()
    with urllib.request.urlopen(req, timeout=120) as r:
        out = json.loads(r.read().decode('utf-8'))
        timing = r.headers.get('server-timing', '')
    return time.time() - t, out, timing

for route in args.routes.split(','):
    totals = []
    for clip in args.clips.split(','):
        audio = base64.b64encode((ROOT / 'fixtures/audio/eval' / clip).read_bytes()).decode()
        for _ in range(args.runs):
            secs, out, timing = post(route, audio)
            totals.append(secs)
            heard = (out.get('result') or out).get('heard', {})
            print(f'{route:11} {clip:24} {secs:5.1f} s  {out["kind"]:8} {heard.get("short", "")!r:32} {timing}')
    print(f'{route:11} median {statistics.median(totals):.1f} s over {len(totals)}\n')
