/**
 * Vercel serverless — live preview for the public builder.
 * Mirrors POST /api/preview on the local server (server.js).
 *
 * Nothing is stored: for the legacy Ram Mandir template the patched Framer
 * bundles are embedded in the returned HTML —
 *   • the main bundle as a data: URL in its <script src>,
 *   • the page bundle as a data: URL behind an import map entry,
 * and every relative chunk import ("./framer.*.mjs", "./react.*.mjs", …) is
 * rewritten to an absolute URL on this deployment. A <base href> is added so
 * root-relative assets resolve when the builder loads the HTML from a blob:
 * URL. No Supabase storage is used, so previews cannot fill the bucket.
 */
const fs = require("fs");
const path = require("path");
const B = require("../tools/build");

const ROOT = path.join(__dirname, "..");
const TEMPLATES_DIR = path.join(ROOT, "templates");
const TEMPLATE = path.join(TEMPLATES_DIR, "ram-mandir", "index.html");

// public URL folder of the legacy Framer bundles (matches B.SITES_DIR)
const SITE_SUBDIR = "/mirror/framerusercontent.com/sites/" + path.basename(B.SITES_DIR) + "/";
// relative module specifiers inside bundles: "./x.mjs", '../y.js', `./z.mjs`
const REL_SPEC_RE = /(["'`])(\.{1,2}\/[A-Za-z0-9._\-\/@%]+\.(?:mjs|js|css|json))\1/g;
// bare specifier the main bundle imports the page bundle by (see import map)
const PAGE_SPEC = "srw-preview-page";

function parseBody(req) {
  const raw = req.body;
  if (!raw) return {};
  if (typeof raw === "object" && !Buffer.isBuffer(raw)) return raw;
  try { return JSON.parse(Buffer.isBuffer(raw) ? raw.toString("utf8") : raw); } catch { return {}; }
}

function strip(s, max) {
  return String(s == null ? "" : s).trim().slice(0, max || 2000);
}

function escapeRe(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// origin of this deployment (works on preview deployments too)
function siteOrigin(req) {
  const host = String(req.headers["x-forwarded-host"] || req.headers.host || "").split(",")[0].trim();
  if (/^[a-z0-9.-]+(:\d+)?$/i.test(host)) {
    const proto = String(req.headers["x-forwarded-proto"] || "https").split(",")[0].trim() === "http" ? "http" : "https";
    return `${proto}://${host}`;
  }
  return String(process.env.SITE_URL || "https://sitaram-weddings.vercel.app").replace(/\/+$/, "");
}

function absolutize(src, dirUrl) {
  return src.replace(REL_SPEC_RE, (m, q, spec) => q + new URL(spec, dirUrl).href + q);
}

function jsDataUrl(src) {
  return "data:text/javascript;base64," + Buffer.from(src, "utf8").toString("base64");
}

// naive per-IP rate limit (per serverless instance — best effort only)
const previewLimits = new Map();
function previewAllowed(ip) {
  const min = Math.floor(Date.now() / 60000);
  const key = ip + "|" + min;
  const n = (previewLimits.get(key) || 0) + 1;
  if (previewLimits.size > 5000) previewLimits.clear();
  previewLimits.set(key, n);
  return n <= 300;
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "method not allowed" });
    return;
  }
  const ip = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim() || (req.socket && req.socket.remoteAddress) || "?";
  if (!previewAllowed(ip)) {
    res.status(429).json({ error: "Too many previews — wait a moment." });
    return;
  }
  const b = parseBody(req);
  const template = String(b.template || "");
  const tpl = B.discoverTemplates().find((t) => t.id === template);
  if (!tpl) {
    res.status(400).json({ error: "Choose a template." });
    return;
  }
  const c = (b.couple && typeof b.couple === "object") ? b.couple : {};
  const brideName = strip(c.bride && c.bride.firstName, 40) || "Bride";
  const groomName = strip(c.groom && c.groom.firstName, 40) || "Groom";
  const inv = (c.invitation && typeof c.invitation === "object") ? c.invitation : {};
  const events = Array.isArray(c.events) && c.events.length
    ? c.events.map((e) => ({
        name: strip(e && e.name, 80) || "Shaadi",
        day: strip(e && e.day, 40), time: strip(e && e.time, 40),
        dateLabel: strip(e && e.dateLabel, 60), city: strip(e && e.city, 80),
        venueName: strip(e && e.venueName, 120), venueAddress: strip(e && e.venueAddress, 200),
        lat: strip(e && e.lat, 20), lng: strip(e && e.lng, 20),
        note: strip(e && e.note, 200) || "More details below",
      })).slice(0, 6)
    : [{ slot: 1, name: "Shaadi", day: "", time: "", dateLabel: "", city: "", venueName: "", venueAddress: "", lat: "", lng: "", note: "More details below" }];
  const wa = (c.whatsapp && typeof c.whatsapp === "object") ? c.whatsapp : {};
  const couple = {
    id: 0, slug: "preview", demo: true, active: true,
    title: `${brideName} & ${groomName} | Wedding Invitation`,
    metaDescription: "",
    bride: { firstName: brideName, fullName: strip(c.bride && c.bride.fullName, 120), parents: strip(c.bride && c.bride.parents, 200), photo: null },
    groom: { firstName: groomName, fullName: strip(c.groom && c.groom.fullName, 120), parents: strip(c.groom && c.groom.parents, 200), photo: null },
    invitation: {
      headline: strip(inv.headline, 200) || "{bride} weds {groom}",
      intro: strip(inv.intro, 300), story: strip(inv.story, 3000),
      hashtag: strip(inv.hashtag, 60), closing: strip(inv.closing, 120) || "Looking forward to see you",
    },
    events, countdownTarget: /^\d{4}-\d{2}-\d{2}T/.test(String(c.countdownTarget || "")) ? c.countdownTarget : "",
    whatsapp: { display: strip(wa.display, 20), intl: strip(wa.intl, 20).replace(/\D/g, "").slice(0, 15) },
    gallery: [], thingsToKnow: [],
    images: { hero: null, bridePhoto: null, groomPhoto: null, portrait: null },
  };

  try {
    let html;
    if (tpl.engine === "legacy-framer") {
      const L = {
        html: fs.readFileSync(TEMPLATE, "utf8"),
        pageBundle: fs.readFileSync(path.join(B.SITES_DIR, B.PAGE_BUNDLE), "utf8"),
        mainBundle: fs.readFileSync(path.join(B.SITES_DIR, B.MAIN_BUNDLE), "utf8"),
      };
      const nonce = "pv-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
      const coupleCopy = { ...couple, slug: nonce };
      const r = B.buildLegacyCouplePage(coupleCopy, L.html, L.pageBundle, L.mainBundle, { rootOnly: false, noWrite: true });
      if (!r.bundles) throw new Error("legacy build returned no bundles");
      const origin = siteOrigin(req);
      const dirUrl = origin + SITE_SUBDIR;

      // page bundle: chunk imports → absolute URLs on this deployment
      const page = absolutize(r.bundles.page, dirUrl);
      // main bundle: page-bundle import → import-map specifier, rest → absolute
      const main = absolutize(r.bundles.main.split("./" + r.bundles.pageName).join(PAGE_SPEC), dirUrl);

      html = r.html;
      // replace the WHOLE main-bundle URL (folder + file name) with a data: URL
      const mainRe = new RegExp(`(["'])[^"']*${escapeRe(r.bundles.mainName)}\\1`, "g");
      const mainUrl = jsDataUrl(main);
      html = html.replace(mainRe, (m, q) => q + mainUrl + q);

      // import map must precede every module script; <base> fixes blob: URLs
      const importMap = `<script type="importmap">${JSON.stringify({ imports: { [PAGE_SPEC]: jsDataUrl(page) } })}</script>`;
      const headExtra = `<base href="${origin}/">${importMap}`;
      if (/<head[^>]*>/i.test(html)) html = html.replace(/<head[^>]*>/i, (h) => h + headExtra);
      else html = headExtra + html;
    } else {
      html = B.buildPlaceholderPage(couple, fs.readFileSync(tpl.htmlPath, "utf8"), tpl, { demo: false }).html;
    }
    res.setHeader("Cache-Control", "no-store");
    res.status(200).json({ html });
  } catch (e) {
    res.status(500).json({ error: "Could not build preview.", detail: String(e && e.message || e) });
  }
};
