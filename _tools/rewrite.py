#!/usr/bin/env python3
"""Rewrite CDN URLs in HTML and JS bundles to local /mirror/ paths.

Keeps query strings intact; the server maps /mirror/<host>/<path>?<query>
to local cache files (or proxies to the origin CDN for anything missing).
"""
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SITE_DIR = os.path.join(ROOT, "mirror", "framerusercontent.com", "sites",
                        "1Jnwf2uoy3TohI0oOnOtPi")

REPLACEMENTS = (
    ("https://framerusercontent.com/", "/mirror/framerusercontent.com/"),
    ("https://images.unsplash.com/", "/mirror/images.unsplash.com/"),
    ("https://fonts.gstatic.com/", "/mirror/fonts.gstatic.com/"),
)


def rewrite_text(text: str) -> str:
    for old, new in REPLACEMENTS:
        text = text.replace(old, new)
    return text


def main():
    html_in = os.path.join(ROOT, "index_orig.html")
    html_out = os.path.join(ROOT, "index.html")
    with open(html_in, encoding="utf-8") as f:
        html = f.read()
    out = rewrite_text(html)
    with open(html_out, "w", encoding="utf-8") as f:
        f.write(out)
    print(f"index.html: {len(html)} -> {len(out)} bytes")

    for name in sorted(os.listdir(SITE_DIR)):
        if not name.endswith(".mjs"):
            continue
        p = os.path.join(SITE_DIR, name)
        with open(p, encoding="utf-8") as f:
            original = f.read()
        rewritten = rewrite_text(original)
        if rewritten != original:
            with open(p, "w", encoding="utf-8") as f:
                f.write(rewritten)
            print(f"{name}: rewritten ({len(original)} -> {len(rewritten)} bytes)")
        else:
            print(f"{name}: no changes")


if __name__ == "__main__":
    main()
