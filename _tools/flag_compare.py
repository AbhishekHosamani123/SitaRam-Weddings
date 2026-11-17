#!/usr/bin/env python3
"""Compare the hero flag between the original Framer site and our clone:
- screenshots at desktop + mobile viewport
- two frames 1.2s apart to see if the flag animates
- log every Mr5 flag-texture request (status, type, size)
"""
from playwright.sync_api import sync_playwright

SITES = {
    "orig": "https://rammandir.framer.website/",
    "ours": "https://sitram-weddings.vercel.app/",
}
OUT = r"D:\Wedding website\Framer\_tools\shots\flagcmp"

import os
os.makedirs(OUT, exist_ok=True)

with sync_playwright() as p:
    b = p.chromium.launch()
    for name, url in SITES.items():
        for vp, tag in (( {"width":1440,"height":900}, "desktop" ),
                        ( {"width":390,"height":844}, "mobile" )):
            page = b.new_page(viewport=vp)
            reqs = []
            page.on("response", lambda r: reqs.append(
                f"{r.status} {r.url[:150]} ct={r.headers.get('content-type','')}"
            ) if "Mr5CWcNPJMlbL9TvpxtjbiK8yo" in r.url else None)
            page.goto(url, wait_until="networkidle", timeout=60000)
            page.wait_for_timeout(4000)
            page.screenshot(path=f"{OUT}\\{name}_{tag}_f1.png")
            page.wait_for_timeout(1200)
            page.screenshot(path=f"{OUT}\\{name}_{tag}_f2.png")
            print(f"--- {name} {tag}: flag texture requests ---")
            for r in reqs:
                print("   ", r)
            if not reqs:
                print("    (none)")
            page.close()
    b.close()
print("saved to", OUT)
