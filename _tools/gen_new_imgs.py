#!/usr/bin/env python
"""
Regenerate the three clone images as NEW original artwork (copyright-distinct):

  A) IxbRblgZX2YiN0xuANY2jX4Excg  (1515x3552) -> tall gilded ornamental column
  B) q34vGrlWel2dWqX5zDNWJQDl9k  (1515x5593) -> cream page backdrop w/ ink temple crest
  C) ECYGxlUfN1A1OmbaiTl8iogMeVk (1515x1646) -> elephant scene recolored to white/ivory

Outputs land in  new-web/public/mirror/framerusercontent.com/images/nw/
Everything drawn at 2x supersampling then downscaled for smooth edges.
"""
import os
from PIL import Image, ImageDraw, ImageFilter

OUT = r"D:\Wedding website\new web\public\mirror\framerusercontent.com\images\nw"
os.makedirs(OUT, exist_ok=True)
SS = 2  # supersample factor

# site palette (derived from the theme)
GOLD = (226, 191, 136)
GOLD_LT = (238, 211, 166)
BRONZE = (140, 94, 48)
BRONZE_DK = (94, 60, 28)
MAROON = (123, 45, 38)
CREAM = (255, 240, 229)
INK = (58, 35, 24)
IVORY = (245, 239, 230)


def canvas(w, h, fill):
    return Image.new("RGBA", (w * SS, h * SS), fill + (255,) if len(fill) == 3 else fill)


def finish(im, w, h):
    return im.resize((w, h), Image.LANCZOS)


# ---------------------------------------------------------------- A: gold column
def gen_gold_column():
    W, H = 1515, 3552
    im = canvas(W, H, GOLD)
    d = ImageDraw.Draw(im)
    S = SS
    # --- gentle vertical sheen (light stripes) ---
    for x in range(0, W * S, 24):
        d.line([(x, 0), (x, H * S)], fill=(255, 250, 235, 18), width=10)
    # --- top deep-bronze cap with hanging bells ---
    cap_h = 620 * S
    d.rectangle([0, 0, W * S, cap_h], fill=BRONZE_DK + (255,))
    # gold rim under the cap
    d.rectangle([0, cap_h, W * S, cap_h + 26 * S], fill=GOLD_LT + (255,))
    d.rectangle([0, cap_h + 26 * S, W * S, cap_h + 52 * S], fill=BRONZE + (255,))
    # bells: row of half-circles
    bell_w = 150 * S
    for i in range(10):
        cx = (i + 0.5) * (W * S / 10)
        d.ellipse([cx - bell_w / 2, 40 * S, cx + bell_w / 2, 40 * S + bell_w],
                  fill=GOLD + (255,), outline=BRONZE_DK + (255,), width=8 * S)
        d.line([(cx, 40 * S + bell_w), (cx, 40 * S + bell_w + 70 * S)],
               fill=GOLD_LT + (255,), width=10 * S)
        d.ellipse([cx - 26 * S, 40 * S + bell_w + 70 * S, cx + 26 * S, 40 * S + bell_w + 130 * S],
                  fill=BRONZE + (255,), outline=GOLD + (255,), width=6 * S)
    # --- central ornament: 3 medallions ---
    med_ys = [cap_h + 480 * S, cap_h + 1430 * S, cap_h + 2380 * S]
    med_r = 300 * S
    for my in med_ys:
        # outer ring
        d.ellipse([W * S / 2 - med_r, my - med_r, W * S / 2 + med_r, my + med_r],
                  outline=BRONZE + (255,), width=18 * S)
        d.ellipse([W * S / 2 - med_r + 40 * S, my - med_r + 40 * S,
                   W * S / 2 + med_r - 40 * S, my + med_r - 40 * S],
                  outline=GOLD_LT + (255,), width=8 * S)
        # lotus petals (small ellipses around center)
        for k in range(12):
            ang = k * 30
            import math
            a = math.radians(ang)
            px = W * S / 2 + math.cos(a) * med_r * 0.62
            py = my + math.sin(a) * med_r * 0.62
            d.ellipse([px - 34 * S, py - 66 * S, px + 34 * S, py + 66 * S],
                      fill=BRONZE + (255,))
        d.ellipse([W * S / 2 - 130 * S, my - 130 * S, W * S / 2 + 130 * S, my + 130 * S],
                  fill=GOLD_LT + (255,), outline=BRONZE_DK + (255,), width=10 * S)
        d.ellipse([W * S / 2 - 76 * S, my - 76 * S, W * S / 2 + 76 * S, my + 76 * S],
                  fill=BRONZE + (255,))
    # side railings: chevron chain
    rail_x = 120 * S
    for y in range(cap_h + 200 * S, H * S - 400 * S, 160 * S):
        d.line([(rail_x, y), (rail_x + 90 * S, y + 45 * S), (rail_x, y + 90 * S)],
               fill=BRONZE + (255,), width=12 * S)
        d.line([(W * S - rail_x, y), (W * S - rail_x - 90 * S, y + 45 * S),
                (W * S - rail_x, y + 90 * S)], fill=BRONZE + (255,), width=12 * S)
    # --- base band ---
    base_y = H * S - 420 * S
    d.rectangle([0, base_y, W * S, H * S], fill=BRONZE_DK + (255,))
    d.rectangle([0, base_y - 30 * S, W * S, base_y], fill=GOLD_LT + (255,))
    # kalash fringe
    for i in range(15):
        cx = (i + 0.5) * (W * S / 15)
        d.ellipse([cx - 60 * S, base_y + 60 * S, cx + 60 * S, base_y + 180 * S],
                  fill=GOLD + (255,), outline=BRONZE + (255,), width=6 * S)
        d.polygon([(cx - 34 * S, base_y + 60 * S), (cx + 34 * S, base_y + 60 * S),
                   (cx, base_y + 10 * S)], fill=GOLD_LT + (255,))
    finish(im, W, H).save(os.path.join(OUT, "nw_gold_col_3552.webp"), quality=92)
    print("A saved")


# ---------------------------------------------------------------- B: cream backdrop
def gen_cream_backdrop():
    W, H = 1515, 5593
    im = canvas(W, H, CREAM)
    d = ImageDraw.Draw(im)
    S = SS
    ink = INK + (255,)
    gold = GOLD + (255,)
    thin = 8 * S

    # ---- top crest area (~upper 34%) ----
    crest_h = int(H * 0.34) * S
    cx = W * S / 2

    # central temple tower (shikhara) silhouette
    def tower(base_y, width, h, color):
        half = width / 2
        # stepped tiers
        tiers = 6
        for t in range(tiers):
            y0 = base_y - (t + 1) * h / tiers
            y1 = base_y - t * h / tiers
            inset = (t / tiers) * half * 0.55
            d.polygon([(cx - half + inset, y1), (cx + half - inset, y1),
                       (cx + half - inset + 60 * S, y0), (cx - half + inset - 60 * S, y0)],
                      fill=color)
        # apex kalash
        ay = base_y - h - 90 * S
        d.ellipse([cx - 55 * S, ay, cx + 55 * S, ay + 110 * S], fill=color)
        d.polygon([(cx - 46 * S, ay + 110 * S), (cx + 46 * S, ay + 110 * S), (cx, ay + 30 * S)],
                  fill=color)

    tower(980 * S, 760 * S, 1500 * S, ink)
    # flanking minar-style finials
    for sgn in (-1, 1):
        fx = cx + sgn * 640 * S
        d.rectangle([fx - 34 * S, 980 * S - 1150 * S, fx + 34 * S, 980 * S], fill=ink)
        d.ellipse([fx - 70 * S, 980 * S - 1150 * S - 90 * S, fx + 70 * S, 980 * S - 1150 * S],
                  fill=ink)
        d.polygon([(fx - 58 * S, 980 * S - 1150 * S - 90 * S), (fx + 58 * S, 980 * S - 1150 * S - 90 * S),
                   (fx, 980 * S - 1150 * S - 170 * S)], fill=ink)
    # arches under tower
    d.arc([cx - 520 * S, 980 * S, cx + 520 * S, 1620 * S], 180, 360, fill=ink, width=thin)
    d.line([(cx - 520 * S, 1620 * S), (cx - 520 * S, 1750 * S)], fill=ink, width=thin)
    d.line([(cx + 520 * S, 1620 * S), (cx + 520 * S, 1750 * S)], fill=ink, width=thin)
    # hanging bells from the arch
    for bx in (cx - 300 * S, cx + 300 * S):
        d.line([(bx, 1300 * S), (bx, 1440 * S)], fill=ink, width=6 * S)
        d.ellipse([bx - 40 * S, 1440 * S, bx + 40 * S, 1530 * S], fill=ink)
    # ground line & scalloped trim
    d.rectangle([0, 1750 * S, W * S, 1820 * S], fill=ink)
    for i in range(20):
        x0 = i * (W * S / 20)
        d.arc([x0, 1820 * S, x0 + W * S / 20, 1960 * S], 180, 360, fill=ink, width=thin)
    # corner ornaments
    curl_r = 200 * S
    d.arc([0, 0, curl_r * 2, curl_r * 2], 180, 270, fill=gold, width=14 * S)
    d.arc([W * S - curl_r * 2, 0, W * S, curl_r * 2], 270, 360, fill=gold, width=14 * S)
    # fine gold rules under crest
    d.rectangle([W * S * 0.12, 2040 * S, W * S * 0.88, 2056 * S], fill=gold)
    d.rectangle([W * S * 0.2, 2090 * S, W * S * 0.8, 2102 * S], fill=gold)
    # faint bottom paisley mark
    py = H * S - 900 * S
    d.ellipse([cx - 320 * S, py - 160 * S, cx + 320 * S, py + 160 * S],
              outline=(210, 186, 168, 120), width=12 * S)
    d.ellipse([cx - 180 * S, py - 90 * S, cx + 180 * S, py + 90 * S],
              outline=(210, 186, 168, 90), width=8 * S)
    finish(im, W, H).save(os.path.join(OUT, "nw_cream_art_5593.webp"), quality=92)
    print("B saved")


# ---------------------------------------------------------------- C: elephant→white
def gen_elephant_white():
    src = r"D:\Wedding website\Framer\public\mirror\framerusercontent.com\images\ECYGxlUfN1A1OmbaiTl8iogMeVk.webp"
    img = Image.open(src).convert("RGBA")
    W, H = img.size
    px = img.load()
    # try numpy for speed
    try:
        import numpy as np
        arr = np.array(img).astype(np.float32) / 255.0
        r, g, b, a = arr[..., 0], arr[..., 1], arr[..., 2], arr[..., 3]
        mx = np.maximum(np.maximum(r, g), b)
        mn = np.minimum(np.minimum(r, g), b)
        v = mx
        s = np.where(mx > 1e-6, (mx - mn) / np.maximum(mx, 1e-6), 0)
        # subject: medium-luminance, low-to-mid saturation (elephant grey/tan skin)
        mask = (v > 0.13) & (v < 0.86) & (s < 0.62) & (a > 0.5)
        # recolor to ivory, preserving value variation
        target = np.array(IVORY, dtype=np.float32) / 255.0
        scale = 0.72 + 0.45 * v  # keep shading
        new = target * scale[..., None]
        # blend to avoid harsh seams
        m = mask.astype(np.float32)
        m = np.where(mask, 1.0, 0.0)
        # simple feather via box blur
        from PIL import ImageFilter as _f
        mask_img = Image.fromarray((m * 255).astype("uint8")).filter(_f.GaussianBlur(4))
        m = np.array(mask_img).astype(np.float32) / 255.0
        arr[..., 0] = arr[..., 0] * (1 - m) + new[..., 0] * m
        arr[..., 1] = arr[..., 1] * (1 - m) + new[..., 1] * m
        arr[..., 2] = arr[..., 2] * (1 - m) + new[..., 2] * m
        out = Image.fromarray((np.clip(arr, 0, 1) * 255).astype("uint8"), "RGBA")
    except ImportError:
        out = img
        print("numpy unavailable — elephant recolor skipped (fallback = original)")
    out.save(os.path.join(OUT, "nw_elephant_white_1646.webp"), quality=92)
    print("C saved")


if __name__ == "__main__":
    gen_gold_column()
    gen_cream_backdrop()
    gen_elephant_white()
    print("output dir:", OUT)
