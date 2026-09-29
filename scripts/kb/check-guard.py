"""
Try to abuse the API the way a stranger would, and check the guard refuses (vault plan-suara-0021).

    python scripts/kb/check-guard.py [--base http://127.0.0.1:4388] [--budget]

1. no session: 401    2. another site's page: 403    3. an oversized body: 413
4. a session from /api/session works    5. a burst over the rate: 429 busy
--budget: spends a session's budget on a typed question (a few tenths of a cent each) and expects
"enough-for-today". Run the dev server with SUARA_SESSION_BUDGET_USD=0.02 for it.
"""
import argparse, http.cookiejar, json, sys, time, urllib.error, urllib.parse, urllib.request

ap = argparse.ArgumentParser()
ap.add_argument('--base', default='http://127.0.0.1:4388')
ap.add_argument('--budget', action='store_true')
args = ap.parse_args()

results = []
def check(name, ok, detail=''):
    results.append(ok)
    print(f"{'PASS' if ok else 'FAIL'}  {name}{f'  ({detail})' if detail else ''}")

def call(opener, path, method='GET', body=None, headers=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(args.base + path, data=data, method=method, headers={'content-type': 'application/json', **(headers or {})})
    try:
        with opener.open(req, timeout=60) as r:
            return r.status, r.read()
    except urllib.error.HTTPError as e:
        return e.code, e.read()

bare = urllib.request.build_opener()
status, body = call(bare, '/api/search', 'POST', {'kind': 'text', 'query': 'CHAS card', 'reply': 'en'})
check('no session is refused', status == 401, f'{status} {body[:40]!r}')
status, _ = call(bare, '/api/search', 'POST', {'kind': 'text', 'query': 'CHAS card', 'reply': 'en'}, {'origin': 'https://evil.example'})
check("another site's page is refused", status == 403, str(status))
status, _ = call(bare, '/api/web', 'POST', {'question': 'x' * 40000, 'language': 'en'})
check('an oversized body is refused', status == 413, str(status))

jar = http.cookiejar.CookieJar()
me = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))
status, _ = call(me, '/api/session', 'POST', {})
check('a session is issued', status == 200 and any(c.name == 'suara_s' for c in jar), str(status))

line = urllib.parse.urlencode({'text': 'Hello. What do you need?', 'language': 'en', 'route': 'openai-ws'})
status, _ = call(me, f'/api/speak?{line}')
check('with a session, the API answers', status == 200, str(status))

replies = [call(me, f'/api/speak?{line}') for _ in range(45)]
busy = sum(1 for status, body in replies if status == 429 and b'busy' in body)
other = sum(1 for status, body in replies if status == 429 and b'busy' not in body)
# Only "busy" is the rate limit. The dev server does not enforce Workers rate limits (checked
# 2026-09-30: 45 in a row all passed it), so this is checked on a deployed Worker.
check('a burst past 40 a minute is slowed down', busy > 0, f'{busy} refused as busy, {other} refused for the budget')

if args.budget:
    time.sleep(61)  # past the rate window, so only the budget can refuse
    jar2 = http.cookiejar.CookieJar()
    fresh = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar2))
    call(fresh, '/api/session', 'POST', {})
    seen = []
    for _ in range(35):
        status, body = call(fresh, '/api/search', 'POST', {'kind': 'text', 'query': 'how do I apply for a CHAS card', 'reply': 'en'})
        seen.append((status, body[:40]))
        if status == 429:
            break
    last = seen[-1]
    check("a session's budget runs out", last[0] == 429 and b'enough-for-today' in last[1], f'after {len(seen)} calls: {last}')

sys.exit(0 if all(results) else 1)
