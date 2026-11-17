#!/usr/bin/env python3
"""Load the site in headless Chromium (direct, no proxy), capture:
- console errors
- failed network responses (4xx/5xx)
- hero screenshot (names + waving flag)
- rotating-gallery + photo-gallery screenshots
Usage: python shots_local.py [url] [outdir]
"""
import os
import sys
from playwright.sync_api import sync_playwright

URL = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8099/"
OUT = sys.argv[2] if len(sys.argv) > 2 else r"D:\Wedding website\Framer\_tools\shots\verify"
os.makedirs(OUT, exist_ok=True)

failed = []
console = []

with sync_playwright() as p:
    b = p.chromium.launch()
    page = b.new_page(viewport={"width": 1440, "height": 900})
    page.on("response", lambda r: failed.append(f"{r.status} {r.url}")
            if r.status >= 400 else None)
    page.on("console", lambda m: console.append(f"{m.type}: {m.text[:160]}")
            if m.type in ("error", "warning") else None)
    page.goto(URL, wait_until="networkidle", timeout=60000)
    page.wait_for_timeout(6000)  # let entrance animations settle
    page.screenshot(path=os.path.join(OUT, "hero.png"))

    # scroll through the page so scroll-triggered sections render
    h = page.evaluate("document.body.scrollHeight")
    y = 0
    while y < h:
        page.mouse.wheel(0, 800)
        page.wait_for_timeout(400)
        y += 800
    page.wait_for_timeout(2000)

    # rotating gallery (nature photos)
    page.evaluate("window.scrollTo(0, document.body.scrollHeight * 0.42)")
    page.wait_for_timeout(2500)
    page.screenshot(path=os.path.join(OUT, "gallery_nature.png"))

    # photo gallery (big photos)
    page.evaluate("window.scrollTo(0, document.body.scrollHeight * 0.30)")
    page.wait_for_timeout(2500)
    page.screenshot(path=os.path.join(OUT, "gallery_photos.png"))

    # final hero again (flag animates)
    page.evaluate("window.scrollTo(0, 0)")
    page.wait_for_timeout(2500)
    page.screenshot(path=os.path.join(OUT, "hero_final.png"))

    # any remaining failed requests
    b.close()

print("=== failed responses (4xx/5xx) ===")
for f in failed:
    print("  ", f)
print("total failed:", len(failed))
print()
print("=== console errors/warnings ===")
for c in console[:30]:
    print("  ", c)
print("total:", len(console))
