#!/usr/bin/env python3
"""Fix every image that 404s on Vercel:

1. Waving flag texture: create bare Mr5CWcNPJMlbL9TvpxtjbiK8yo.png
   (copied from the sha1-verified query variant on disk).
2. Rotating gallery: copy the 5 existing unsplash variants to
   photo-XXX.jpg (proper extension) and download the 6th (missing).
3. Photo-gallery hero image 72XoQ...jpg: copy the identical variant
   from the root project's assets.
4. Gradient image GfGkA...jpg: download from the CDN.
5. socialImage 3Jek...webp: also place under assets/ (bundle path).
6. Rewrite unsplash URLs (query form -> .jpg) in index.html + shared-lib.
"""
import hashlib
import os
import re
import shutil
import sys
import urllib.request

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

PUB = r"D:\Wedding website\Framer\public"
MIR = os.path.join(PUB, "mirror")
IMGS = os.path.join(MIR, "framerusercontent.com", "images")
ASSETS = os.path.join(MIR, "framerusercontent.com", "assets")
UNSPL = os.path.join(MIR, "images.unsplash.com")

UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36")


def h8(q):
    return hashlib.sha1(q.encode()).hexdigest()[:8]


def download(url, dest):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=60) as r, open(dest + ".part", "wb") as f:
        while True:
            chunk = r.read(65536)
            if not chunk:
                break
            f.write(chunk)
    os.replace(dest + ".part", dest)


# ---------- 1. flag ----------
FLAG = "Mr5CWcNPJMlbL9TvpxtjbiK8yo"
q_main = "width=700&height=413"
q_small = "scale-down-to=512&width=700&height=413"
src_main = os.path.join(IMGS, f"{FLAG}.png__{h8(q_main)}")
src_small = os.path.join(IMGS, f"{FLAG}.png__{h8(q_small)}")
print("flag: main variant file exists:", os.path.isfile(src_main),
      "| small variant exists:", os.path.isfile(src_small))
if os.path.isfile(src_main):
    dst = os.path.join(IMGS, f"{FLAG}.png")
    shutil.copyfile(src_main, dst)
    print("flag bare png created:", dst, os.path.getsize(dst), "bytes")

# ---------- 2. unsplash gallery ----------
PHOTOS = [
    "photo-1506744038136-46273834b3fb",
    "photo-1469474968028-56623f02e42e",
    "photo-1447752875215-b2761acb3c5d",
    "photo-1433086966358-54859d0ed716",
    "photo-1470071459604-3b5ec3a7fe05",
    "photo-1441974231531-c6227db76b6e",  # missing entirely - download
]
uq = "w=400&h=400&fit=crop"
print("unsplash expected hash suffix:", h8(uq))
for ph in PHOTOS:
    dst = os.path.join(UNSPL, ph + ".jpg")
    variant = os.path.join(UNSPL, ph + "__" + h8(uq))
    if os.path.isfile(variant):
        shutil.copyfile(variant, dst)
        print(f"gallery {ph}.jpg copied from variant ({os.path.getsize(dst)} bytes)")
    elif not os.path.isfile(dst):
        url = f"https://images.unsplash.com/{ph}?{uq}"
        try:
            download(url, dst)
            print(f"gallery {ph}.jpg DOWNLOADED ({os.path.getsize(dst)} bytes)")
        except Exception as e:
            print(f"gallery {ph}: DOWNLOAD FAILED: {e}")

# ---------- 3. 72XoQ photo-gallery image ----------
P72 = "72XoQPUGMzuAK0nUiljwSxGw2HA"
root_src = (r"D:\Wedding website\assets\framerusercontent.com\images"
            "\\" + P72 + "@width-4672__height-7008.jpg")
dst72 = os.path.join(IMGS, P72 + ".jpg")
if os.path.isfile(root_src) and not os.path.isfile(dst72):
    shutil.copyfile(root_src, dst72)
    print(f"{P72}.jpg copied from root project ({os.path.getsize(dst72)} bytes)")
elif os.path.isfile(dst72):
    print(f"{P72}.jpg already exists")
else:
    print(f"{P72}: root source missing - needs download")

# ---------- 4. gradient ----------
GR = "GfGkADagM4KEibNcIiRUWlfrR0"
dstg = os.path.join(IMGS, GR + ".jpg")
if not os.path.isfile(dstg):
    try:
        download(f"https://framerusercontent.com/images/{GR}.jpg", dstg)
        print(f"{GR}.jpg downloaded ({os.path.getsize(dstg)} bytes)")
    except Exception as e:
        print(f"{GR}: download failed: {e}")
else:
    print(f"{GR}.jpg already exists")

# ---------- 5. socialImage under assets/ ----------
sj = os.path.join(IMGS, "3JekLBRwVWegsCm3gX3wOcYeM.webp")
dj = os.path.join(ASSETS, "3JekLBRwVWegsCm3gX3wOcYeM.webp")
if os.path.isfile(sj) and not os.path.isfile(dj):
    shutil.copyfile(sj, dj)
    print("socialImage copied to assets/")

# ---------- 6. rewrite unsplash URLs ----------
for path, esc in ((os.path.join(PUB, "index.html"), True),
                  (os.path.join(MIR, "framerusercontent.com", "sites",
                                "1Jnwf2uoy3TohI0oOnOtPi", "shared-lib.DDe1d4ZQ.mjs"),
                   False)):
    c = open(path, encoding="utf-8", newline="").read()
    amp = "&amp;" if esc else "&"
    n = 0
    for ph in PHOTOS:
        old = f"/mirror/images.unsplash.com/{ph}?{uq.replace('&', amp)}"
        new = f"/mirror/images.unsplash.com/{ph}.jpg"
        n += c.count(old)
        c = c.replace(old, new)
    open(path, "w", encoding="utf-8", newline="").write(c)
    print(f"rewrote {n} unsplash URLs in {os.path.basename(path)}")
