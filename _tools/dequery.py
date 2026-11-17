#!/usr/bin/env python3
"""Strip ?query variants from all /mirror/ URLs and ensure base files exist.

Vercel static hosting cannot map `?query` to the hash-suffixed local files,
so any URL with a query 404s. This script:
  1. finds every /mirror/<host>/<path>?<query> occurrence in HTML/JS
  2. downloads the base file (no query) from the origin if not present
  3. rewrites every occurrence to drop the query part
"""
import hashlib
import os
import re
import sys
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PUBLIC = os.path.join(ROOT, "public")
MIRROR = os.path.join(PUBLIC, "mirror")

UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36")

# path chars: everything up to a quote/space/paren/backtick/angle/comma/brace
PATH_CHARS = r"[^\"'()\s<>`,{}\[\]\\]+"
# query chars: safe URL query alphabet only
QUERY_CHARS = r"[A-Za-z0-9_=&%.;:+!~*@-]+"
URL_RE = re.compile(rf"/mirror/([a-zA-Z0-9.-]+)/({PATH_CHARS})\?({QUERY_CHARS})")
AMP_RE = re.compile(rf"/mirror/([a-zA-Z0-9.-]+)/({PATH_CHARS})\?({QUERY_CHARS.replace('&', '&amp;')})")


def fetch_base(host, path):
    dest = os.path.join(MIRROR, host, *path.split("/"))
    if os.path.exists(dest) and os.path.getsize(dest) > 0:
        return dest
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    url = f"https://{host}/{path}"
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    tmp = dest + ".part"
    try:
        with urllib.request.urlopen(req, timeout=60) as r, open(tmp, "wb") as f:
            while True:
                chunk = r.read(65536)
                if not chunk:
                    break
                f.write(chunk)
        os.replace(tmp, dest)
        print(f"  base fetched: {host}/{path} ({os.path.getsize(dest)} bytes)")
        return dest
    except Exception as e:
        try:
            os.remove(tmp)
        except OSError:
            pass
        print(f"  BASE FAIL {host}/{path}: {e}", file=sys.stderr)
        return None


def scan():
    files = [os.path.join(PUBLIC, "index.html")]
    for root, _d, names in os.walk(MIRROR):
        for n in names:
            if n.endswith((".mjs", ".js")):
                files.append(os.path.join(root, n))
    return files


def main():
    files = scan()
    # 1) collect all unique (host, path)
    all_pairs = set()
    for f in files:
        with open(f, encoding="utf-8", errors="replace") as fh:
            txt = fh.read()
        for rx in (URL_RE, AMP_RE):
            for m in rx.finditer(txt):
                all_pairs.add((m.group(1), m.group(2)))
    print(f"unique (host, path) pairs with queries: {len(all_pairs)}")
    # 2) fetch missing bases
    missing = 0
    for host, path in sorted(all_pairs):
        if fetch_base(host, path) is None:
            missing += 1
    # 3) rewrite: drop query parts
    total = 0
    for f in files:
        with open(f, encoding="utf-8", errors="replace") as fh:
            txt = fh.read()
        orig = txt
        txt = URL_RE.sub(lambda m: f"/mirror/{m.group(1)}/{m.group(2)}", txt)
        txt = AMP_RE.sub(lambda m: f"/mirror/{m.group(1)}/{m.group(2)}", txt)
        if txt != orig:
            with open(f, "w", encoding="utf-8") as fh:
                fh.write(txt)
            total += 1
            print(f"  rewrote {os.path.relpath(f, PUBLIC)}")
    print(f"rewrote {total} files; missing bases: {missing}")
    # 4) final sanity: any query URLs left?
    leftover = 0
    for f in files:
        with open(f, encoding="utf-8", errors="replace") as fh:
            txt = fh.read()
        if URL_RE.search(txt) or AMP_RE.search(txt):
            leftover += 1
            print(f"  LEFTOVER in {os.path.relpath(f, PUBLIC)}")
    print(f"files with leftover query URLs: {leftover}")


if __name__ == "__main__":
    main()
