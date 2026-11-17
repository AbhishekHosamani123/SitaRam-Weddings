#!/usr/bin/env python3
"""Cache-bust the deploy for browsers that cached the pre-fix bundles and
pre-fix 404s (Vercel marks 404s immutable for 1 year).

Strategy:
- Rename the 3 changed bundles (script_main, VR998, shared-lib) to *.v2.mjs
  so even a browser with the old bundle cached must fetch the new one.
- Update every reference to the renamed bundles (index.html, script_main
  dynamic import, VR998 import of shared-lib).
- Append ?v=2 / &v=2 to every URL of the 10 previously-broken images so the
  browser's cached 404 for the old exact URL is bypassed (query is stripped
  by Vercel, so the bare file is still served).
- Point the searchIndex metas at ?v=2 for the same reason (old 200-cached
  JSON holds Akash/Drashti).
- Drop sourceMappingURL comments (the .map files don't exist; avoids
  pointless devtools 404s).
"""
import re
import sys
from pathlib import Path

PUB = Path(r"D:\Wedding website\Framer\public")
SITE = PUB / "mirror" / "framerusercontent.com" / "sites" / "1Jnwf2uoy3TohI0oOnOtPi"

RENAMES = {
    "script_main.BNALTGIK.mjs": "script_main.BNALTGIK.v2.mjs",
    "VR998DU3WSRaZIpYrcWhMoQxMWGXSrJFDK6jx2eUMjE.DKHZzuKc.mjs":
        "VR998DU3WSRaZIpYrcWhMoQxMWGXSrJFDK6jx2eUMjE.DKHZzuKc.v2.mjs",
    "shared-lib.DDe1d4ZQ.mjs": "shared-lib.DDe1d4ZQ.v2.mjs",
}

# images whose exact old URLs were 404-cached (immutable) in user browsers
BROKEN = [
    "Mr5CWcNPJMlbL9TvpxtjbiK8yo",
    "72XoQPUGMzuAK0nUiljwSxGw2HA",
    "GfGkADagM4KEibNcIiRUWlfrR0",
    "3JekLBRwVWegsCm3gX3wOcYeM",
    "photo-1433086966358-54859d0ed716",
    "photo-1441974231531-c6227db76b6e",
    "photo-1447752875215-b2761acb3c5d",
    "photo-1469474968028-56623f02e42e",
    "photo-1470071459604-3b5ec3a7fe05",
    "photo-1506744038136-46273834b3fb",
]

EXT = r"(?:png|jpe?g|webp)"


def bump_images(text: str):
    """Append ?v=2 (bare URL) or &v=2 (URL that already has a query)."""
    count = 0
    # URL already has a query: consume up to the terminator, append &v=2
    pat_q = re.compile(
        r"(" + "|".join(re.escape(n) for n in BROKEN) + r")\." + EXT +
        r"\?[^\s\"'`)\]]*"
    )

    def rep_q(m):
        nonlocal count
        if m.group(0).endswith("&v=2") or m.group(0).endswith("?v=2"):
            return m.group(0)
        count += 1
        return m.group(0) + "&v=2"

    text = pat_q.sub(rep_q, text)

    # bare URL (no query): add ?v=2 before the terminator
    pat_bare = re.compile(
        r"(" + "|".join(re.escape(n) for n in BROKEN) + r")\." + EXT +
        r"(?=[\s\"'`)\]])"
    )

    def rep_bare(m):
        nonlocal count
        count += 1
        return m.group(0) + "?v=2"

    text = pat_bare.sub(rep_bare, text)
    return text, count


def drop_sourcemap(text: str):
    return re.sub(r"\n?//# sourceMappingURL=\S+\.map", "", text)


def main():
    for old, new in RENAMES.items():
        src = SITE / old
        dst = SITE / new
        if not src.exists():
            print(f"SKIP (missing): {old}")
            continue
        text = src.read_text(encoding="utf-8")
        text = drop_sourcemap(text)
        total = 0
        if old.startswith("script_main"):
            # dynamic import of VR998 -> new name
            for o, n in RENAMES.items():
                if o != old:
                    before = text
                    text = text.replace(o, n)
                    total += before.count(o)
        elif old.startswith("VR998"):
            # import of shared-lib -> new name
            o = "shared-lib.DDe1d4ZQ.mjs"
            total += text.count(o)
            text = text.replace(o, RENAMES[o])
            text, c = bump_images(text)
            total += c
        elif old.startswith("shared-lib"):
            text, c = bump_images(text)
            total += c
        dst.write_text(text, encoding="utf-8", newline="\n")
        src.unlink()
        print(f"RENAMED {old} -> {new}  (ref/image edits: {total})")

    # index.html: point at renamed bundles, bump searchIndex + broken images
    html_path = PUB / "index.html"
    html = html_path.read_text(encoding="utf-8")
    edits = 0
    for o, n in RENAMES.items():
        c = html.count(o)
        html = html.replace(o, n)
        edits += c
    for j in ("searchIndex-QS4zpBtJCxFE.json", "searchIndex-nh9nnPhzYpRc.json"):
        html = html.replace(f"{j}\"", f"{j}?v=2\"")
        edits += 1
    html, c = bump_images(html)
    edits += c
    html_path.write_text(html, encoding="utf-8", newline="\n")
    print(f"index.html edits: {edits}")

    # safety sweep: no stale references anywhere in public/
    stale = []
    for f in list(PUB.rglob("*.mjs")) + list(PUB.rglob("*.html")) + list(PUB.rglob("*.json")):
        try:
            t = f.read_text(encoding="utf-8", errors="ignore")
        except OSError:
            continue
        for o in RENAMES:
            if o in t and f.name not in RENAMES.values():
                stale.append(f"{f}: still references {o}")
    if stale:
        print("STALE REFS FOUND:")
        for s in stale:
            print("  ", s)
        sys.exit(1)
    print("OK: no stale bundle references remain")


if __name__ == "__main__":
    main()
