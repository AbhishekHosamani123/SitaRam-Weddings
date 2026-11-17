#!/usr/bin/env python3
"""Subtle deterministic color variation for every raster asset.

Purpose: keep images visually identical but byte-distinct from the original
site's assets. Per base image (query variants share the same seed), apply:
  - hue rotation within ±2 deg
  - brightness ×(0.97..1.03)
  - saturation ×(0.96..1.04)
  - contrast ×(1.00..1.03)

Fonts and non-raster files are untouched.
"""
import hashlib
import os
import random
import numpy as np
from PIL import Image, ImageEnhance

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MIRROR = os.path.join(ROOT, "public", "mirror")

RASTER = (".webp", ".png", ".jpg", ".jpeg", ".gif", ".avif")

def hue_matrix3(deg):
    """3x3 hue-rotation matrix (same formula as CSS filter hue-rotate)."""
    r = deg * 3.14159265 / 180.0
    c, s = __import__("math").cos(r), __import__("math").sin(r)
    return np.array([
        [0.213 + c * 0.787 - s * 0.213, 0.715 - c * 0.715 - s * 0.715,
         0.072 - c * 0.072 + s * 0.928],
        [0.213 - c * 0.213 + s * 0.143, 0.715 + c * 0.285 + s * 0.140,
         0.072 - c * 0.072 - s * 0.283],
        [0.213 - c * 0.213 - s * 0.787, 0.715 - c * 0.715 + s * 0.715,
         0.072 + c * 0.928 + s * 0.072],
    ])


def vary(im, seed_bytes):
    rng = random.Random(seed_bytes)
    hue = rng.uniform(-2.0, 2.0)
    bright = rng.uniform(0.97, 1.03)
    sat = rng.uniform(0.96, 1.04)
    contrast = rng.uniform(1.0, 1.03)

    # hue rotate on RGB (vectorized 3x3 matrix)
    im = im.convert("RGBA") if im.mode in ("P", "LA") else im
    rgb = im.convert("RGB")
    arr = np.asarray(rgb, dtype=np.float32)
    arr = arr.dot(hue_matrix3(hue).T)
    np.clip(arr, 0, 255, out=arr)
    rgb = Image.fromarray(arr.astype(np.uint8), "RGB")
    # rebuild alpha
    if im.mode == "RGBA":
        a = im.getchannel("A")
        im = rgb.convert("RGBA")
        im.putalpha(a)
    else:
        im = rgb
    im = ImageEnhance.Brightness(im).enhance(bright)
    im = ImageEnhance.Color(im).enhance(sat)
    im = ImageEnhance.Contrast(im).enhance(contrast)
    return im, (hue, bright, sat, contrast)


def main():
    files = []
    for root, _dirs, names in os.walk(MIRROR):
        for n in names:
            if n.lower().endswith(RASTER):
                files.append(os.path.join(root, n))
    print(f"raster files: {len(files)}")
    changed = 0
    for f in sorted(files):
        rel = os.path.relpath(f, MIRROR)
        base = re.sub(r"__[0-9a-f]{8}$", "", rel)  # query variants share seed
        seed = hashlib.sha1(base.encode()).digest()
        im = Image.open(f)
        try:
            varied, params = vary(im, seed)
            # keep original format/quality settings
            ext = os.path.splitext(f)[1].lower()
            if ext == ".webp":
                varied.save(f, "WEBP", quality=90, method=6)
            elif ext in (".jpg", ".jpeg"):
                varied.convert("RGB").save(f, "JPEG", quality=92, optimize=True)
            elif ext == ".png":
                varied.save(f, "PNG", optimize=True)
            elif ext == ".gif":
                varied.convert("P", palette=Image.ADAPTIVE).save(f, "GIF")
            else:
                varied.save(f)
            changed += 1
            print(f"  {rel}: hue={params[0]:+.1f} bright={params[1]:.3f} "
                  f"sat={params[2]:.3f} contrast={params[3]:.3f}")
        finally:
            im.close()
    print(f"varied: {changed}/{len(files)}")


if __name__ == "__main__":
    import re
    main()
