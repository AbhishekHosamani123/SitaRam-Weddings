#!/usr/bin/env python3
"""Locate the rotating unsplash gallery on the page and screenshot it."""
import os
import sys
from playwright.sync_api import sync_playwright

URL = "http://127.0.0.1:8099/"
OUT = r"D:\Wedding website\Framer\_tools\shots\verify"

with sync_playwright() as p:
    b = p.chromium.launch()
    page = b.new_page(viewport={"width": 1440, "height": 900})
    page.goto(URL, wait_until="networkidle", timeout=60000)
    page.wait_for_timeout(4000)

    # find elements referencing the unsplash gallery images
    info = page.evaluate("""() => {
        const out = [];
        for (const img of document.querySelectorAll('img')) {
            if (img.src.includes('unsplash')) {
                const r = img.getBoundingClientRect();
                out.push({src: img.src.slice(-60), y: r.top + window.scrollY,
                          visible: r.width > 0});
            }
        }
        return out;
    }""")
    print("unsplash <img> elements:", len(info))
    for i in info[:6]:
        print("  ", i)

    # canvas-based gallery? count canvases
    ncanvas = page.evaluate("document.querySelectorAll('canvas').length")
    print("canvas elements on page:", ncanvas)

    if info:
        y = max(0, int(info[0]["y"]) - 350)
        page.evaluate(f"window.scrollTo(0, {y})")
        page.wait_for_timeout(3500)
        page.screenshot(path=os.path.join(OUT, "unsplash_gallery.png"))
        print("saved unsplash_gallery.png at y =", y)
    else:
        # fall back: scan sections and save several shots
        for frac in (0.5, 0.6, 0.7):
            page.evaluate(
                f"window.scrollTo(0, document.body.scrollHeight * {frac})")
            page.wait_for_timeout(2500)
            page.screenshot(
                path=os.path.join(OUT, f"scan_{int(frac*100)}.png"))
            print("saved scan at", frac)
    b.close()
