#!/usr/bin/env python3
"""Apply the bride/groom rename to the deployed (Framer/public) project:
    Drashti -> Sita   (bride)
    Akash   -> Ram    (groom, guarded so 'Aakash Mittal' is untouched)
Files: index.html, main bundle, 2 search index JSONs.
Prints per-file before/after counts."""
import re
import sys

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

FILES = [
    r"D:\Wedding website\Framer\public\index.html",
    r"D:\Wedding website\Framer\public\mirror\framerusercontent.com"
    r"\sites\1Jnwf2uoy3TohI0oOnOtPi"
    r"\VR998DU3WSRaZIpYrcWhMoQxMWGXSrJFDK6jx2eUMjE.DKHZzuKc.mjs",
    r"D:\Wedding website\Framer\public\mirror\framerusercontent.com"
    r"\sites\1Jnwf2uoy3TohI0oOnOtPi\searchIndex-nh9nnPhzYpRc.json",
    r"D:\Wedding website\Framer\public\mirror\framerusercontent.com"
    r"\sites\1Jnwf2uoy3TohI0oOnOtPi\searchIndex-QS4zpBtJCxFE.json",
]

for p in FILES:
    c = open(p, encoding="utf-8", newline="").read()
    before = (len(re.findall(r"Drashti", c)), len(re.findall(r"(?<![Aa])Akash", c)),
              len(re.findall(r"Aakash", c)))
    c2 = c.replace("Drashti", "Sita")
    c2 = re.sub(r"(?<![Aa])Akash", "Ram", c2)
    after = (len(re.findall(r"Drashti", c2)), len(re.findall(r"(?<![Aa])Akash", c2)),
             len(re.findall(r"Aakash", c2)))
    if c2 != c:
        open(p, "w", encoding="utf-8", newline="").write(c2)
    name = p.rsplit("\\", 1)[-1]
    print(f"{name:28s} before D/A/Aa={before}  after={after}  "
          f"{'WRITTEN' if c2 != c else 'unchanged'}")

# final sanity: no Akash/Drashti anywhere in the project
import os
ROOT = r"D:\Wedding website\Framer\public"
left = []
for r, _d, names in os.walk(ROOT):
    for n in names:
        p = os.path.join(r, n)
        try:
            t = open(p, encoding="utf-8", errors="ignore").read()
        except OSError:
            continue
        d = len(re.findall(r"Drashti", t))
        a = len(re.findall(r"(?<![Aa])Akash", t))
        if d or a:
            left.append((p, d, a))
print()
print("remaining Akash/Drashti occurrences in project:", left if left else "NONE")
