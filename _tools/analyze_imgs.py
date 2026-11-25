#!/usr/bin/env python
"""Brief structural analysis of the three clone images (no external deps beyond Pillow)."""
import sys
from collections import Counter
from PIL import Image, ImageStat

IMGS = [
    r"D:\Wedding website\Framer\public\mirror\framerusercontent.com\images\IxbRblgZX2YiN0xuANY2jX4Excg.webp",
    r"D:\Wedding website\Framer\public\mirror\framerusercontent.com\images\q34vGrlWel2dWqX5zDNWJQDl9k.webp",
    r"D:\Wedding website\Framer\public\mirror\framerusercontent.com\images\ECYGxlUfN1A1OmbaiTl8iogMeVk.webp",
]


def summarize(path):
    img = Image.open(path)
    img.load()
    print(f"\n=== {path.split(chr(92))[-1]} ===")
    print("format:", img.format, "mode:", img.mode, "size:", img.size)
    # quantization of the dominant colours
    small = img.convert("RGB").resize((120, 120))
    cols = Counter(small.getdata())
    total = 120 * 120
    print("top-8 colours (share %):")
    for (c, n) in cols.most_common(8):
        print(f"   rgb{c}  {100*n/total:.1f}%")
    # vertical thirds mean brightness (L = mean of RGB)
    w, h = img.size
    for name, box in (("top", (0, 0, w, h // 3)),
                      ("middle", (0, h // 3, w, 2 * h // 3)),
                      ("bottom", (0, 2 * h // 3, w, h))):
        st = ImageStat.Stat(img.convert("RGB").crop(box))
        avg = [round(v) for v in st.mean]
        print(f"   {name:6s} avgRGB {avg}  stddev {[round(v) for v in st.stddev]}")


if __name__ == "__main__":
    for p in IMGS:
        summarize(p)
