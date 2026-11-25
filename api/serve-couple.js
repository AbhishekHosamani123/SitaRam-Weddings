/**
 * Vercel serverless — catch-all for couple pages (rewrite target).
 *
 * Serves:
 *   • static files that live under public/ for reserved single-segment
 *     names (create, templates, couples, tpl, mirror, admin)
 *   • dynamic couple websites for any other single-segment slug
 *
 * Requires SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY env vars.
 */
const fs = require("fs");
const path = require("path");
const SB = require("../lib/supabase");
const RENDER = require("../lib/render-couple");

const ROOT = path.join(__dirname, "..");
const PUBLIC = path.join(ROOT, "public");

const RESERVED = new Set(["create", "templates", "couples", "tpl", "mirror", "admin"]);

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
};

function serveFile(res, filePath) {
  const full = path.normalize(filePath);
  const rootNorm = path.normalize(PUBLIC);
  if (!(full === rootNorm || full.startsWith(rootNorm + path.sep))) {
    res.status(403).end("Forbidden");
    return;
  }
  let target = full;
  try {
    if (fs.statSync(target).isDirectory()) target = path.join(target, "index.html");
  } catch { /* fall through to 404 */ }
  try {
    const data = fs.readFileSync(target);
    const ext = path.extname(target).toLowerCase();
    res.setHeader("Content-Type", MIME[ext] || "application/octet-stream");
    res.setHeader("Cache-Control", ext === ".html" ? "no-store" : "public, max-age=3600");
    res.status(200).send(data);
  } catch {
    res.status(404).end("Not found");
  }
}

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

module.exports = async function handler(req, res) {
  const slug = String((req.query.slug || req.query.path || "").replace(/^\/|\/$/g, "")).toLowerCase();
  if (!slug || !/^[a-z0-9-]+$/.test(slug)) {
    res.status(404).end("Not found");
    return;
  }

  if (RESERVED.has(slug)) {
    return serveFile(res, path.join(PUBLIC, slug, "index.html"));
  }

  try {
    const { json } = await SB.select("couples", { eq: { slug }, limit: 1 });
    const couple = json && json.length ? rowToCouple(json[0]) : null;
    if (!couple || !couple.active) {
      res.status(404).end("Not found");
      return;
    }
    const { html } = RENDER.renderCouplePage(couple);
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    res.status(200).send(html);
  } catch (e) {
    res.status(500).end(String(e && e.message || e));
  }
};
