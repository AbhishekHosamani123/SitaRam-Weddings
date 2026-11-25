#!/usr/bin/env node
/**
 * Wedding-site static generator (multi-couple, multi-template).
 *
 * Templates live in templates/<id>/ (index.html + template.json) and are
 * auto-discovered. Two build engines:
 *
 *   • "legacy-framer"  — the original Ram Mandir Framer template, patched with
 *     string-replacement rules + the six timeline-card slot engine + the
 *     shared post-hydration script (wedding-events.js).
 *   • "placeholder"    — self-contained {{TOKEN}} templates (Ayodhya, Meenaya,
 *     Laavan, …). Clean token replacement; events/gallery injected as JSON.
 *
 * Outputs:
 *   - public/index.html               demo homepage (from the demo couple)
 *   - public/<slug>/index.html        one personalised page per active couple
 *   - public/couples/index.html       showcase listing
 *   - public/templates/index.html     public template gallery
 *   - public/templates/<id>/          live demo of every template (sample data)
 *
 * Each couple may set "template" in data/couples.json; missing → "ram-mandir".
 *
 * Run: node tools/build.js
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const PUBLIC = path.join(ROOT, "public");
const DATA_DIR = path.join(ROOT, "data");
const TEMPLATES_DIR = path.join(ROOT, "templates");
const TOOLS_DIR = path.join(ROOT, "tools");
const IMG_DIR = path.join(PUBLIC, "mirror", "framerusercontent.com", "images");
const SITES_DIR = path.join(PUBLIC, "mirror", "framerusercontent.com", "sites", "1Jnwf2uoy3TohI0oOnOtPi");
const EVENTS_JS = path.join(PUBLIC, "mirror", "framerusercontent.com", "js", "wedding-events.js");
const PAGE_BUNDLE = "VR998DU3WSRaZIpYrcWhMoQxMWGXSrJFDK6jx2eUMjE.DKHZzuKc.v3.mjs";
const MAIN_BUNDLE = "script_main.BNALTGIK.v3.mjs";
const SITE_URL = "https://sitaram-weddings.vercel.app";
const DEFAULT_TEMPLATE = "ram-mandir";
const LANDING_SRC = path.join(TOOLS_DIR, "landing.html");
const BUILDER_SRC = path.join(TOOLS_DIR, "builder.html");

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

function htmlEsc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function jsonForScript(v) {
  return JSON.stringify(v).replace(/</g, "\\u003c");
}

// ---------------------------------------------------------------------------
// template registry (auto-discovered from templates/*/template.json)
// ---------------------------------------------------------------------------
function discoverTemplates() {
  const list = [];
  if (!fs.existsSync(TEMPLATES_DIR)) return list;
  for (const name of fs.readdirSync(TEMPLATES_DIR)) {
    const dir = path.join(TEMPLATES_DIR, name);
    const metaPath = path.join(dir, "template.json");
    const htmlPath = path.join(dir, "index.html");
    if (!fs.existsSync(metaPath) || !fs.existsSync(htmlPath)) continue;
    let meta;
    try { meta = JSON.parse(read(metaPath)); } catch (e) { continue; }
    if (meta.disabled) continue; // hidden for now (still on disk)
    list.push({
      id: meta.id || name,
      name: meta.name || name,
      category: meta.category || "",
      tagline: meta.tagline || "",
      accent: meta.accent || "#b3541e",
      colors: Array.isArray(meta.colors) ? meta.colors : ["#7b2d26", "#d9a441"],
      engine: meta.engine === "legacy-framer" ? "legacy-framer" : "placeholder",
      order: Number(meta.order) || 99,
      dir,
      htmlPath,
    });
  }
  list.sort((a, b) => (a.order - b.order) || a.id.localeCompare(b.id));
  return list;
}

// ---------------------------------------------------------------------------
// legacy-framer engine (ram-mandir) — unchanged behaviour, new template path
// ---------------------------------------------------------------------------
const TEMPLATE = path.join(TEMPLATES_DIR, "ram-mandir", "index.html");

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
// event slot engine (legacy-framer only)
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
// legacy token rules (non-card content)
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
  // NOTE: in the Ram Mandir template the invitation line is split across two
  // <p> elements ("…the honor of your" / "presence at the wedding celebration of"),
  // so the single-string patch below never matches. Patch each half separately.
  if (inv.intro) {
    r.push(["Cordially request the honor of your presence at the wedding celebration of", inv.intro]);
    r.push(["Cordially request the honor of your", inv.intro]);
    r.push(["presence at the wedding celebration of", ""]);
  }
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
    const rel = /^https?:\/\//.test(url) ? url : url.replace(/^\/mirror\/framerusercontent\.com\/images\//, "");
    for (const f of files) r.push([f, rel]);
  }
  (c.gallery || []).forEach((g, i) => {
    const token = GALLERY_TOKENS[i];
    if (!g || !token) return;
    const rel = /^https?:\/\//.test(g) ? g : g.replace(/^\/mirror\/framerusercontent\.com\/images\//, "");
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
// legacy per-couple page build
// ---------------------------------------------------------------------------
function buildLegacyCouplePage(couple, templateHtml, pageBundleSrc, mainBundleSrc, opts = {}) {
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
<script src="/mirror/framerusercontent.com/js/wedding-events.js?v=2"></script>`;
  html = html.replace("</body>", inline + "\n</body>");

  let htmlOut = html;
  let bundles = null;

  if (!opts.rootOnly) {
    // 4) per-slug bundle copies + bootloader + title pin
    const pageBundleName = `${c.slug}-page.mjs`;
    const mainBundleName = `${c.slug}-main.mjs`;
    bundles = {
      pageName: pageBundleName,
      mainName: mainBundleName,
      page: pageBundle,
      main: mainBundleSrc.split(PAGE_BUNDLE).join(pageBundleName),
    };
    if (!opts.noWrite) {
      write(path.join(SITES_DIR, pageBundleName), bundles.page);
      write(path.join(SITES_DIR, mainBundleName), bundles.main);
    }
    htmlOut = htmlOut.split(MAIN_BUNDLE).join(mainBundleName);

    const escaped = String(c.title || "").replace(/</g, "\\u003c").replace(/"/g, '\\"');
    htmlOut = htmlOut.replace("</body>", `<script>(()=>{const t=${JSON.stringify(escaped)};const set=()=>{document.title=t;const tt=document.querySelector("title");if(tt&&tt.textContent!==t)tt.textContent=t};[0,500,1500,3000,5000,8000].forEach(d=>setTimeout(set,d));window.addEventListener("load",set)})()</script></body>`);
  }

  return { html: htmlOut, c, warnings, bundles };
}

// ---------------------------------------------------------------------------
// placeholder engine (all hand-built templates)
// ---------------------------------------------------------------------------
function headlineFor(c) {
  const h = (c.invitation && c.invitation.headline) || "{bride} weds {groom}";
  return String(h)
    .replace(/\{bride\}/g, c.bride.firstName || "Bride")
    .replace(/\{groom\}/g, c.groom.firstName || "Groom");
}

function mapsFor(main) {
  const lat = String(main.lat || "").trim();
  const lng = String(main.lng || "").trim();
  if (lat && lng) {
    return {
      link: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(lat + "," + lng)}`,
      embed: `https://maps.google.com/maps?q=${encodeURIComponent(lat + "," + lng)}&z=15&output=embed`,
    };
  }
  const q = [main.venueName, main.venueAddress, main.city].filter(Boolean).join(", ").trim();
  if (q) {
    return {
      link: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`,
      embed: `https://maps.google.com/maps?q=${encodeURIComponent(q)}&z=15&output=embed`,
    };
  }
  return { link: "#", embed: "" };
}

function whatsappLinkFor(c) {
  const intl = String((c.whatsapp || {}).intl || "").replace(/\D/g, "");
  if (!intl) return "#";
  const text = `Namaste! We would love to attend the wedding of ${c.bride.firstName || ""} & ${c.groom.firstName || ""}.`;
  return `https://wa.me/${intl}?text=${encodeURIComponent(text)}`;
}

const DEMO_GRADIENTS = [
  ["#e8b04b", "#a34a2a"],
  ["#3e5c3a", "#b98a2f"],
  ["#7a1f2b", "#e8862a"],
  ["#0e5c4a", "#0fa3a3"],
  ["#10233f", "#d4b36a"],
  ["#1f8a8f", "#f2b75c"],
];
function demoGalleryItem(i) {
  const [a, b] = DEMO_GRADIENTS[i % DEMO_GRADIENTS.length];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="640" viewBox="0 0 640 640">`
    + `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs>`
    + `<rect width="640" height="640" fill="url(#g)"/>`
    + `<circle cx="320" cy="320" r="150" fill="none" stroke="rgba(255,255,255,.55)" stroke-width="2"/>`
    + `<circle cx="320" cy="320" r="120" fill="none" stroke="rgba(255,255,255,.3)" stroke-width="1.4" stroke-dasharray="4 8"/>`
    + `<path d="M320,270 c-28,26 -28,66 0,96 c28,-30 28,-70 0,-96 z" fill="rgba(255,255,255,.65)"/>`
    + `<text x="320" y="470" text-anchor="middle" font-family="Georgia,serif" font-size="26" fill="rgba(255,255,255,.8)">Sample photo ${i + 1}</text>`
    + `</svg>`;
  return "data:image/svg+xml," + encodeURIComponent(svg);
}

/**
 * Build a page for a {{TOKEN}}-style template.
 * opts.demo: build a template demo page (uses demo URLs for canonical links).
 */
function buildPlaceholderPage(couple, tplHtml, tpl, opts = {}) {
  const c = { ...couple, slug: safeSlug(couple.slug) };
  const main = (c.events || [])[0] || {};
  const inv = c.invitation || {};
  const wa = c.whatsapp || {};
  const imgs = c.images || {};
  const ttk = {};
  for (const t of (c.thingsToKnow || [])) ttk[t.key] = t.text || "";

  const maps = mapsFor(main);
  const names = `${c.bride.firstName || "Bride"} & ${c.groom.firstName || "Groom"}`;
  const urlPath = opts.demo ? `templates/${tpl.id}` : c.slug;

  const events = (c.events || []).slice(0, 6).map((e) => ({
    name: e.name, day: e.day, time: e.time, dateLabel: e.dateLabel,
    city: e.city, note: e.note,
  }));

  const gallery = [];
  for (let i = 0; i < 6; i++) {
    const g = (c.gallery || [])[i];
    gallery.push(g || (opts.demo ? demoGalleryItem(i) : null));
  }

  const tokens = {
    PAGE_TITLE: htmlEsc(c.title || `${names} | Wedding Invitation`),
    META_DESCRIPTION: htmlEsc(c.metaDescription || `Join us to celebrate the wedding of ${names}.`),
    PAGE_URL: htmlEsc(`${SITE_URL}/${urlPath}`),
    BRIDE_FIRST: htmlEsc(c.bride.firstName),
    GROOM_FIRST: htmlEsc(c.groom.firstName),
    BRIDE_FULL: htmlEsc(c.bride.fullName || c.bride.firstName),
    GROOM_FULL: htmlEsc(c.groom.fullName || c.groom.firstName),
    BRIDE_PARENTS: htmlEsc(c.bride.parents),
    GROOM_PARENTS: htmlEsc(c.groom.parents),
    HEADLINE: htmlEsc(headlineFor(c)),
    INTRO: htmlEsc(inv.intro),
    STORY: htmlEsc(inv.story),
    CLOSING: htmlEsc(inv.closing),
    HASHTAG: htmlEsc(inv.hashtag),
    COUNTDOWN_ISO: htmlEsc(c.countdownTarget || ""),
    WA_DISPLAY: htmlEsc(wa.display),
    WA_INTL: htmlEsc(wa.intl),
    WHATSAPP_LINK: htmlEsc(whatsappLinkFor(c)),
    MAIN_EVENT_NAME: htmlEsc(main.name),
    MAIN_EVENT_DAY: htmlEsc(main.day),
    MAIN_EVENT_DATE: htmlEsc(main.dateLabel),
    MAIN_EVENT_TIME: htmlEsc(main.time),
    MAIN_VENUE: htmlEsc(main.venueName),
    MAIN_ADDRESS: htmlEsc(main.venueAddress),
    MAIN_CITY: htmlEsc(main.city),
    MAPS_LINK: htmlEsc(maps.link),
    MAPS_EMBED: htmlEsc(maps.embed),
    TTK_WEATHER: htmlEsc(ttk.weather || ""),
    TTK_STAFF: htmlEsc(ttk.staff || ""),
    TTK_PARKING: htmlEsc(ttk.parking || ""),
    HERO_IMG: htmlEsc(imgs.hero || ""),
    BRIDE_IMG: htmlEsc(imgs.bridePhoto || ""),
    GROOM_IMG: htmlEsc(imgs.groomPhoto || ""),
    PORTRAIT_IMG: htmlEsc(imgs.portrait || ""),
    EVENTS_JSON: jsonForScript(events),
    GALLERY_JSON: jsonForScript(gallery),
  };

  const html = tplHtml.replace(/\{\{([A-Z_]+)\}\}/g, (m, key) =>
    Object.prototype.hasOwnProperty.call(tokens, key) ? tokens[key] : m
  );
  return { html, c };
}

// ---------------------------------------------------------------------------
// sample data for template demo pages
// ---------------------------------------------------------------------------
function sampleCouple() {
  // keep the countdown alive: ~115 days out from build time
  const future = new Date(Date.now() + 115 * 864e5 + 12 * 36e5);
  return {
    id: 0, slug: "ananya-vivaan", demo: true, active: true,
    title: "Ananya & Vivaan | Wedding Invitation",
    metaDescription: "Join us to celebrate the wedding of Ananya & Vivaan — a celebration of love, laughter and lifelong friendship.",
    bride: { firstName: "Ananya", fullName: "Ananya Sharma", parents: "Shri. Rajesh & Smt. Meera Sharma", photo: null },
    groom: { firstName: "Vivaan", fullName: "Vivaan Mehta", parents: "Shri. Nitin & Smt. Kavita Mehta", photo: null },
    invitation: {
      headline: "{bride} weds {groom}",
      intro: "Together with their families, we joyfully invite you to celebrate our wedding",
      story: "It started with a chance meeting at a college fest, a conversation that never really ended, and a thousand little moments that led us here. Now, with our families beside us, we cannot wait to begin this new chapter — and we would love for you to be part of it.",
      hashtag: "AnanyaWedsVivaan",
      closing: "Your blessings mean the world to us",
    },
    events: [
      { slot: 1, name: "Haldi", day: "Thursday", dateLabel: "12th Mar 2027", time: "10 Am Onwards", city: "Udaipur, Rajasthan", note: "Dress code — shades of yellow", venueName: "The Fern Lawns", venueAddress: "Lake Pichola Road", lat: "24.5711", lng: "73.6531" },
      { slot: 2, name: "Mehendi", day: "Friday", dateLabel: "13th Mar 2027", time: "4 Pm Onwards", city: "Udaipur, Rajasthan", note: "Wear something comfortable & green" },
      { slot: 3, name: "Sangeet", day: "Friday", dateLabel: "13th Mar 2027", time: "7 Pm Onwards", city: "Udaipur, Rajasthan", note: "Bring your best dance moves" },
      { slot: 4, name: "Wedding Ceremony", day: "Saturday", dateLabel: "14th Mar 2027", time: "7:30 Pm Muhurat", city: "Udaipur, Rajasthan", note: "The big day — we say forever" },
      { slot: 5, name: "Reception", day: "Sunday", dateLabel: "15th Mar 2027", time: "7 Pm Onwards", city: "Udaipur, Rajasthan", note: "Dinner, dancing & celebration" },
    ],
    countdownTarget: future.toISOString(),
    whatsapp: { display: "98765 43210", intl: "919876543210" },
    gallery: [],
    thingsToKnow: [
      { key: "weather", title: "Weather", text: "Pleasant March evenings — carry a light shawl for the open-air venues" },
      { key: "staff", title: "Stay", text: "We recommend the Lake View Residency, a short drive from all venues" },
      { key: "parking", title: "Parking", text: "Valet parking is available at every venue" },
    ],
    images: { hero: null, bridePhoto: null, groomPhoto: null, portrait: null },
  };
}

// ---------------------------------------------------------------------------
// template gallery page (public/templates/index.html)
// ---------------------------------------------------------------------------
function buildGalleryPage(tpls) {
  const cards = tpls.map((t, i) => {
    const [c1, c2] = [t.colors[0] || "#7b2d26", t.colors[1] || t.accent];
    return `
      <a class="card" href="/templates/${t.id}/" style="--c1:${c1};--c2:${c2};--ac:${t.accent}">
        <span class="swatch"><span class="mono">${(t.name || "?").slice(0, 2).toUpperCase()}</span></span>
        <span class="cat">${t.category || "Wedding"}</span>
        <span class="tname">${t.name}</span>
        <span class="tag">${t.tagline}</span>
        <span class="cta">View live demo →</span>
      </a>`;
  }).join("\n");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Wedding Website Templates | Choose Your Style</title>
<meta name="description" content="Browse our wedding website templates — Hindu, South-Indian, Sikh, Muslim and destination themes. Pick one, personalise it, and share your wedding with everyone.">
<style>
  body{font-family:Georgia,serif;max-width:1060px;margin:0 auto;padding:48px 24px;color:#3a2318;background:#faf6f0}
  h1{font-size:34px;font-weight:normal;margin:0 0 6px;color:#7b2d26}
  .sub{color:#9c7a5d;font-style:italic;margin:0 0 34px}
  .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:18px}
  .card{display:flex;flex-direction:column;gap:6px;text-decoration:none;color:#3a2318;background:#fff;border:1px solid #e5d8c8;border-radius:14px;overflow:hidden;transition:transform .25s,box-shadow .25s}
  .card:hover{transform:translateY(-3px);box-shadow:0 12px 30px rgba(58,35,24,.14)}
  .swatch{height:120px;background:linear-gradient(135deg,var(--c1),var(--c2));display:grid;place-items:center}
  .mono{font-size:34px;letter-spacing:.1em;color:rgba(255,255,255,.92);font-family:Georgia,serif}
  .cat{font-size:11px;letter-spacing:.22em;text-transform:uppercase;color:var(--ac);padding:16px 18px 0;font-family:Verdana,sans-serif}
  .tname{font-size:22px;color:#5d3a22;padding:0 18px}
  .tag{font-size:14px;color:#9c7a5d;font-style:italic;padding:0 18px;line-height:1.5}
  .cta{font-size:13px;color:var(--ac);padding:14px 18px 18px;font-family:Verdana,sans-serif;letter-spacing:.06em}
  .note{margin-top:36px;color:#9c7a5d;font-size:14px;font-style:italic}
  footer{margin-top:44px;color:#b9a284;font-size:13px}
</style></head><body>
<h1>Wedding Website Templates</h1>
<p class="sub">Pick a style — every template is fully personalised with your names, dates, venues and photos.</p>
<div class="grid">
${cards}
</div>
<p class="note">Demos use sample content — your website will show your own details, uploaded photos and venues.</p>
<footer>Every couple gets their own link, e.g. ${SITE_URL}/your-names/</footer>
</body></html>`;
}

// ---------------------------------------------------------------------------
// landing page (homepage) + public builder page
// ---------------------------------------------------------------------------
function buildLandingCards(tpls) {
  return tpls.map((t) => {
    const c1 = t.colors[0] || t.accent;
    const c2 = t.colors[1] || t.accent;
    return `
      <article class="tpl-card" data-cat="${t.category || "Wedding"}" style="--ac:${t.accent};--c1:${c1};--c2:${c2}">
        <div class="tpl-preview">
          <iframe src="/templates/${t.id}/" loading="lazy" title="${t.name} preview"></iframe>
          <a class="open-full" href="/templates/${t.id}/" target="_blank" rel="noopener">Full preview ↗</a>
        </div>
        <div class="tpl-body">
          <span class="tpl-cat">${t.category || "Wedding"}</span>
          <h3 class="tpl-name">${t.name}</h3>
          <p class="tpl-tag">${t.tagline || ""}</p>
          <div class="price-row">
            <s>₹3,999</s><b>₹999</b><span class="offer-chip">first 10 customers</span>
          </div>
          <div class="tpl-actions">
            <a class="btn btn-ghost" href="/templates/${t.id}/" target="_blank" rel="noopener">Preview</a>
            <a class="btn btn-primary" href="/create?template=${t.id}">Customise</a>
          </div>
        </div>
      </article>`;
  }).join("\n");
}

function buildTemplatesJson(tpls) {
  return tpls.map((t) => ({
    id: t.id,
    name: t.name,
    category: t.category,
    tagline: t.tagline,
    accent: t.accent,
    colors: t.colors,
    engine: t.engine,
  }));
}

function buildLandingPage(tpls) {
  const src = read(LANDING_SRC);
  const cards = buildLandingCards(tpls);
  return src.split("{{TEMPLATE_CARDS}}").join(cards);
}

function buildBuilderPage(tpls) {
  const src = read(BUILDER_SRC);
  const json = JSON.stringify(buildTemplatesJson(tpls)).replace(/</g, "\\u003c");
  return src.split("{{TEMPLATES_JSON}}").join(json);
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------
function main() {
  const report = { couples: [], templates: [], warnings: [], errors: [] };
  const db = JSON.parse(read(path.join(DATA_DIR, "couples.json")));
  const couples = (db.couples || []).map((c) => ({ ...c, template: c.template || DEFAULT_TEMPLATE }));
  const tpls = discoverTemplates();
  const tplById = Object.fromEntries(tpls.map((t) => [t.id, t]));
  report.templates = tpls.map((t) => t.id);

  // legacy resources — loaded only when something actually needs them
  let legacy = null;
  function getLegacy() {
    if (legacy) return legacy;
    legacy = {
      html: read(TEMPLATE),
      pageBundle: read(path.join(SITES_DIR, PAGE_BUNDLE)),
      mainBundle: read(path.join(SITES_DIR, MAIN_BUNDLE)),
    };
    return legacy;
  }

  function buildWithEngine(couple, tpl, opts = {}) {
    if (!tpl) throw new Error(`Unknown template "${couple.template}"`);
    if (tpl.engine === "legacy-framer") {
      const L = getLegacy();
      return buildLegacyCouplePage(couple, L.html, L.pageBundle, L.mainBundle, opts);
    }
    return buildPlaceholderPage(couple, read(tpl.htmlPath), tpl, opts);
  }

  // 0) shared post-hydration events script for the legacy template.
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
  // live-edit hook (Dashboard preview) — update events and re-apply now
  self.__WD_APPLY__ = function (events) {
    if (Array.isArray(events)) self.__WEDDING_EVENTS__ = events;
    return assign();
  };
})();
`);

  // 1) homepage = the landing page (sales page), generated from template registry
  write(path.join(PUBLIC, "index.html"), buildLandingPage(tpls));

  // 1b) public self-service builder (no login) at /create/
  write(path.join(PUBLIC, "create", "index.html"), buildBuilderPage(tpls));

  // 2) demo couple page — still generated statically as a fallback
  // (live couple pages are now rendered dynamically from Supabase at request
  // time; this demo copy just guarantees /sita-ram/ works even offline).
  const demo = couples.find((x) => x.demo);
  if (demo && demo.active) {
    const demoCopy = JSON.parse(JSON.stringify(demo));
    const page = buildWithEngine(demoCopy, tplById[demoCopy.template || DEFAULT_TEMPLATE], { demo: false });
    write(path.join(PUBLIC, demoCopy.slug, "index.html"), page.html);
    report.couples.push({ slug: demoCopy.slug, demo: true, template: demoCopy.template });
  }

  // 3) per-couple pages are NOT generated statically anymore — they are
  // served dynamically by /api/serve-couple (local server) or the Vercel
  // rewrite. Clean up stale generated pages so they never shadow live data.
  const showcase = [];
  for (const couple of couples) {
    if (couple.demo || !couple.active) continue;
    const slug = safeSlug(couple.slug);
    const dir = path.join(PUBLIC, slug);
    try { if (fs.statSync(dir).isDirectory()) fs.rmSync(dir, { recursive: true, force: true }); } catch { /* not present */ }
    showcase.push({ ...couple, slug });
    report.couples.push({ slug, active: true, template: couple.template });
  }

  // 3) showcase listing (now template-aware)
  if (showcase.length) {
    const cards = showcase
      .map((c) => {
        const main = (c.events || [])[0] || {};
        const tplName = tplById[c.template] ? tplById[c.template].name : c.template;
        return `<li><a href="/${c.slug}/"><strong>${c.bride.firstName} & ${c.groom.firstName}</strong><span>${main.dateLabel || ""} · ${main.city || ""} · ${tplName}</span></a></li>`;
      })
      .join("");
    const page = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Wedding Invitations | Showcase</title><style>body{font-family:Georgia,serif;max-width:640px;margin:0 auto;padding:32px;color:#3a2318;background:#faf6f0}ul{list-style:none;padding:0}li{margin:10px 0;padding:18px;background:#fff;border:1px solid #e5d8c8;border-radius:10px}a{color:#a04a21;text-decoration:none;display:flex;flex-direction:column;gap:4px}span{color:#9c7a5d;font-size:14px}</style></head><body><h1>Wedding Invitations</h1><p>Each couple gets their own personalised wedding website.</p><ul>${cards}</ul></body></html>`;
    write(path.join(PUBLIC, "couples", "index.html"), page);
  }

  // 4) per-template demo pages + public gallery
  // The legacy-framer template hydrates its own text from the (unpatched)
  // shared bundles, so its demo must use the demo couple (Sita & Ram) —
  // sample names would be overwritten on hydration.
  const sample = sampleCouple();
  for (const tpl of tpls) {
    try {
      const source = tpl.engine === "legacy-framer" ? (demo || sample) : sample;
      const page = buildWithEngine(source, tpl, { rootOnly: true, demo: true });
      write(path.join(PUBLIC, "templates", tpl.id, "index.html"), page.html);
      // raw template source for the public builder's live preview (/tpl/<id>/)
      write(path.join(PUBLIC, "tpl", tpl.id, "index.html"), read(tpl.htmlPath));
      report.templates_demos = report.templates_demos || [];
      report.templates_demos.push(tpl.id);
    } catch (e) {
      report.errors.push(`template demo ${tpl.id}: ${String(e && e.message || e)}`);
    }
  }
  write(path.join(PUBLIC, "templates", "index.html"), buildGalleryPage(tpls));

  console.log(JSON.stringify(report, null, 2));
}

if (require.main === module) main();

module.exports = {
  discoverTemplates,
  buildPlaceholderPage,
  buildLegacyCouplePage,
  buildLandingPage,
  buildBuilderPage,
  TEMPLATE,
  SITES_DIR,
  PAGE_BUNDLE,
  MAIN_BUNDLE,
  SITE_URL,
};
