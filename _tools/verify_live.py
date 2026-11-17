#!/usr/bin/env python3
"""Extract every locally-served URL referenced by index.html + all site
bundles, and verify each returns 200 on the LIVE deployment."""
import re
import urllib.request
from pathlib import Path

BASE = "https://sitram-weddings.vercel.app"
PUB = Path(r"D:\Wedding website\Framer\public")
SITE = PUB / "mirror" / "framerusercontent.com" / "sites" / "1Jnwf2uoy3TohI0oOnOtPi"

FILES = [PUB / "index.html"] + sorted(SITE.glob("*.mjs"))
URL_RE = re.compile(
    r"(?:/mirror/|/assets/)[A-Za-z0-9_\-./@%]+?\."
    r"(?:png|jpe?g|webp|mjs|json|css|js|svg|woff2?|gif|avif|ico)"
    r"(?:\?[A-Za-z0-9_\-=&.%]+)?"
)

urls = set()
for f in FILES:
    t = f.read_text(encoding="utf-8", errors="ignore")
    urls.update(m.group(0) for m in URL_RE.finditer(t))
urls = sorted(urls)
print(f"checking {len(urls)} unique URLs against live...\n")

bad = []
ok = 0
for u in urls:
    req = urllib.request.Request(BASE + u, method="HEAD")
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            status = r.status
    except urllib.error.HTTPError as e:
        status = e.code
    except Exception as e:
        status = f"ERR {e}"
    if status == 200:
        ok += 1
    else:
        bad.append((status, u))

print(f"200 OK: {ok}/{len(urls)}")
if bad:
    print("FAILURES:")
    for s, u in bad:
        print(f"  {s}  {u}")
else:
    print("ALL REFERENCED ASSETS RESOLVE ON LIVE")
