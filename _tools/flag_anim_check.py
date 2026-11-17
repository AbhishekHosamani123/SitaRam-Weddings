#!/usr/bin/env python3
"""Diff consecutive frames in the flag region to check waving animation."""
from PIL import Image, ImageChops

OUT = r"D:\Wedding website\Framer\_tools\shots\flagcmp"
# flag bounding box in 1440x900 hero
BOX = (650, 400, 900, 580)

for site in ("orig", "ours"):
    for tag in ("desktop", "mobile"):
        f1 = Image.open(f"{OUT}\\{site}_{tag}_f1.png").convert("RGB").crop(BOX)
        f2 = Image.open(f"{OUT}\\{site}_{tag}_f2.png").convert("RGB").crop(BOX)
        d = ImageChops.difference(f1, f2)
        bbox = d.getbbox()
        hist = d.convert("L").histogram()
        changed = sum(hist[8:])  # pixels changed by >8 levels
        total = f1.size[0] * f1.size[1]
        print(f"{site:5s} {tag:8s} changed-pixels={changed:7d}/{total} ({100*changed/total:.2f}%)  diff-bbox={bbox}")
