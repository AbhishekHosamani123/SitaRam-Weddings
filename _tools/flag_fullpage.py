#!/usr/bin/env python3
"""Full-page screenshots of original vs clone to locate every waving flag."""
from playwright.sync_api import sync_playwright

SITES = {
    "orig": "https://rammandir.framer.website/",
    "ours": "https://sitram-weddings.vercel.app/",
}
OUT = r"D:\Wedding website\Framer\_tools\shots\flagcmp"

with sync_playwright() as p:
    b = p.chromium.launch()
    for name, url in SITES.items():
        page = b.new_page(viewport={"width": 1440, "height": 900})
        page.goto(url, wait_until="networkidle", timeout=60000)
        page.wait_for_timeout(3000)
        # pre-scroll through the page so lazy sections mount
        h = page.evaluate("document.body.scrollHeight")
        y = 0
        while y < h:
            page.mouse.wheel(0, 800)
            page.wait_for_timeout(300)
            y += 800
        page.wait_for_timeout(2000)
        page.screenshot(path=f"{OUT}\\{name}_full.png", full_page=True)
        print(name, "full-page height:", page.evaluate("document.body.scrollHeight"))
        page.close()
    b.close()
