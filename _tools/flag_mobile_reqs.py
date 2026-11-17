#!/usr/bin/env python3
"""Mobile: log every image request on original vs clone, print them side by side."""
from playwright.sync_api import sync_playwright

SITES = {
    "orig": "https://rammandir.framer.website/",
    "ours": "https://sitram-weddings.vercel.app/",
}

with sync_playwright() as p:
    b = p.chromium.launch()
    for name, url in SITES.items():
        page = b.new_page(viewport={"width": 390, "height": 844}, device_scale_factor=2)
        page.on("response", lambda r: print(f"{name}: {r.status} {r.headers.get('content-type','')} {r.url}"))
        page.goto(url, wait_until="networkidle", timeout=60000)
        page.wait_for_timeout(3000)
        page.close()
    b.close()
