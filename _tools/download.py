#!/usr/bin/env python3
"""Mirror all asset URLs extracted from the target Framer site.

Stores files under mirror/<host>/<path> (+ __<hash8> suffix when a query
string is present). Skips non-asset URLs we intentionally keep external.
"""
import hashlib
import os
import sys
import urllib.request
import urllib.error

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MIRROR = os.path.join(ROOT, "mirror")
URLFILE = os.path.join(ROOT, "all_urls.txt")

SKIP_PREFIXES = (
    "https://www.google.com/",
    "https://framer.com/",
    "https://www.framer.com",
    "https://www.framer.com/",
    "https://events.framer.com/",
    "https://cp.bestfreecdn.com/",
    "https://rammandir.framer.website/",
    "https://fonts.gstatic.com",  # bare preconnect host (no path)
)

UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36")


def local_path(url: str) -> str:
    """Map a full URL to a local file path under mirror/."""
    # strip query into a deterministic suffix
    base, _, query = url.partition("?")
    parts = base.split("/", 3)  # scheme, "", host, path...
    host = parts[2]
    path = parts[3] if len(parts) > 3 else ""
    if query:
        path += "__" + hashlib.sha1(query.encode()).hexdigest()[:8]
    # decode percent-encoding only in the last segment for readability
    return os.path.join(MIRROR, host, *path.split("/"))


def fetch(url: str) -> bool:
    dest = local_path(url)
    if os.path.exists(dest):
        return True
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    tmp = dest + ".part"
    try:
        with urllib.request.urlopen(req, timeout=30) as r, open(tmp, "wb") as f:
            while True:
                chunk = r.read(65536)
                if not chunk:
                    break
                f.write(chunk)
        os.replace(tmp, dest)
        return True
    except Exception as e:
        try:
            os.remove(tmp)
        except OSError:
            pass
        print(f"  FAIL {url}: {e}", file=sys.stderr)
        return False


def main():
    with open(URLFILE, encoding="utf-8") as f:
        urls = [line.strip() for line in f if line.strip()]
    targets = [u for u in urls if not u.startswith(SKIP_PREFIXES)]
    print(f"Total URLs: {len(urls)}, mirror targets: {len(targets)}")
    ok = fail = 0
    for i, u in enumerate(targets, 1):
        if fetch(u):
            ok += 1
        else:
            fail += 1
        if i % 25 == 0:
            print(f"  progress {i}/{len(targets)}")
    print(f"Done: {ok} ok, {fail} failed")


if __name__ == "__main__":
    main()
