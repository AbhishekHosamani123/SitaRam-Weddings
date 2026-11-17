#!/usr/bin/env node
/**
 * Wedding-site static generator (multi-couple).
 *
 * Reads data/couples.json and renders:
 *   - public/index.html            demo homepage (from the master template,
 *                                   with the demo couple's single event)
 *   - public/<slug>/index.html     one personalised page per active couple
 *   - public/couples/index.html    showcase listing (when non-demo couples exist)
 *
 * The master template (_tools/master-template.html) has SIX timeline card
 * slots (data-framer-name="1..6"), all originally filled with the same
 * "Shaadi" content. The slot engine below fills each slot with the couple's
 * actual events and hides unused slots. A small shared script
 * (public/mirror/framerusercontent.com/js/wedding-events.js) re-applies the
 * same mapping after hydration so every device shows the right timeline.
 *
 * Run: node tools/build.js
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const PUBLIC = path.join(ROOT, "public");
const DATA_DIR = path.join(ROOT, "data");
const TEMPLATE = path.join(ROOT, "_tools", "master-template.html");
const IMG_DIR = path.join(PUBLIC, "mirror", "framerusercontent.com", "images");
const SITES_DIR = path.join(PUBLIC, "mirror", "framerusercontent.com", "sites", "1Jnwf2uoy3TohI0oOnOtPi");
const EVENTS_JS = path.join(PUBLIC, "mirror", "framerusercontent.com", "js", "wedding-events.js");
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

function applyNames(src, c) {
  let out = src;
  const b = c.bride.firstName, g = c.groom.firstName;
  out = out.split("`Sita`").join("`" + b + "`").split(">Sita<").join(">" + b + "<");
  out = out.split("`Ram`").join("`" + g + "`").split(">Ram<").join(">" + g + "<");
  return out;
}

function applyLayerNames(src, c) {
  let out = src;
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

// ---------------------------------------------------------------------------
// event slot engine
// ---------------------------------------------------------------------------
const CARD_NAME_RE = /<div class="framer-[a-z0-9]+" data-framer-name="([1-6])" style="will-change:transform/g;
const CARD_MAX_LEN = 7000;

/**
 * Fill the six timeline-card slots with the couple's events (slot 1..N).
 * Cards beyond N are hidden (desktop: the whole standalone block; mobile:
 * the card div itself). Returns the updated HTML.
 */
function applyEventSlots(html, events) {
  const slots = (events || []).slice(0, 6);
  const found = [];
  const re = new RegExp(CARD_NAME_RE.source, "g");
  let m;
  while ((m = re.exec(html))) found.push({ slot: +m[1], start: m.index });

  // walk backwards so earlier offsets stay valid
  for (let i = found.length - 1; i >= 0; i--) {
    const { slot, start } = found[i];
    const ev = slots[slot - 1];
    const end = Math.min(html.length, start + CARD_MAX_LEN);
    let seg = html.slice(start, end);

    const before = html.slice(Math.max(0, start - 4000), start);
    const isMobile = before.includes("Pillars Row") || before.includes(`data-framer-name="Event Pillars"`);

    if (!ev) {
      if (isMobile) {
        seg = seg.replace("style=\"will-change:transform", "style=\"display:none!important;will-change:transform");
      } else {
        const blockStart = html.lastIndexOf('<div class="ssr-variant hidden-7902is', start);
        if (blockStart !== -1 && start - blockStart < 4000) {
          const gt = html.indexOf(">", blockStart);
          if (gt !== -1 && gt - blockStart < 120) {
            html = html.slice(0, gt) + ' style="display:none!important"' + html.slice(gt);
          }
        }
      }
    } else {
      const pairs = [
        ["Shaadi", ev.name || "Shaadi"],
        ["Friday", ev.day || "Friday"],
        ["6 Pm Onwards", ev.time || "6 Pm Onwards"],
        ["29th Aug 2026", ev.dateLabel || "29th Aug 2026"],
        ["Pune, Maharashtra", ev.city || "Pune, Maharashtra"],
        ["More details below", ev.note || "More details below"],
      ];
      for (const [from, to] of pairs) seg = seg.split(from).join(to);
    }
    html = html.slice(0, start) + seg + html.slice(end);
  }
  return html;
}

// ---------------------------------------------------------------------------
// token rules (non-card content)
// ---------------------------------------------------------------------------
function metaRules(c) {
  const r = [];
  const desc = c.metaDescription || `Join us to celebrate the wedding of ${c.bride.firstName} & ${c.groom.firstName}.`;
  r.push(["A beautifully crafted wedding invitation inspired by the divine beauty of Ram Mandir. 🪷✨", desc]);
  r.push(["Ram Mandir | A Divine Wedding Theme", c.title]);
  r.push(["https://rammandir.framer.website", `${SITE_URL}/${c.slug}`]);
  return r;
}

function commonRules(c) {
  const r = [];
  const main = (c.events || [])[0] || {};
  const wa = c.whatsapp || {};
  const inv = c.invitation || {};

  // -- venue / map (main event drives the map card) --
  if (main.venueName) r.push(["Venue Name", main.venueName]);
  if (main.venueAddress) {
    r.push(["Full street address, city, state, ZIP", main.venueAddress]);
    r.push(["Full street address", main.venueAddress]);
  }
  if (main.lat && main.lng) {
    r.push([`19.2183%2C%2072.9781`, `${main.lat}%2C%20${main.lng}`]);
    r.push(["19.2183, 72.9781", `${main.lat}, ${main.lng}`]);
    r.push(["19.0760, 72.8777", `${main.lat}, ${main.lng}`]);
    r.push(["19.2183", main.lat]);
    r.push(["19.0760", main.lat]);
    r.push(["72.9781", main.lng]);
    r.push(["72.8777", main.lng]);
  }
  if (main.venueName && wa.display) {
    const block = "M10\ngeomatrix\nsilver crest kamote \n9819200906";
    r.push([block, `${main.venueName}\n${wa.display}`]);
  }

  // -- whatsapp --
  if (wa.display) r.push(["9819200906", wa.display]);
  if (wa.intl) r.push(["919819200906", wa.intl]);

  // -- invitation texts --
  if (inv.intro) r.push(["Cordially request the honor of your presence at the wedding celebration of", inv.intro]);
  if (inv.closing) r.push(["Looking forward to see you", inv.closing]);
  if (inv.hashtag) r.push([`the hashtag - #abkan`, `the hashtag - #${inv.hashtag}`]);

  // -- countdown --
  r.push(["2026-09-28T00:00:00.000Z", c.countdownTarget || "2026-09-28T00:00:00.000Z"]);

  // -- things to know --
  const ttk = {};
  for (const t of (c.thingsToKnow || [])) ttk[t.key] = t.text;
  if (ttk.weather) r.push(["It will be mostly sunny with temperature reaching up to 28 degrees at the venue", ttk.weather]);
  if (ttk.staff) r.push(["We recommend the nearby hotel called Bhola Bhawan near the venue for the staff members", ttk.staff]);
  if (ttk.parking) r.push(["Valet parking for all our guests will be available at the venue", ttk.parking]);

  return r;
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
  for (const [slot, files] of Object.entries(IMG_SLOTS)) {
    const url = imgs[slot];
    if (!url) continue;
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

// RSVP dropdown options live in the page bundle (3 identical occurrences)
const RSVP_EVENTS = "eventOptions:[`Mehendi`,`Sangeet`,`Wedding Ceremony`,`Reception`]";
function rsvpRules(c) {
  const events = (c.events || []).slice(0, 6).map((e) => e.name).filter(Boolean);
  if (!events.length) return [];
  const safe = events.map((n) => "`" + String(n).replace(/`/g, "'") + "`").join(",");
  return [[RSVP_EVENTS, "eventOptions:[" + safe + "]"]];
}

// ---------------------------------------------------------------------------
// per-couple page build
// ---------------------------------------------------------------------------
function buildCouplePage(couple, templateHtml, pageBundleSrc, mainBundleSrc, opts = {}) {
  const c = { ...couple, slug: safeSlug(couple.slug) };
  const warnings = [];

  const rules = [...metaRules(c), ...commonRules(c), ...imageRules(c)];

  // 1) HTML: base rules → event slots → names/parents/layers
  let html = applyRules(templateHtml, rules).out;
  html = applyEventSlots(html, c.events);
  html = applyNames(html, c);
  html = applyLayerNames(html, c);
  html = applyParents(html, c.groom.parents);

  // 2) page bundle
  let pageBundle = applyRules(pageBundleSrc, [...metaRules(c), ...rules, ...rsvpRules(c)]).out;
  pageBundle = applyNames(pageBundle, c);
  pageBundle = applyLayerNames(pageBundle, c);
  pageBundle = applyParents(pageBundle, c.groom.parents);
  if (c.invitation && c.invitation.story && !opts.rootOnly) {
    const anchor = "Our hearts are full";
    const esc = anchor.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp("text:`[^`]*?" + esc + "[^`]*`", "g");
    pageBundle = pageBundle.replace(re, "text:`" + c.invitation.story + "`");
  }

  // 3) sharing script + per-couple event config
  const eventsJson = JSON.stringify((c.events || []).slice(0, 6).map((e) => ({
    name: e.name, day: e.day, time: e.time, dateLabel: e.dateLabel,
    city: e.city, note: e.note,
  }))).replace(/</g, "\\u003c");
  const inline = `<script>window.__WEDDING_EVENTS__=${eventsJson};</script>
<script src="/mirror/framerusercontent.com/js/wedding-events.js"></script>`;
  html = html.replace("</body>", inline + "\n</body>");

  let htmlOut = html;
  let bundleOut = pageBundle;

  if (!opts.rootOnly && !c.demo) {
    // 4) per-slug bundle copies + bootloader + title pin
    const pageBundleName = `${c.slug}-page.mjs`;
    const mainBundleName = `${c.slug}-main.mjs`;
    write(path.join(SITES_DIR, pageBundleName), pageBundle);
    write(path.join(SITES_DIR, mainBundleName), mainBundleSrc.split(PAGE_BUNDLE).join(pageBundleName));
    htmlOut = htmlOut.split(MAIN_BUNDLE).join(mainBundleName);

    const escaped = String(c.title || "").replace(/</g, "\\u003c").replace(/"/g, '\\"');
    htmlOut = htmlOut.replace("</body>", `<script>(()=>{const t=${JSON.stringify(escaped)};const set=()=>{document.title=t;const tt=document.querySelector("title");if(tt&&tt.textContent!==t)tt.textContent=t};[0,500,1500,3000,5000,8000].forEach(d=>setTimeout(set,d));window.addEventListener("load",set)})()</script></body>`);
  }

  return { html: htmlOut, pageBundle: bundleOut, c, warnings };
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------
function main() {
  const report = { couples: [], warnings: [], errors: [] };
  const db = JSON.parse(read(path.join(DATA_DIR, "couples.json")));
  const couples = db.couples || [];
  const templateHtml = read(TEMPLATE);
  const pageBundleSrc = read(path.join(SITES_DIR, PAGE_BUNDLE));
  const mainBundleSrc = read(path.join(SITES_DIR, MAIN_BUNDLE));

  const demo = couples.find((x) => x.demo);

  // 0) write the shared post-hydration events script once.
  // It re-applies the slot→event mapping repeatedly (Framer's hydration may
  // overwrite our SSR text), watching for mutations until stable.
  write(EVENTS_JS, `(() => {
  const E = (self.__WEDDING_EVENTS__ || []);
  if (!E.length) return;
  const LEGACY = {
    name: ["Shaadi"], day: ["Friday"], time: ["6 Pm Onwards"],
    date: ["29th Aug 2026"], city: ["Pune, Maharashtra"], note: ["More details below"],
  };
  function assign() {
    const cards = [...document.querySelectorAll('div[data-framer-name]')].filter((el) =>
      /^[1-6]$/.test(el.getAttribute('data-framer-name')) && el.querySelector('p'));
    let changed = 0;
    for (const card of cards) {
      const n = +card.getAttribute('data-framer-name');
      const ev = E[n - 1];
      if (!ev) { if (card.style.display !== 'none') { card.style.display = 'none'; changed++; } continue; }
      if (card.style.display === 'none') { card.style.display = ''; changed++; }
      const ps = [...card.querySelectorAll('p')];
      for (const p of ps) {
        const t = (p.textContent || '').trim();
        for (const key of Object.keys(LEGACY)) {
          if (!LEGACY[key].includes(t)) continue;
          if (p.textContent !== ev[key]) { p.textContent = ev[key]; changed++; }
          break;
        }
      }
    }
    return changed;
  }
  function run() { try { assign(); } catch (e) {} }
  const delays = [0, 400, 1200, 2500, 4000, 6000, 8000, 10000];
  delays.forEach((d) => setTimeout(run, d));
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run);
  else run();
  window.addEventListener('load', run);
  // keep re-applying while Framer keeps reconciling
  const stop = Date.now() + 12000;
  const observer = new MutationObserver(() => {
    if (Date.now() > stop) { observer.disconnect(); return; }
    run();
  });
  const main = document.getElementById('main') || document.body;
  if (main) observer.observe(main, { childList: true, subtree: true, characterData: true });
})();
`);

  // 1) demo homepage (root) — same slot-aware processing, default bundles
  if (demo && demo.active) {
    const demoCopy = JSON.parse(JSON.stringify(demo));
    const page = buildCouplePage(demoCopy, templateHtml, pageBundleSrc, mainBundleSrc, { rootOnly: true });
    write(path.join(PUBLIC, "index.html"), page.html);
    report.couples.push({ slug: demoCopy.slug, root: true, demo: true });
  }

  // 2) per-couple pages
  const showcase = [];
  for (const couple of couples) {
    if (couple.demo || !couple.active) continue;
    const c = { ...couple, slug: safeSlug(couple.slug) };
    const page = buildCouplePage(c, templateHtml, pageBundleSrc, mainBundleSrc);
    write(path.join(PUBLIC, c.slug, "index.html"), page.html);
    showcase.push(c);
    report.couples.push({ slug: c.slug, active: true });
  }

  // 3) showcase listing
  if (showcase.length) {
    const cards = showcase
      .map((c) => {
        const main = (c.events || [])[0] || {};
        return `<li><a href="/${c.slug}/"><strong>${c.bride.firstName} & ${c.groom.firstName}</strong><span>${main.dateLabel || ""} · ${main.city || ""}</span></a></li>`;
      })
      .join("");
    const page = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Wedding Invitations | Showcase</title><style>body{font-family:Georgia,serif;max-width:640px;margin:0 auto;padding:32px;color:#3a2318;background:#faf6f0}ul{list-style:none;padding:0}li{margin:10px 0;padding:18px;background:#fff;border:1px solid #e5d8c8;border-radius:10px}a{color:#a04a21;text-decoration:none;display:flex;flex-direction:column;gap:4px}span{color:#9c7a5d;font-size:14px}</style></head><body><h1>Wedding Invitations</h1><p>Each couple gets their own personalised wedding website.</p><ul>${cards}</ul></body></html>`;
    write(path.join(PUBLIC, "couples", "index.html"), page);
  }

  console.log(JSON.stringify(report, null, 2));
}

main();
