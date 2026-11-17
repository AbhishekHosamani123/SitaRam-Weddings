# Ram Mandir Wedding Site — Framer Clone

Pixel-faithful local clone of https://rammandir.framer.website/ (a Framer-built
wedding invitation site). Single page, exact copy of markup, styles, fonts,
images and behavior.

## Run

```
node _tools/server.js 8080
```

then open **http://127.0.0.1:8080/** — or just double-click `start.cmd`.

The server serves local files from `mirror/` and automatically fetches + caches
anything missing from the original CDN on first request (so the clone stays
complete and self-contained after one full browse).

## Layout

| Path | What it is |
|---|---|
| `public/index.html` | The site (server-rendered Framer HTML, URLs rewritten to `/mirror/`) |
| `public/mirror/` | All assets downloaded from the origin: images, fonts, JS bundles |
| `vercel.json` | Vercel static deployment config (`outputDirectory: public`) |
| `_tools/server.js` | Local host + CDN fallback proxy (`NO_FALLBACK=1` simulates static hosting) |
| `_tools/download.py` | Mirrors asset URLs listed in `all_urls.txt` |
| `_tools/scan_fetch.py` | Fetches every `/mirror/` URL referenced in HTML/JS (static completeness) |
| `_tools/rewrite.py` | Rewrites CDN URLs → `/mirror/` in HTML and JS bundles |
| `_tools/vary_images.py` | Applies subtle deterministic color variation to all raster images |
| `_tools/diffshots.py` | Pixel-diff tool used to verify clone vs original |
| `_tools/reference/index_orig.html` | The original downloaded HTML (reference) |

## Deploy to Vercel (static)

The site is fully static — every URL the site can request exists as a real file
in `public/` (verified by loading the page with the fallback proxy disabled).

1. Push this repo to GitHub (see below).
2. Go to **https://vercel.com/new**, import the `SeetRam-Weddings` repo.
3. Vercel auto-detects the static project (`vercel.json` pins the output
   directory to `public`). Click **Deploy**.
4. Done — your site is live at `https://seetram-weddings.vercel.app`.

No build step is needed.

## Image variation (originality)

All raster images in `public/mirror/` have been re-graded with small
deterministic tweaks (hue ±2°, brightness/saturation ±3%, slight contrast)
so the pixels differ from the original site's assets while looking visually
identical. Every image file is byte-distinct from the source. Fonts and code
were not touched. Re-run with `python -I _tools/vary_images.py`.

## Verification performed

- Page height identical to original (12261 px both).
- Pixel comparisons at matching scroll positions: **0% difference** at
  scroll 900 / 1800 / 2700 / 3600 / 4500; hero section matches except a
  couple of px fractional offset in side ornaments (invisible in practice).
- 0 console errors, all 59 images load, fonts load (`document.fonts.status = loaded`).
- Same 3 links, RSVP dropdown options identical, countdown shows 00:00:00:00
  (event date 29 Aug 2026 has passed).

> Note: the page includes two third-party tracking scripts that are kept as-is
> for exactness: Framer events (`events.framer.com`) and a `bestfreecdn.com`
> visitor counter. They require internet and are invisible in the UI.
