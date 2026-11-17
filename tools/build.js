#!/usr/bin/env node
/**
 * Wedding-site static generator.
 *
 * Reads data/couples.json and renders one fully static page per active couple:
 *   public/<slug>/index.html
 * plus a showcase listing at public/couples/index.html.
 *
 * The current site (public/index.html) is the master template: couple-specific
 * text, images, countdown target, WhatsApp number, venue map data and search
 * metadata are swapped in, and the two data-carrying JS bundles (page config +
 * bootloader) are copied per slug with the same values patched.
 *
 * Run: node tools/build.js
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const PUBLIC = path.join(ROOT, "public");
const DATA = path.join(ROOT, "data");
const IMG_DIR = path.join(PUBLIC, "mirror", "framerusercontent.com", "images");
const SITES_DIR = path.join(PUBLIC, "mirror", "framerusercontent.com", "sites", "1Jnwf2uoy3TohI0oOnOtPi");
const PAGE_BUNDLE = "VR998DU3WSRaZIpYrcWhMoQxMWGXSrJFDK6jx2eUMjE.DKHZzuKc.v3.mjs";
const MAIN_BUNDLE = "script_main.BNALTGIK.v3.mjs";
const SITE_URL = "https://sitaram-weddings.vercel.app";

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------
function read(p) { return fs.readFileSync(p, "utf8"); }
function write(p, s) { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, s); }

function safeSlug(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "couple";
}

/** apply ordered [from,to] rules; collect misses */
function applyRules(src, rules) {
  let out = src;
  const missing = [];
  for (const [from, to] of rules) {
    if (from === to) continue;
    if (!out.includes(from)) { missing.push(from); continue; }
    out = out.split(from).join(to);
  }
  return { out, missing };
}

/** Replace the whole backtick-quoted `text:` value containing the anchor (story text). */
function replaceBacktickValue(src, anchor, replacement) {
  const esc = anchor.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp("text:`[^`]*?" + esc + "[^`]*`", "g");
  return src.replace(re, "text:`" + replacement + "`");
}

// ---------------------------------------------------------------------------
// token rules
// ---------------------------------------------------------------------------
function commonRules(c) {
  const r = [];
  const ev = c.event || {};
  const wa = c.whatsapp || {};
  const inv = c.invitation || {};

  // -- head / canonical handled in metaRules() (applied to every page) --

  // -- event card --
  r.push(["29th Aug 2026", ev.dateLabel || "29th Aug 2026"]);
  r.push(["6 Pm Onwards", ev.time || "6 Pm Onwards"]);
  r.push(["Friday", ev.day || "Friday"]);
  r.push(["Pune, Maharashtra", ev.city || "Pune, Maharashtra"]);
  r.push(["Shaadi", ev.name || "Shaadi"]);
  r.push(["2026-09-28T00:00:00.000Z", c.countdownTarget || "2026-09-28T00:00:00.000Z"]);

  // -- venue / map --
  if (ev.venueName) r.push(["Venue Name", ev.venueName]);
  if (ev.venueAddress) {
    r.push(["Full street address, city, state, ZIP", ev.venueAddress]);
    r.push(["Full street address", ev.venueAddress]);
  }
  if (ev.lat && ev.lng) {
    r.push([`19.2183%2C%2072.9781`, `${ev.lat}%2C%20${ev.lng}`]);
    r.push(["19.2183, 72.9781", `${ev.lat}, ${ev.lng}`]);
    r.push(["19.0760, 72.8777", `${ev.lat}, ${ev.lng}`]);
    r.push(["19.2183", ev.lat]);
    r.push(["19.0760", ev.lat]);
    r.push(["72.9781", ev.lng]);
    r.push(["72.8777", ev.lng]);
  }
  // address subtext block (contains venue line + phone) — replace whole block
  if (ev.venueName && wa.display) {
    const block = "M10\ngeomatrix\nsilver crest kamote \n9819200906";
    const repl = `${ev.venueName}\n${wa.display}`;
    r.push([block, repl]);
  }

  // -- whatsapp --
  if (wa.display) r.push(["9819200906", wa.display]);
  if (wa.intl) r.push(["919819200906", wa.intl]);

  // -- invitation texts --
  if (inv.intro) r.push(["Cordially request the honor of your presence at the wedding celebration of", inv.intro]);
  if (inv.closing) r.push(["Looking forward to see you", inv.closing]);
  if (inv.hashtag) {
    r.push([`the hashtag - #abkan`, `the hashtag - #${inv.hashtag}`]);
  }

  // -- things to know --
  const ttk = {};
  for (const t of (c.thingsToKnow || [])) ttk[t.key] = t.text;
  if (ttk.weather) r.push(["It will be mostly sunny with temperature reaching up to 28 degrees at the venue", ttk.weather]);
  if (ttk.staff) r.push(["We recommend the nearby hotel called Bhola Bhawan near the venue for the staff members", ttk.staff]);
  if (ttk.parking) r.push(["Valet parking for all our guests will be available at the venue", ttk.parking]);

  return r;
}

/**
 * Name/parent swaps are context-sensitive:
 *  - in bundles, node text lives in backtick-quoted props (`children:`Sita``)
 *  - in HTML, node text appears at element boundaries (">Sita<")
 * This avoids touching URLs, slugs, layer names or CSS.
 */
function applyNames(src, c) {
  let out = src;
  const b = c.bride.firstName, g = c.groom.firstName;
  out = out.split("`Sita`").join("`" + b + "`").split(">Sita<").join(">" + b + "<");
  out = out.split("`Ram`").join("`" + g + "`").split(">Ram<").join(">" + g + "<");
  return out;
}

/** Keep Framer layer names (invisible) consistent with the couple's names. */
function applyLayerNames(src, c) {
  let out = src;
  // HTML uses a real em dash; the bundle carries it mojibake'd (â€”).
  for (const dash of [" — ", "â€” "]) {
    out = out.split(dash + "Sita").join(dash + c.bride.firstName);
    out = out.split(dash + "Ram").join(dash + c.groom.firstName);
  }
  return out;
}

function applyParents(src, parents) {
  let out = src;
  if (!parents) return out;
  out = out.split("Shri. Rajmani Pathak &amp; Smt. Ambika Pathak").join(parents.replace(/&/g, "&amp;"));
  out = out.split("Shri. Rajmani Pathak & Smt. Ambika Pathak").join(parents);
  return out;
}

const IMG_SLOTS = {
  hero: [
    "ELVgHUKqtqAl9gf1nwbYhSeTg.webp",
    "qTlCAkdnbuZVEx4RAWSlgsGHX0.webp",
    "BYAsD8Youh2KSQp1YWLBPEg8U.webp",
    "w2VucNwOfPZvxA8ibgdnaWF7T4.webp",
  ],
  bridePhoto: [
    "jv9Y5c65dupWuUvOrLUvDm6o.webp",
    "UmHP4DGOVhAoz2Wx4tcMvgZoBc.webp",
  ],
  groomPhoto: [
    "WAxILXJh5vxiTnOtbAVwuxo0PsQ.webp",
    "vo85LJWiG7KY5sTcDsBhG1aEc.webp",
  ],
  portrait: ["nGPy0RPGbGwAd8w8op4XKveKWM.webp"],
};

const GALLERY_TOKENS = [
  "photo-1506744038136-46273834b3fb.jpg",
  "photo-1470071459604-3b5ec3a7fe05.jpg",
  "photo-1469474968028-56623f02e42e.jpg",
  "photo-1447752875215-b2761acb3c5d.jpg",
  "photo-1433086966358-54859d0ed716.jpg",
];

function imageRules(c) {
  const r = [];
  const imgs = c.images || {};
  const slug = c.slug;
  for (const [slot, files] of Object.entries(IMG_SLOTS)) {
    const url = imgs[slot];
    if (!url) continue;
    // url is like /mirror/framerusercontent.com/images/couples/<slug>/<slot>.<ext>
    const rel = url.replace(/^\/mirror\/framerusercontent\.com\/images\//, "");
    for (const f of files) r.push([f, rel]);
  }
  (c.gallery || []).forEach((g, i) => {
    const token = GALLERY_TOKENS[i];
    if (!g || !token) return;
    const rel = g.replace(/^\/mirror\/framerusercontent\.com\/images\//, "");
    r.push([token, rel]);
  });
  return r;
}

function metaRules(c) {
  const r = [];
  const desc = c.metaDescription || `Join us to celebrate the wedding of ${c.bride.firstName} & ${c.groom.firstName}.`;
  r.push(["A beautifully crafted wedding invitation inspired by the divine beauty of Ram Mandir. 🪷✨", desc]);
  r.push(["Ram Mandir | A Divine Wedding Theme", c.title]);
  r.push(["https://rammandir.framer.website", `${SITE_URL}/${c.slug}`]);
  return r;
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------
function main() {
  const report = { couples: [], warnings: [], errors: [] };
  const couples = JSON.parse(read(path.join(DATA, "couples.json"))).couples;
  const templateHtml = read(path.join(PUBLIC, "index.html"));
  const pageBundleSrc = read(path.join(SITES_DIR, PAGE_BUNDLE));
  const mainBundleSrc = read(path.join(SITES_DIR, MAIN_BUNDLE));

  const showcase = [];
  const builtPages = [];

  for (const couple of couples) {
    const c = { ...couple, slug: safeSlug(couple.slug) };
    if (!c.active) continue;
    if (!c.demo) {
      showcase.push(c);
    }

    // Demo couples keep the original page untouched (only head/canonical swap
    // so each personalized URL owns its metadata). Custom couples get the full
    // token replacement set.
    const rules = c.demo
      ? metaRules(c)
      : [...metaRules(c), ...commonRules(c), ...imageRules(c)];

    // 1) HTML
    let html = applyRules(templateHtml, rules).out;
    html = applyNames(html, c);
    html = applyLayerNames(html, c);
    html = applyParents(html, c.groom.parents);

    // 2) page bundle (story lives here) — meta rules included so hydration
    // keeps the per-couple title/canonical (document.title is set client-side).
    let pageBundle = applyRules(pageBundleSrc, [...metaRules(c), ...rules]).out;
    pageBundle = applyNames(pageBundle, c);
    pageBundle = applyLayerNames(pageBundle, c);
    pageBundle = applyParents(pageBundle, c.groom.parents);
    if (c.invitation && c.invitation.story) {
      pageBundle = replaceBacktickValue(pageBundle, "Our hearts are full", c.invitation.story);
    }

    // 3) per-slug bundle copies + bootloader
    const pageBundleName = `${c.slug}-page.mjs`;
    const mainBundleName = `${c.slug}-main.mjs`;
    write(path.join(SITES_DIR, pageBundleName), pageBundle);
    write(path.join(SITES_DIR, mainBundleName), mainBundleSrc.split(PAGE_BUNDLE).join(pageBundleName));

    html = html.split(MAIN_BUNDLE).join(mainBundleName);

    // 4) pin the document title after hydration (Framer may re-set it)
    if (!c.demo && c.title) {
      const escaped = c.title.replace(/</g, "\\u003c").replace(/"/g, '\\"');
      html = html.replace("</body>", `<script>(()=>{const t=${JSON.stringify(escaped)};const set=()=>document.title=t;set();window.addEventListener("load",set);setTimeout(set,2500)})()</script></body>`);
    }

    // 5) write page
    const outHtml = path.join(PUBLIC, c.slug, "index.html");
    write(outHtml, html);
    builtPages.push(`${c.slug}/`);

    report.couples.push({ slug: c.slug, active: c.active, demo: !!c.demo });
  }

  // -- showcase page --
  if (showcase.length) {
    const cards = showcase
      .map((c) => {
        const ev = c.event || {};
        return `<li><a href="/${c.slug}/"><strong>${c.bride.firstName} & ${c.groom.firstName}</strong><span>${ev.dateLabel || ""} · ${ev.city || ""}</span></a></li>`;
      })
      .join("");
    const page = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Wedding Invitations | Demos</title><style>body{font-family:Georgia,serif;max-width:640px;margin:0 auto;padding:32px;color:#3a2318;background:#faf6f0}ul{list-style:none;padding:0}li{margin:10px 0;padding:18px;background:#fff;border:1px solid #e5d8c8;border-radius:10px}a{color:#a04a21;text-decoration:none;display:flex;flex-direction:column;gap:4px}span{color:#9c7a5d;font-size:14px}</style></head><body><h1>Wedding Invitations</h1><p>Each couple gets their own personalised wedding website.</p><ul>${cards}</ul></body></html>`;
    write(path.join(PUBLIC, "couples", "index.html"), page);
  }

  console.log(JSON.stringify(report, null, 2));
}

main();
