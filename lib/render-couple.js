/**
 * Dynamic couple-page renderer (server-side).
 *
 * Renders a couple's wedding website on demand from Supabase data, using the
 * same template engines as tools/build.js:
 *
 *   • "legacy-framer" — Ram Mandir template, patched with string rules +
 *     per-couple Framer JS bundles. Bundles are produced in memory
 *     (noWrite) and returned for the caller to serve via /mirror/... routes.
 *   • "placeholder"    — {{TOKEN}} templates, clean token replacement.
 *
 * Used by server.js (local) and api/serve-couple.js + api/couple-bundle.js
 * (Vercel serverless).
 */
const fs = require("fs");
const path = require("path");
const B = require("../tools/build");

const ROOT = path.join(__dirname, "..");
const TEMPLATE_DIR = path.join(ROOT, "templates");

function findTemplate(id) {
  return B.discoverTemplates().find((t) => t.id === id);
}

let legacyCache = null;
function legacySources() {
  if (!legacyCache) {
    legacyCache = {
      html: fs.readFileSync(path.join(TEMPLATE_DIR, "ram-mandir", "index.html"), "utf8"),
      pageBundle: fs.readFileSync(path.join(B.SITES_DIR, B.PAGE_BUNDLE), "utf8"),
      mainBundle: fs.readFileSync(path.join(B.SITES_DIR, B.MAIN_BUNDLE), "utf8"),
    };
  }
  return legacyCache;
}

/**
 * Render a couple to final HTML.
 * @returns {{html: string, c: object, warnings: string[], bundles: null|{
 *   pageName: string, mainName: string, page: string, main: string}}}
 */
function renderCouplePage(couple) {
  const slug = String((couple && couple.slug) || "").replace(/[^a-z0-9-]/g, "") || "couple";
  const c = { ...couple, slug };
  const tpl = findTemplate(c.template || "ram-mandir");
  if (!tpl) throw new Error(`Unknown template "${c.template}"`);
  if (tpl.engine === "legacy-framer") {
    const L = legacySources();
    return B.buildLegacyCouplePage(c, L.html, L.pageBundle, L.mainBundle, { rootOnly: false, noWrite: true });
  }
  const out = B.buildPlaceholderPage(c, fs.readFileSync(tpl.htmlPath, "utf8"), tpl, { demo: false });
  return { html: out.html, c, warnings: [], bundles: null };
}

module.exports = { renderCouplePage, findTemplate, legacySources };
