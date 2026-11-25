/**
 * Vercel serverless — dynamic legacy Framer assets under
 * /mirror/framerusercontent.com/sites/<siteId>/...
 *
 * Two roles:
 *   • `<slug>-page.mjs` / `<slug>-main.mjs` — generated per-couple bundles,
 *     produced in memory from Supabase data (never written to disk).
 *   • any other file (rolldown-runtime chunks, module maps, …) — served
 *     verbatim from the repo's static copy (public/mirror/...).
 *
 * Requires SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY env vars.
 */
const fs = require("fs");
const path = require("path");
const SB = require("../lib/supabase");
const RENDER = require("../lib/render-couple");

const ROOT = path.join(__dirname, "..");
const PUBLIC = path.join(ROOT, "public");

const MIME = {
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json",
  ".wasm": "application/wasm",
  ".txt": "text/plain; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
};

function rowToCouple(row) {
  const d = (row && row.data) || {};
  return {
    id: row.id,
    slug: row.slug,
    template: row.template || "ram-mandir",
    title: row.title,
    metaDescription: row.meta_description,
    source: row.source || "public",
    demo: !!row.demo,
    active: row.active !== false,
    paymentStatus: row.payment_status || "unpaid",
    paymentRef: row.payment_ref || null,
    paidAt: row.paid_at ? Date.parse(row.paid_at) : null,
    contact: row.contact || "",
    createdAt: row.created_at ? Date.parse(row.created_at) : Date.now(),
    ...d,
  };
}

function serveStaticFile(res, filePath) {
  const full = path.normalize(filePath);
  const rootNorm = path.normalize(PUBLIC);
  if (!(full === rootNorm || full.startsWith(rootNorm + path.sep))) {
    res.status(403).end("Forbidden");
    return;
  }
  try {
    const data = fs.readFileSync(full);
    const ext = path.extname(full).toLowerCase();
    res.setHeader("Content-Type", MIME[ext] || "application/octet-stream");
    res.setHeader("Cache-Control", "public, max-age=3600");
    res.status(200).send(data);
  } catch {
    res.status(404).end("Not found");
  }
}

module.exports = async function handler(req, res) {
  const filePath = String(req.query.path || "");
  if (!filePath || filePath.includes("..")) {
    res.status(404).end("Not found");
    return;
  }

  // dynamic per-couple bundle?
  const m = /^[^/]+\/([a-z0-9-]+)-(page|main)\.mjs$/.exec(filePath);
  if (m) {
    const slug = m[1];
    const kind = m[2];
    try {
      const { json } = await SB.select("couples", { eq: { slug }, limit: 1 });
      const couple = json && json.length ? rowToCouple(json[0]) : null;
      if (!couple || !couple.active) {
        res.status(404).end("Not found");
        return;
      }
      const { bundles } = RENDER.renderCouplePage(couple);
      if (!bundles) {
        res.status(404).end("Not found");
        return;
      }
      res.setHeader("Content-Type", "text/javascript; charset=utf-8");
      res.setHeader("Cache-Control", "no-store");
      res.status(200).send(kind === "page" ? bundles.page : bundles.main);
      return;
    } catch (e) {
      res.status(500).end(String(e && e.message || e));
      return;
    }
  }

  // everything else → static pass-through
  serveStaticFile(res, path.join(PUBLIC, "mirror", "framerusercontent.com", "sites", filePath));
};
