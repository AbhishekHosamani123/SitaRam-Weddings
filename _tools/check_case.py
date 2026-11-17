#!/usr/bin/env python3
"""Case-sensitive existence check for every referenced /mirror/ URL,
the way Vercel's Linux servers would resolve it."""
import os
import re
import html
import hashlib
import sys

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

ROOT = r"D:\Wedding website\Framer\public"
MIRROR = os.path.join(ROOT, "mirror")
URL_RE = re.compile(r"/mirror/([a-zA-Z0-9.\-]+)/([^\"'`()\\\s<>]+)")

# build case-sensitive index of every file under mirror (relative, forward slashes)
disk = {}
for r, _d, names in os.walk(MIRROR):
    for n in names:
        rel = os.path.relpath(os.path.join(r, n), ROOT).replace("\\", "/")
        disk[rel] = True

def scan_files():
    files = [os.path.join(ROOT, "index.html")]
    for r, _d, names in os.walk(MIRROR):
        for n in names:
            if n.endswith((".mjs", ".js")):
                files.append(os.path.join(r, n))
    return files

targets = {}
for f in scan_files():
    text = open(f, encoding="utf-8", errors="replace").read()
    if f.endswith(".html"):
        text = html.unescape(text)
    for m in URL_RE.finditer(text):
        host, pwq = m.group(1), m.group(2)
        pwq = re.sub(r"[),;}\]]+$", "", pwq)
        targets[(host, pwq)] = targets.get((host, pwq), 0) + 1

print("unique /mirror/ URLs referenced:", len(targets))
problems = []
for (host, pwq), cnt in sorted(targets.items()):
    path, _, rawq = pwq.partition("?")
    q = html.unescape(rawq)
    bare_rel = "mirror/" + host + "/" + path
    h = hashlib.sha1(q.encode()).hexdigest()[:8] if q else ""
    hash_rel = bare_rel + ("__" + h if q else "")
    case_ok = bare_rel in disk
    insensitive_ok = os.path.isfile(os.path.join(ROOT, bare_rel.replace("/", os.sep)))
    hash_ok = hash_rel in disk
    if not case_ok:
        note = ""
        if insensitive_ok and not case_ok:
            # find the on-disk casing
            cand = [k for k in disk if k.lower() == bare_rel.lower()]
            note = f"  CASE MISMATCH! disk has: {cand}"
        problems.append((host, pwq, cnt, hash_ok, note))

print()
print("=== would-404 on Vercel (case-sensitive bare lookup) ===")
for host, pwq, cnt, hash_ok, note in problems:
    print(f"  [{cnt} refs] {host}/{pwq}   hash-variant={hash_ok}{note}")
print("total:", len(problems))
