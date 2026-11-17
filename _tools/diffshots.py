#!/usr/bin/env python3
"""Compare clone vs original screenshots tile-by-tile.

For each scroll offset pair (clone_Y.png vs orig_Y.png):
  - prints sizes and tile-level stats
  - reports % of tiles with avg abs channel diff > threshold
  - prints top differing tile regions (for manual review)
"""
import os
import sys
from PIL import Image

SHOTS = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "_tools", "shots")
OFFSETS = [0, 900, 1800, 2700, 3600, 4500, 5400]
TILE = 24
THRESH = 12  # avg per-channel diff that counts as "different tile"
DIFF_FRAC_ALERT = 0.02


def tile_diff(a, b):
    """Mean absolute per-channel difference over a tile box."""
    pa = a.load()
    pb = b.load()
    total = 0
    n = 0
    for x in range(0, a.width, 2):  # sample every 2nd px for speed
        for y in range(0, a.height, 2):
            ca = pa[x, y]
            cb = pb[x, y]
            total += abs(ca[0] - cb[0]) + abs(ca[1] - cb[1]) + abs(ca[2] - cb[2])
            n += 3
    return total / n


def main():
    for off in OFFSETS:
        c = os.path.join(SHOTS, f"clone_{off}.png")
        o = os.path.join(SHOTS, f"orig_{off}.png")
        if not (os.path.exists(c) and os.path.exists(o)):
            print(f"[{off}] missing pair (clone={os.path.exists(c)}, orig={os.path.exists(o)})")
            continue
        ic = Image.open(c).convert("RGB")
        io = Image.open(o).convert("RGB")
        if ic.size != io.size:
            print(f"[{off}] SIZE MISMATCH: clone {ic.size} vs orig {io.size}")
            continue
        W, H = ic.size
        diff_tiles = []
        for ty in range(0, H, TILE):
            for tx in range(0, W, TILE):
                box = (tx, ty, min(tx + TILE, W), min(ty + TILE, H))
                d = tile_diff(ic.crop(box), io.crop(box))
                if d > THRESH:
                    diff_tiles.append((tx, ty, d))
        total_tiles = ((W + TILE - 1) // TILE) * ((H + TILE - 1) // TILE)
        frac = len(diff_tiles) / total_tiles
        avg = sum(d for _, _, d in diff_tiles) / max(1, len(diff_tiles))
        status = "OK" if frac < DIFF_FRAC_ALERT else "DIVERGE"
        print(f"[{off}] {W}x{H} diff_tiles={len(diff_tiles)}/{total_tiles} "
              f"({frac:.1%}) avg_diff={avg:.1f} -> {status}")
        if frac >= DIFF_FRAC_ALERT:
            # report the biggest tiles, clustered by row band
            diff_tiles.sort(key=lambda t: -t[2])
            bands = {}
            for tx, ty, d in diff_tiles[:60]:
                bands.setdefault(ty // 200, []).append((tx, ty, round(d, 1)))
            for band, items in sorted(bands.items()):
                print(f"    band y={band*200}-{band*200+199}: {len(items)} hot tiles, e.g. {items[:6]}")


if __name__ == "__main__":
    main()
