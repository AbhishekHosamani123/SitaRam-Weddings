#!/usr/bin/env python3
"""Fetch every /mirror/ URL referenced in HTML/JS that is not yet on disk.

Makes the clone fully static (Vercel-deployable): with the proxy absent,
every URL the site can request must exist as a real file.
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

URL_RE = re.compile(r"/mirror/([a-zA-Z0-9.-]+)/([^\"'()\s<>]+)")


def local_path(host, path_with_query):
    path, _, query = path_with_query.partition("?")
    local = os.path.join(MIRROR, host, *path.split("/"))
    if query:
        local += "__" + hashlib.sha1(query.encode()).hexdigest()[:8]
    return local


def fetch(host, path_with_query):
    dest = local_path(host, path_with_query)
    if os.path.exists(dest) and os.path.getsize(dest) > 0:
        return "have"
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    url = f"https://{host}/{path_with_query}"
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
        return "fetched"
    except Exception as e:
        try:
            os.remove(tmp)
        except OSError:
            pass
        print(f"  FAIL {url}: {e}", file=sys.stderr)
        return "failed"


def scan_files():
    files = [os.path.join(PUBLIC, "index.html")]
    for root, _dirs, names in os.walk(MIRROR):
        for n in names:
            if n.endswith((".mjs", ".js")):
                files.append(os.path.join(root, n))
    return files


def main():
    targets = {}  # (host, path_with_query) -> source count
    for f in scan_files():
        with open(f, encoding="utf-8", errors="replace") as fh:
            text = fh.read()
        for m in URL_RE.finditer(text):
            host, pwq = m.group(1), m.group(2)
            # strip trailing punctuation that regex might have included
            pwq = re.sub(r"[),;}\]]+$", "", pwq)
            if pwq.endswith((".mjs", ".js", ".json", ".html", ".css",
                             ".woff2", ".woff", ".ttf", ".otf", ".png",
                             ".webp", ".jpg", ".jpeg", ".gif", ".svg",
                             ".avif", ".ico", ".mp4", ".webm")):
                targets[(host, pwq)] = targets.get((host, pwq), 0) + 1
    print(f"unique referenced URLs: {len(targets)}")
    stat = {"have": 0, "fetched": 0, "failed": 0}
    for (host, pwq), count in sorted(targets.items()):
        r = fetch(host, pwq)
        stat[r] += 1
        if r == "fetched":
            print(f"  fetched {host}/{pwq}")
    print(stat)


if __name__ == "__main__":
    main()
