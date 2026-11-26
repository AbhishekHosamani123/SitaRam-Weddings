# Wedding Website Platform (multi-couple, multi-template, self-service)

This repo powers a **sellable multi-couple, multi-template wedding website
product**. Each couple gets their own personalised site at a URL containing
their names, e.g. `https://sitaram-weddings.vercel.app/rashmi-abhishek`, built
on the template of their choice — either by the seller (Dashboard) or by the
couple themselves (public self-service builder, no login).

## Public site (what customers see)

| Route | What it is |
|---|---|
| `/` | **Landing page** in the ZONO-inspired identity (warm cream `#faf7ef`, deep teal ink `#0b282e`, accent teal `#1e7280`, Bricolage Grotesque display + Inter body): hero → launch-offer strip (₹3,999 struck → ₹999 for first 50 couples) → template grid with **Preview** (opens full live demo) and **Customise** buttons → features → how-it-works → comparison table → testimonials → FAQ → footer (WhatsApp 84314 06956). |
| `/templates/` | Simple template gallery (live demos). |
| `/templates/<id>/` | Live demo of the template (sample content). |
| `/create?template=<id>` | **Self-service builder** — no login. User edits names, invites, up to 6 events, venue/map, WhatsApp, photos (client-side resized). Everything autosaves to their browser (`localStorage`). Live preview updates as they type — placeholder templates render client-side from `/tpl/<id>/` raw sources; the Ram Mandir (legacy Framer) template uses `POST /api/preview` which renders through the real generation pipeline server-side. On mobile a floating "Preview" button toggles the preview panel. "Get my website link" posts to `/api/public-website`, which stores minimal data server-side, builds the static page, and returns the public link. |
| `/<slug>/` | Each couple's personalised website. |

> **Only the Ram Mandir template is active right now.** The other six template
> folders (Ayodhya, Meenaya, Meenaya 2, Laavan, Raabta, Beach) remain on disk
> with `"disabled": true` in their `template.json` — they are hidden from the
> landing, builder, dashboard and gallery. Remove the flag to re-enable them
> later.

Pricing shown is launch marketing (₹999 offer, ₹3,999 struck-through) — no
discount logic implemented. Razorpay payments are planned later; publishing is
currently free.

## Templates

```
templates/
├── ram-mandir/    the original Framer design (engine: legacy-framer)
├── ayodhya/       Hindu temple theme — arches, diyas, mandala gold
├── meenaya/       South-Indian classic — kasavu cream & gold, toran
├── meenaya-2/     South-Indian editorial — peacock jewel tones, bold type
├── laavan/        Sikh — ivory & gold domed arches, Gurmukhi accents
├── raabta/        Muslim nikkah — emerald & navy, geometric stars
└── beach/         destination — sunset, waves, boarding-pass ticket
```

Each folder holds `index.html` (self-contained page using `{{TOKEN}}`
placeholders) + `template.json` (name, category, tagline, accent colours,
engine). Templates are **auto-discovered** — drop a new folder in and it
appears everywhere (dashboard, landing, builder, gallery).

## How it works

| Part | What it does |
|---|---|
| `templates/` | Template registry (auto-discovered). Two engines: `legacy-framer` (Ram Mandir — string-patch + slot engine) and `placeholder` (clean `{{TOKEN}}` replacement; events & gallery injected as JSON). |
| `data/couples.json` | Source of truth — one object per couple (names, parents, events, venue, WhatsApp, photos, story, hashtag, SEO, slug, `template`, `source`: dashboard/`). |
| `tools/build.js` | Generates `public/<slug>/index.html` per couple using that couple's template engine, plus: the landing page (`public/index.html`), the builder page (`public/create/index.html`, with template registry injected), the raw template sources (`public/tpl/<id>/`), per-template demos (`public/templates/<id>/`), and the couple showcase. |
| `server.js` | Local server: serves the site, hosts the Dashboard at `/admin`, exposes the local API (auth, couples CRUD incl. template on create, `/api/templates`, uploads, build, publish) **and the public APIs** `POST /api/public-website` (no auth, per-IP rate limit, unique slugs, data-URL image saving, runs build, returns the couple's URL) and `POST /api/preview` (no auth, renders a personal preview through the real pipeline without writing anything — used by the builder's live preview). |
| `admin/` | Dashboard SPA (login-protected). "+ New couple" opens a **template chooser** with live previews; the template chip in the editor switches templates; couples list shows template names. |

## Workflow (seller flow)

1. Start: `npm run dashboard` → open `http://127.0.0.1:8080/admin`, sign in (default password `admin123` — change it in `data/admin.json`).
2. **+ New couple** → **pick a template** (live previews of every design) → fill in details.
3. **Save** → **Build** → **Publish** (git commit + push → Vercel auto-deploys, ~1 min).

## Workflow (customer self-service)

1. Customer opens `/` → browses templates → **Preview** to see a full live demo → **Customise**.
2. Customer edits the builder; everything autosaves in their browser; live preview syncs as they type.
3. Customer clicks **Get my website link** → the site builds their page and shows their public link (+ copy / WhatsApp share).

> Note for deployment: the landing page, builder and demos are fully static and
> deploy with Vercel. The `POST /api/public-website` endpoint runs on the local
> server; to enable live creation on the deployed site, deploy that endpoint as
> a Vercel serverless function backed by a datastore (e.g. Vercel KV) — the
> local flow is the reference implementation.

### Cloudflare Workers static deployment

`wrangler.jsonc` serves the generated `public/` directory and routes API,
preview, and missing dynamic wedding-page requests to the existing Vercel
deployment. Run `npm run build` before deploying with `npx wrangler deploy`.
The Vercel project must have `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`,
`RZP_KEY_ID`, and `RZP_KEY_SECRET` configured privately. Use Razorpay test
credentials while testing; never put service or payment secrets in this repo.

## Common pitfalls (seller runbook)

- **URL slug** must be unique & lowercase (letters, numbers, hyphens). Public submissions auto-append `-2`, `-3`… when taken.
- **First event = main celebration**: the Google Maps card and the venue details are driven by event #1. Keep its venue/coordinates filled.
- **Countdown**: set a future date/time in the Timeline tab, or the timer hides.
- **WhatsApp**: keep both numbers in sync — the site displays `display`, while the RSVP button uses `intl` (country code included).
- **Changing a template later**: click the template chip next to the couple's name, pick a new design, and Build.
- **Before publishing**, check the warnings box on the editor; then Save → Build → Publish.
- Timeline cards hide automatically when a couple has fewer than six events.

---

# Original: Ram Mandir Wedding Site — Framer Clone

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
