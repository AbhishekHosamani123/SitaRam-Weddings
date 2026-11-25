#!/usr/bin/env node
/**
 * Wedding Dashboard server (dependency-free).
 *
 *   • serves the static site (public/) — landing at /, admin at /admin
 *   • renders couple websites dynamically from Supabase at /<slug>/
 *   • local API for the Dashboard: auth, couples CRUD (Supabase), uploads
 *   • Razorpay order/verify + public self-service publishing (Supabase)
 *
 * Couple data lives in Supabase (tables: couples, orders; bucket:
 * couple-images). When SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are missing,
 * a JSON-file fallback (data/couples.json) is used so the server still runs.
 *
 * Run: node server.js   (port 8080 by default, override with PORT=…)
 */
const http = require("http");
const https = require("https");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const ROOT = __dirname;
const PUBLIC = path.join(ROOT, "public");
const DATA_DIR = path.join(ROOT, "data");
const COUPLES_FILE = path.join(DATA_DIR, "couples.json");
const ADMIN_FILE = path.join(DATA_DIR, "admin.json");
const TEMPLATES_DIR = path.join(ROOT, "templates");
const PORT = Number(process.env.PORT || 8080);
const SITE_URL = "https://sitaram-weddings.vercel.app";

// minimal .env loader (no external dependencies) — .env is git-ignored
(function loadEnv() {
  const envPath = path.join(ROOT, ".env");
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
    if (!m || process.env[m[1]] !== undefined) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    process.env[m[1]] = v;
  }
})();

const RZP = require("./lib/razorpay");
const SB = require("./lib/supabase");
const RENDER = require("./lib/render-couple");

// template registry — auto-discovered from templates/<id>/template.json
function listTemplates() {
  const out = [];
  if (!fs.existsSync(TEMPLATES_DIR)) return out;
  for (const name of fs.readdirSync(TEMPLATES_DIR)) {
    const dir = path.join(TEMPLATES_DIR, name);
    const metaPath = path.join(dir, "template.json");
    if (!fs.existsSync(metaPath) || !fs.existsSync(path.join(dir, "index.html"))) continue;
    try {
      const meta = JSON.parse(fs.readFileSync(metaPath, "utf8"));
      if (meta.disabled) continue; // hidden for now (still on disk)
      out.push({
        id: meta.id || name,
        name: meta.name || name,
        category: meta.category || "",
        tagline: meta.tagline || "",
        accent: meta.accent || "#b3541e",
        colors: Array.isArray(meta.colors) ? meta.colors : [],
        engine: meta.engine === "legacy-framer" ? "legacy-framer" : "placeholder",
        order: Number(meta.order) || 99,
      });
    } catch { /* skip malformed template.json */ }
  }
  out.sort((a, b) => (a.order - b.order) || a.id.localeCompare(b.id));
  return out;
}

// ---------------------------------------------------------------------------
// data layer — Supabase (primary), JSON file fallback
// ---------------------------------------------------------------------------
function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}
function writeJsonAtomic(file, obj) {
  const tmp = file + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2));
  fs.renameSync(tmp, file);
}

// DB row → flat couple object (what the UI/APIs have always used)
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

// flat couple object → DB row columns
function coupleToRow(c) {
  const {
    id, slug, template, title, metaDescription, source, demo, active,
    paymentStatus, paymentRef, paidAt, contact, createdAt, ...data
  } = c || {};
  return {
    slug: String(slug || "").trim(),
    template: template || "ram-mandir",
    title: title || "",
    meta_description: metaDescription || null,
    source: source || "public",
    demo: !!demo,
    active: active !== false,
    payment_status: paymentStatus || "unpaid",
    payment_ref: paymentRef || null,
    paid_at: paidAt ? new Date(paidAt).toISOString() : null,
    contact: contact || "",
    data: data || {},
  };
}

async function dbListCouples() {
  if (!SB.enabled()) {
    const db = readJson(COUPLES_FILE);
    return (db.couples || []).map((c) => ({ ...c, template: c.template || "ram-mandir" }));
  }
  const { json } = await SB.select("couples", { order: "created_at.asc" });
  return (json || []).map(rowToCouple);
}

async function dbGetCoupleBySlug(slug) {
  if (!SB.enabled()) {
    const db = readJson(COUPLES_FILE);
    return (db.couples || []).find((c) => String(c.slug).toLowerCase() === String(slug).toLowerCase()) || null;
  }
  const { json } = await SB.select("couples", { eq: { slug }, limit: 1 });
  return json && json.length ? rowToCouple(json[0]) : null;
}

async function dbGetCoupleById(id) {
  if (!SB.enabled()) {
    const db = readJson(COUPLES_FILE);
    const found = (db.couples || []).find((c) => String(c.id) === String(id));
    return found || null;
  }
  const { json } = await SB.select("couples", { eq: { id }, limit: 1 });
  return json && json.length ? rowToCouple(json[0]) : null;
}

async function dbSlugExists(slug, excludeId) {
  if (!SB.enabled()) {
    const db = readJson(COUPLES_FILE);
    return (db.couples || []).some((c) => String(c.slug).toLowerCase() === slug && String(c.id) !== String(excludeId));
  }
  const { json } = await SB.select("couples", { select: "id", eq: { slug }, limit: 2 });
  if (!json || !json.length) return false;
  return json.some((r) => String(r.id) !== String(excludeId));
}

async function dbInsertCouple(couple) {
  const row = coupleToRow(couple);
  if (!SB.enabled()) {
    const db = readJson(COUPLES_FILE);
    const id = db.couples.reduce((m, c) => Math.max(m, c.id), 0) + 1;
    const flat = { ...couple, id };
    db.couples.push(flat);
    writeJsonAtomic(COUPLES_FILE, db);
    return flat;
  }
  const { json } = await SB.insert("couples", { ...row, created_at: new Date().toISOString(), updated_at: new Date().toISOString() });
  return rowToCouple(json[0]);
}

async function dbUpdateCouple(id, patch) {
  if (!SB.enabled()) {
    const db = readJson(COUPLES_FILE);
    const idx = db.couples.findIndex((c) => String(c.id) === String(id));
    if (idx === -1) return null;
    const merged = { ...db.couples[idx], ...patch, id };
    db.couples[idx] = merged;
    writeJsonAtomic(COUPLES_FILE, db);
    return merged;
  }
  const row = coupleToRow(patch);
  const { json } = await SB.update("couples", { id }, { ...row, updated_at: new Date().toISOString() });
  return json && json.length ? rowToCouple(json[0]) : null;
}

async function dbDeleteCouple(id) {
  if (!SB.enabled()) {
    const db = readJson(COUPLES_FILE);
    const idx = db.couples.findIndex((c) => String(c.id) === String(id));
    if (idx === -1) return false;
    db.couples.splice(idx, 1);
    writeJsonAtomic(COUPLES_FILE, db);
    return true;
  }
  await SB.remove("couples", { id });
  return true;
}

function sha256(s) { return crypto.createHash("sha256").update(s).digest("hex"); }
function verifyPassword(pw) {
  const admin = readJson(ADMIN_FILE);
  return sha256(admin.salt + ":" + pw) === admin.hash;
}

// ---------------------------------------------------------------------------
// sessions
// ---------------------------------------------------------------------------
const sessions = new Map(); // token -> expiry
function createToken() {
  const token = crypto.randomBytes(24).toString("hex");
  sessions.set(token, Date.now() + 12 * 3600 * 1000);
  return token;
}
function isAuthed(req) {
  const h = req.headers.authorization || "";
  const token = h.startsWith("Bearer ") ? h.slice(7) : req.url.includes("token=") ? new URL(req.url, "http://x").searchParams.get("token") : null;
  if (!token || !sessions.has(token)) return false;
  if (sessions.get(token) < Date.now()) { sessions.delete(token); return false; }
  return true;
}

// ---------------------------------------------------------------------------
// static serving
// ---------------------------------------------------------------------------
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
  ".mp3": "audio/mpeg",
  ".txt": "text/plain; charset=utf-8",
  ".mime": "text/plain",
};
function serveStatic(res, filePath, root = PUBLIC) {
  const full = path.normalize(filePath);
  const rootNorm = path.normalize(root);
  if (!(full === rootNorm || full.startsWith(rootNorm + path.sep))) { res.writeHead(403).end("Forbidden"); return; }
  let target = full;
  try {
    if (fs.statSync(target).isDirectory()) target = path.join(target, "index.html");
  } catch { /* not found below */ }
  fs.readFile(target, (err, data) => {
    if (err) { res.writeHead(404, { "Content-Type": "text/plain" }).end("Not found"); return; }
    const ext = path.extname(target).toLowerCase();
    const isAdmin = full.startsWith(path.join(ROOT, "admin")) || full.includes("wedding-events.js");
    res.writeHead(200, {
      "Content-Type": MIME[ext] || "application/octet-stream",
      "Cache-Control": isAdmin || ext === ".html" ? "no-store" : "public, max-age=3600",
    });
    res.end(data);
  });
}

// ---------------------------------------------------------------------------
// JSON body + multipart parsing
// ---------------------------------------------------------------------------
function readBody(req, cap = 25 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (c) => {
      size += c.length;
      if (size > cap) { reject(new Error("payload too large")); req.destroy(); return; }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}
function parseMultipart(buf, boundary) {
  const parts = [];
  const delim = Buffer.from("--" + boundary);
  let pos = buf.indexOf(delim);
  while (pos !== -1) {
    const next = buf.indexOf(delim, pos + delim.length);
    if (next === -1) break;
    const block = buf.slice(pos + delim.length, next);
    const headerEnd = block.indexOf("\r\n\r\n");
    if (headerEnd === -1) { pos = next; continue; }
    const headers = block.slice(0, headerEnd).toString("utf8");
    const body = block.slice(headerEnd + 4, block.length - 2); // strip trailing CRLF
    const nameMatch = headers.match(/name="([^"]+)"/);
    const filenameMatch = headers.match(/filename="([^"]+)"/);
    parts.push({ name: nameMatch && nameMatch[1], filename: filenameMatch && filenameMatch[1], body });
    pos = next;
  }
  return parts;
}

// ---------------------------------------------------------------------------
// API handlers
// ---------------------------------------------------------------------------
function apiLogin(req, res, body) {
  let b;
  try { b = JSON.parse(body.toString()); } catch { b = {}; }
  if (!verifyPassword(String(b.password || ""))) {
    res.writeHead(401, { "Content-Type": "application/json" }).end(JSON.stringify({ error: "Wrong password" }));
    return;
  }
  res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ token: createToken() }));
}

async function apiCouples(res) {
  const couples = await dbListCouples();
  res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ couples }));
}

async function apiCreateCouple(res, body) {
  let b = {};
  try { b = JSON.parse(body.toString()); } catch { b = {}; }
  const tplIds = listTemplates().map((t) => t.id);
  const template = tplIds.includes(b.template) ? b.template : "ram-mandir";
  const existing = await dbListCouples();
  const demo = existing.find((c) => c.demo) || existing[0] || {};
  const couple = {
    slug: "",
    demo: false,
    active: false,
    template,
    createdAt: Date.now(),
    paymentStatus: "unpaid",
    title: "New Couple | Wedding Invitation",
    metaDescription: "",
    bride: { firstName: "", fullName: "", parents: "", photo: null },
    groom: { firstName: "", fullName: "", parents: "", photo: null },
    invitation: {
      headline: "{bride} weds {groom}",
      intro: demo.invitation ? demo.invitation.intro : "Cordially request the honor of your presence at the wedding celebration of",
      story: "",
      hashtag: "",
      closing: "Looking forward to see you",
    },
    events: [
      {
        slot: 1, name: "Shaadi", day: "Saturday", dateLabel: "", time: "",
        venueName: "", venueAddress: "", city: "", lat: "", lng: "", note: "More details below",
      }
    ],
    countdownTarget: "",
    whatsapp: { display: "", intl: "" },
    gallery: [],
    thingsToKnow: [
      { key: "weather", title: "Weather", text: "" },
      { key: "staff", title: "Staff", text: "" },
      { key: "parking", title: "Parking", text: "" },
    ],
    images: { hero: null, bridePhoto: null, groomPhoto: null, portrait: null },
  };
  const saved = await dbInsertCouple(couple);
  res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify(saved));
}

async function apiUpdateCouple(req, res, body, rest) {
  const id = rest[0];
  const current = await dbGetCoupleById(id);
  if (!current) { res.writeHead(404).end("Not found"); return; }
  let b;
  try { b = JSON.parse(body.toString()); } catch { b = {}; }
  // enforce unique slugs (case-insensitive)
  if (typeof b.slug === "string") {
    const norm = b.slug.trim().toLowerCase();
    if (!norm || norm === "couple") { res.writeHead(400, { "Content-Type": "application/json" }).end(JSON.stringify({ error: "Slug cannot be empty" })); return; }
    if (await dbSlugExists(norm, id)) {
      res.writeHead(409, { "Content-Type": "application/json" }).end(JSON.stringify({ error: "That URL slug is already used by another couple" }));
      return;
    }
    b.slug = b.slug.trim();
  }
  const merged = { ...current, ...b, id };
  const saved = await dbUpdateCouple(id, merged);
  res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify(saved));
}

async function apiDeleteCouple(req, res, rest) {
  const id = rest[0];
  const current = await dbGetCoupleById(id);
  if (!current) { res.writeHead(404).end("Not found"); return; }
  if (current.demo) { res.writeHead(400).end("Cannot delete the demo couple"); return; }
  await dbDeleteCouple(id);
  res.writeHead(200).end("{}");
}

const SLOTS = new Set(["hero", "bridePhoto", "groomPhoto", "portrait", "gallery1", "gallery2", "gallery3", "gallery4", "gallery5", "gallery6"]);
const ALLOWED_EXT = new Set([".jpg", ".jpeg", ".png", ".webp", ".gif"]);

async function apiUpload(req, res, body, ct) {
  const m = ct && ct.match(/boundary=(.+)$/);
  if (!m) { res.writeHead(400).end("no boundary"); return; }
  const parts = parseMultipart(body, m[1]);
  const f = (name) => parts.find((p) => p.name === name);
  const slug = (f("slug") || {}).body ? String(f("slug").body).trim() : "";
  const slot = (f("slot") || {}).body ? String(f("slot").body).trim() : "";
  const file = f("file");
  if (!slug || !slot || !file || !file.filename) { res.writeHead(400).end("missing slug/slot/file"); return; }
  if (!/^[a-z0-9-]+$/.test(slug) || !SLOTS.has(slot)) { res.writeHead(400).end("bad slug/slot"); return; }
  const ext = path.extname(file.filename).toLowerCase();
  if (!ALLOWED_EXT.has(ext)) { res.writeHead(415).end("unsupported image type"); return; }
  const objectPath = `couples/${slug}/${slot}${ext}`;
  if (SB.enabled()) {
    try {
      const url = await SB.uploadImage(objectPath, file.body, MIME[ext] || "application/octet-stream");
      res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ url, slot, filename: path.basename(objectPath) }));
    } catch (e) {
      res.writeHead(502, { "Content-Type": "application/json" }).end(JSON.stringify({ error: "Image upload failed", detail: String(e && e.message || e) }));
    }
    return;
  }
  const dir = path.join(PUBLIC, "mirror", "framerusercontent.com", "images", "couples", slug);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${slot}${ext}`), file.body);
  const url = `/mirror/framerusercontent.com/images/couples/${slug}/${slot}${ext}`;
  res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ url, slot, filename: `${slot}${ext}` }));
}

// ---------------------------------------------------------------------------
// Razorpay payment gateway — public endpoints used by the builder checkout
// ---------------------------------------------------------------------------
async function apiRazorpayOrder(res, body) {
  let b;
  try { b = JSON.parse(body.toString()); } catch { b = {}; }
  const amt = Number(b.amount);
  const price = RZP.websitePricePaise();
  if (!Number.isInteger(amt) || amt !== price) {
    res.writeHead(400, { "Content-Type": "application/json" }).end(JSON.stringify({ error: "Invalid amount." }));
    return;
  }
  try {
    const order = await RZP.createOrder(amt, "weds-" + Date.now());
    res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({
      order_id: order.id,
      key_id: process.env.RZP_KEY_ID,
      amount: order.amount,
      currency: order.currency || "INR",
    }));
  } catch (e) {
    res.writeHead(502, { "Content-Type": "application/json" }).end(JSON.stringify({ error: "Payment provider unavailable — try again in a moment.", detail: String(e && e.message || e) }));
  }
}

async function recordOrder(orderId, paymentId, signature, slug) {
  try {
    const row = {
      order_id: orderId,
      payment_id: paymentId,
      signature: signature || null,
      amount: RZP.websitePricePaise(),
      couple_slug: slug || null,
      created_at: new Date().toISOString(),
    };
    if (SB.enabled()) await SB.insert("orders", row, { onConflict: "order_id" });
  } catch { /* non-fatal — payment flow must not depend on this */ }
}

async function apiRazorpayVerify(res, body) {
  let b;
  try { b = JSON.parse(body.toString()); } catch { b = {}; }
  if (!RZP.verifyPayment(b.order_id, b.payment_id, b.signature)) {
    res.writeHead(400, { "Content-Type": "application/json" }).end(JSON.stringify({ error: "Invalid payment signature." }));
    return;
  }
  await recordOrder(b.order_id, b.payment_id, b.signature, null);
  res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ ok: true }));
}

// A published couple is "paid" only when:
//   1. the Razorpay signature verifies, AND
//   2. the order was recorded by /api/razorpay/verify (one-time use).
// The recorded order for a verified payment (or null). Offline (no Supabase)
// the verified signature is trusted and claims are kept in memory.
const localOrderClaims = new Map(); // order_id -> slug (offline fallback only)
async function paidOrder(orderId, paymentId, signature) {
  if (!RZP.verifyPayment(orderId, paymentId, signature)) return null;
  if (!SB.enabled()) {
    return { order_id: orderId, payment_id: paymentId, couple_slug: localOrderClaims.get(orderId) || null, offline: true };
  }
  try {
    const { json } = await SB.select("orders", { select: "order_id,payment_id,couple_slug", eq: { order_id: orderId }, limit: 2 });
    return (json || []).find((r) => r.payment_id === paymentId) || null;
  } catch { return null; }
}

// conditional PATCH (PostgREST filters such as couple_slug=is.null)
function sbPatch(pathAndQuery, body) {
  return new Promise((resolve, reject) => {
    const c = SB.cfg();
    const u = new URL(c.url);
    const data = JSON.stringify(body);
    const r = https.request({
      host: u.host,
      path: pathAndQuery,
      method: "PATCH",
      headers: {
        apikey: c.service,
        Authorization: "Bearer " + c.service,
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(data),
        Prefer: "return=representation",
      },
    }, (resp) => {
      let out = "";
      resp.on("data", (d) => (out += d));
      resp.on("end", () => {
        if (resp.statusCode >= 200 && resp.statusCode < 300) {
          try { resolve(out ? JSON.parse(out) : []); } catch { resolve([]); }
        } else reject(new Error(`Supabase HTTP ${resp.statusCode}: ${out.slice(0, 200)}`));
      });
    });
    r.on("error", reject);
    r.write(data);
    r.end();
  });
}

// One payment = one website. Atomically links the order to `slug`.
//   • unclaimed order          → claim it (only one request can win)
//   • already linked to slug   → OK (same couple re-publishing / retrying)
//   • linked to another slug   → only if that claim is orphaned (no couple
//                                was ever saved there, e.g. a failed publish)
async function claimOrder(order, slug, all) {
  if (!order) return false;
  const owner = order.couple_slug || null;
  if (owner === slug) return true;
  if (owner && all.some((x) => String(x.slug).toLowerCase() === String(owner).toLowerCase())) return false;
  if (order.offline) {
    localOrderClaims.set(order.order_id, slug);
    return true;
  }
  const q = new URLSearchParams();
  q.set("order_id", `eq.${order.order_id}`);
  q.set("payment_id", `eq.${order.payment_id}`);
  q.set("couple_slug", owner ? `eq.${owner}` : "is.null");
  q.set("select", "order_id,couple_slug");
  try {
    const rows = await sbPatch(`/rest/v1/orders?${q.toString()}`, { couple_slug: slug });
    if (Array.isArray(rows) && rows.length) return true;
  } catch { return false; }
  // lost a race — see who owns it now
  try {
    const { json } = await SB.select("orders", { select: "couple_slug", eq: { order_id: order.order_id }, limit: 1 });
    return !!(json && json[0] && json[0].couple_slug === slug);
  } catch { return false; }
}

// ---------------------------------------------------------------------------
// public self-service publishing (no login) — /api/public-website
// ---------------------------------------------------------------------------
function safeSlug(s) {
  return String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "couple";
}
function strip(s, max) {
  return String(s == null ? "" : s).trim().slice(0, max || 2000);
}

// naive per-IP rate limit (in-memory, resets on server restart)
const pubLimits = new Map();
function pubAllowed(ip) {
  const day = new Date().toISOString().slice(0, 10);
  const key = ip + "|" + day;
  const n = (pubLimits.get(key) || 0) + 1;
  if (n > 25) return false;
  pubLimits.set(key, n);
  return true;
}

const IMAGE_SLOTS = new Set(["hero", "bridePhoto", "groomPhoto", "portrait", "gallery1", "gallery2", "gallery3", "gallery4", "gallery5", "gallery6"]);
const MIME_EXT = { "image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp", "image/gif": ".gif" };

// data URL → storage object; returns public URL or null
async function saveImageData(dataUrl, slug, slot) {
  const m = /^data:([a-z/+]+);base64,(.+)$/.exec(dataUrl || "");
  if (!m) return null;
  const ext = MIME_EXT[m[1].toLowerCase()];
  if (!ext) return null;
  const buf = Buffer.from(m[2], "base64");
  if (buf.length < 100 || buf.length > 2.5 * 1024 * 1024) return null;
  const objectPath = `couples/${slug}/${slot}${ext}`;
  if (SB.enabled()) {
    try {
      return await SB.uploadImage(objectPath, buf, "image/jpeg");
    } catch { return null; }
  }
  const dir = path.join(PUBLIC, "mirror", "framerusercontent.com", "images", "couples", slug);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${slot}${ext}`), buf);
  return `/mirror/framerusercontent.com/images/couples/${slug}/${slot}${ext}`;
}

async function apiPublicWebSite(req, res, body) {
  let b;
  try { b = JSON.parse(body.toString()); } catch { b = {}; }
  if (!pubAllowed(req.socket.remoteAddress || "?")) {
    res.writeHead(429, { "Content-Type": "application/json" }).end(JSON.stringify({ error: "Too many websites today — please try again tomorrow." }));
    return;
  }
  const tplIds = listTemplates().map((t) => t.id);
  const template = tplIds.includes(b.template) ? b.template : null;
  const c = (b.couple && typeof b.couple === "object") ? b.couple : {};
  const brideName = strip(c.bride && c.bride.firstName, 40);
  const groomName = strip(c.groom && c.groom.firstName, 40);
  const contact = strip(c.contact, 20).replace(/\D/g, "").slice(0, 15);
  if (!template || !brideName || !groomName) {
    res.writeHead(400, { "Content-Type": "application/json" }).end(JSON.stringify({ error: "Choose a template and provide bride & groom first names." }));
    return;
  }
  if (contact.length < 10) {
    res.writeHead(400, { "Content-Type": "application/json" }).end(JSON.stringify({ error: "Please provide a valid 10-digit contact number (required)." }));
    return;
  }

  // payment proof — verified signature + recorded order
  const pay = (b.payment && typeof b.payment === "object") ? b.payment : {};
  const order = await paidOrder(pay.order_id, pay.payment_id, pay.signature);

  const all = await dbListCouples();

  // slug logic:
  //   • REUSE the slug only when it is the SAME couple (same contact number)
  //     re-publishing — an update keeps the same link.
  //   • otherwise, if the slug is taken (even by a same-named couple),
  //     append -2, -3 … so two couples never overwrite each other.
  let slug = safeSlug(brideName + "-" + groomName);
  let n = 2;
  const existing = all.find((x) => String(x.slug).toLowerCase() === slug && x.source === "public" && x.contact === contact);
  if (!existing) {
    const taken = new Set(all.map((x) => String(x.slug).toLowerCase()));
    while (taken.has(slug)) slug = safeSlug(brideName + "-" + groomName) + "-" + n++;
  }

  // paying is required to go live — unless this couple has already paid and
  // is simply updating the same published site (existing, paid, same contact)
  const alreadyPaid = existing && existing.source === "public" && existing.paymentStatus === "paid";
  // a payment counts only once: it must be claimed for THIS slug
  const paid = order ? await claimOrder(order, slug, all) : false;
  if (order && !paid && !alreadyPaid) {
    res.writeHead(402, { "Content-Type": "application/json" }).end(JSON.stringify({ error: "This payment has already been used for another website. Please complete a new checkout." }));
    return;
  }
  if (!paid && !alreadyPaid) {
    res.writeHead(402, { "Content-Type": "application/json" }).end(JSON.stringify({ error: "Payment required before publishing. Please complete the ₹999 checkout." }));
    return;
  }

  // images (data URLs from the browser) → Supabase storage
  const imgs = (c.images && typeof c.images === "object") ? c.images : {};
  const images = {};
  const gallery = [];
  for (let i = 1; i <= 6; i++) {
    const slot = "gallery" + i;
    gallery.push(await saveImageData(imgs[slot], slug, slot));
  }
  for (const slot of ["hero", "bridePhoto", "groomPhoto", "portrait"]) {
    images[slot] = await saveImageData(imgs[slot], slug, slot);
  }

  const inv = (c.invitation && typeof c.invitation === "object") ? c.invitation : {};
  const events = Array.isArray(c.events) ? c.events.map((e) => ({
    slot: 1,
    name: strip(e && e.name, 80) || "Shaadi",
    day: strip(e && e.day, 40),
    time: strip(e && e.time, 40),
    dateLabel: strip(e && e.dateLabel, 60),
    city: strip(e && e.city, 80),
    venueName: strip(e && e.venueName, 120),
    venueAddress: strip(e && e.venueAddress, 200),
    lat: strip(e && e.lat, 20),
    lng: strip(e && e.lng, 20),
    note: strip(e && e.note, 200) || "More details below",
  })).slice(0, 6) : [{
    slot: 1, name: "Shaadi", day: "", time: "", dateLabel: "", city: "",
    venueName: "", venueAddress: "", lat: "", lng: "", note: "More details below",
  }];
  if (!events.length) events.push({ slot: 1, name: "Shaadi", day: "", time: "", dateLabel: "", city: "", venueName: "", venueAddress: "", lat: "", lng: "", note: "More details below" });

  const wa = (c.whatsapp && typeof c.whatsapp === "object") ? c.whatsapp : {};
  const intl = strip(wa.intl, 20).replace(/\D/g, "").slice(0, 15);

  const couple = {
    id: existing ? existing.id : null,
    slug,
    demo: existing ? existing.demo : false,
    active: true,
    source: "public",
    paymentStatus: paid ? "paid" : (existing && existing.paymentStatus ? existing.paymentStatus : "unpaid"),
    ...(paid ? { paymentRef: pay.payment_id, paidAt: Date.now() } : {}),
    createdAt: existing && existing.createdAt ? existing.createdAt : Date.now(),
    contact,
    template,
    title: `${brideName} & ${groomName} | Wedding Invitation`,
    metaDescription: `Join us to celebrate the wedding of ${brideName} & ${groomName}.`,
    bride: { firstName: brideName, fullName: strip(c.bride && c.bride.fullName, 120), parents: strip(c.bride && c.bride.parents, 200), photo: null },
    groom: { firstName: groomName, fullName: strip(c.groom && c.groom.fullName, 120), parents: strip(c.groom && c.groom.parents, 200), photo: null },
    invitation: {
      headline: strip(inv.headline, 200) || "{bride} weds {groom}",
      intro: strip(inv.intro, 300),
      story: strip(inv.story, 3000),
      hashtag: strip(inv.hashtag, 60),
      closing: strip(inv.closing, 120) || "Looking forward to see you",
    },
    events,
    countdownTarget: /^\d{4}-\d{2}-\d{2}T/.test(String(c.countdownTarget || "")) ? c.countdownTarget : "",
    whatsapp: { display: strip(wa.display, 20), intl },
    gallery,
    thingsToKnow: [
      { key: "weather", title: "Weather", text: "" },
      { key: "staff", title: "Staff", text: "" },
      { key: "parking", title: "Parking", text: "" },
    ],
    images,
  };

  if (existing) {
    await dbUpdateCouple(existing.id, couple);
  } else {
    const saved = await dbInsertCouple(couple);
    slug = saved.slug || slug;
  }
  if (paid) await recordOrder(pay.order_id, pay.payment_id, pay.signature, slug);

  const host = req.headers.host || "127.0.0.1:8080";
  const base = /(^|\.)(localhost|127\.0\.0\.1)(:|$)/.test(host) || host.startsWith("127.") ? `http://${host}` : SITE_URL;
  res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ ok: true, slug, url: `${base}/${slug}/` }));
}

// ---------------------------------------------------------------------------
// dynamic couple site rendering (a couple page is generated on demand)
// ---------------------------------------------------------------------------
async function serveCouplePage(req, res, slug) {
  const couple = await dbGetCoupleBySlug(slug);
  if (!couple || !couple.active) {
    res.writeHead(404, { "Content-Type": "text/plain" }).end("Not found");
    return;
  }
  try {
    const { html } = RENDER.renderCouplePage(couple);
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
    res.end(html);
  } catch (e) {
    res.writeHead(500, { "Content-Type": "text/plain" }).end("Could not render this page right now.");
  }
}

// legacy Framer couples reference per-slug JS bundles under /mirror/... —
// generate them in memory with the same engine.
async function serveCoupleBundle(req, res, slug, kind) {
  const couple = await dbGetCoupleBySlug(slug);
  if (!couple || !couple.active) { res.writeHead(404).end("Not found"); return; }
  try {
    const { bundles } = RENDER.renderCouplePage(couple);
    if (!bundles) { res.writeHead(404).end("Not found"); return; }
    const body = kind === "page" ? bundles.page : bundles.main;
    res.writeHead(200, { "Content-Type": "text/javascript; charset=utf-8", "Cache-Control": "no-store" });
    res.end(body);
  } catch {
    res.writeHead(500).end("error");
  }
}

// ---------------------------------------------------------------------------
// live personal preview for the public builder (no save, no files written)
// ---------------------------------------------------------------------------
let buildTools = null;
function getBuildTools() {
  if (!buildTools) buildTools = require("./tools/build.js");
  return buildTools;
}

const previewLimits = new Map();
function previewAllowed(ip) {
  const min = Math.floor(Date.now() / 60000);
  const key = ip + "|" + min;
  const n = (previewLimits.get(key) || 0) + 1;
  // generous headroom for fast typing (the builder aborts stale previews)
  if (n > 600) return false;
  previewLimits.set(key, n);
  return true;
}

async function apiPreview(req, res, body) {
  let b;
  try { b = JSON.parse(body.toString()); } catch { b = {}; }
  if (!previewAllowed(req.socket.remoteAddress || "?")) {
    res.writeHead(429, { "Content-Type": "application/json" }).end(JSON.stringify({ error: "Too many previews — wait a moment." }));
    return;
  }
  const tplIds = listTemplates().map((t) => t.id);
  const template = tplIds.includes(b.template) ? b.template : null;
  const c = (b.couple && typeof b.couple === "object") ? b.couple : {};
  if (!template) {
    res.writeHead(400, { "Content-Type": "application/json" }).end(JSON.stringify({ error: "Choose a template." }));
    return;
  }
  const brideName = strip(c.bride && c.bride.firstName, 40) || "Bride";
  const groomName = strip(c.groom && c.groom.firstName, 40) || "Groom";
  const B = getBuildTools();
  const tpl = B.discoverTemplates().find((t) => t.id === template);
  if (!tpl) {
    res.writeHead(400, { "Content-Type": "application/json" }).end(JSON.stringify({ error: "Unknown template." }));
    return;
  }
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
      const L = RENDER.legacySources();
      const nonce = "pv-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
      const coupleCopy = { ...couple, slug: nonce };
      const r = B.buildLegacyCouplePage(coupleCopy, L.html, L.pageBundle, L.mainBundle, { rootOnly: false });
      html = r.html;
      sweepPreviewBundles();
    } else {
      html = B.buildPlaceholderPage(couple, fs.readFileSync(tpl.htmlPath, "utf8"), tpl, { demo: false }).html;
    }
    res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ html }));
  } catch (e) {
    res.writeHead(500, { "Content-Type": "application/json" }).end(JSON.stringify({ error: "Could not build preview.", detail: String(e && e.message || e) }));
  }
}

// remove old per-preview Framer bundles (kept for ~15 minutes)
function sweepPreviewBundles() {
  try {
    const now = Date.now();
    const B = getBuildTools();
    for (const f of fs.readdirSync(B.SITES_DIR)) {
      if (!String(f).startsWith("pv-") || !String(f).endsWith(".mjs")) continue;
      const full = path.join(B.SITES_DIR, f);
      const st = fs.statSync(full);
      if (now - st.mtimeMs > 15 * 60 * 1000) fs.unlinkSync(full);
    }
  } catch { /* ignore */ }
}

// ---------------------------------------------------------------------------
// router
// ---------------------------------------------------------------------------
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  const p = url.pathname;

  // dynamic legacy Framer bundles (/mirror/framerusercontent.com/sites/...)
  // Skip temporary preview bundles (pv-*), which are written to disk and served statically.
  const bundleRe = /^\/mirror\/framerusercontent\.com\/sites\/[^/]+\/([a-z0-9-]+)-(page|main)\.mjs$/;
  const bm = bundleRe.exec(p);
  if (bm && !p.startsWith("/api/") && !bm[1].startsWith("pv-")) {
    return serveCoupleBundle(req, res, bm[1], bm[2]);
  }

  // public/static
  if (!p.startsWith("/api/")) {
    if (p === "/admin" || p.startsWith("/admin/")) {
      const rel = p.slice("/admin/".length) || "index.html";
      serveStatic(res, path.join(ROOT, "admin", decodeURIComponent(rel)), path.join(ROOT, "admin"));
      return;
    }
    // couple pages: dynamic render when no static file exists
    const slugRe = /^\/([a-z0-9-]+)\/?$/;
    const sm = slugRe.exec(p);
    const staticTarget = path.join(PUBLIC, decodeURIComponent(p));
    const exists = (() => {
      try {
        if (fs.statSync(staticTarget).isDirectory()) return fs.existsSync(path.join(staticTarget, "index.html"));
        return true;
      } catch { return false; }
    })();
    if (sm && !exists && !p.startsWith("/mirror/")) {
      return serveCouplePage(req, res, sm[1]);
    }
    serveStatic(res, staticTarget);
    return;
  }

  // api
  const rest = p.slice("/api/".length).split("/").filter(Boolean);
  const route = rest[0] || "";

  try {
    if (route === "login" && req.method === "POST") {
      const body = await readBody(req, 1e6).catch(() => Buffer.alloc(0));
      return apiLogin(req, res, body);
    }
    if (route === "public-website" && req.method === "POST") {
      const body = await readBody(req, 8e6).catch(() => Buffer.alloc(0));
      return apiPublicWebSite(req, res, body);
    }
    if (route === "razorpay" && rest[1] === "order" && req.method === "POST") {
      const body = await readBody(req, 1e6).catch(() => Buffer.alloc(0));
      return apiRazorpayOrder(res, body);
    }
    if (route === "razorpay" && rest[1] === "verify" && req.method === "POST") {
      const body = await readBody(req, 1e6).catch(() => Buffer.alloc(0));
      return apiRazorpayVerify(res, body);
    }
    if (route === "preview" && req.method === "POST") {
      const body = await readBody(req, 8e6).catch(() => Buffer.alloc(0));
      return apiPreview(req, res, body);
    }
    if (route === "session") {
      if (!isAuthed(req)) {
        res.writeHead(401, { "Content-Type": "application/json" }).end(JSON.stringify({ ok: false }));
        return;
      }
      res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ ok: true }));
      return;
    }

    if (!isAuthed(req)) { res.writeHead(401, { "Content-Type": "application/json" }).end(JSON.stringify({ error: "unauthorized" })); return; }

    if (route === "couples" && req.method === "GET") return apiCouples(res);
    if (route === "couples" && req.method === "POST") {
      const body = await readBody(req, 1e6).catch(() => Buffer.alloc(0));
      return apiCreateCouple(res, body);
    }
    if (route === "templates" && req.method === "GET") {
      res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ templates: listTemplates() }));
      return;
    }
    if (route === "couples" && req.method === "PUT" && rest[1]) {
      const body = await readBody(req, 5e6);
      return apiUpdateCouple(req, res, body, rest.slice(1));
    }
    if (route === "couples" && req.method === "DELETE" && rest[1]) return apiDeleteCouple(req, res, rest.slice(1));
    if (route === "upload" && req.method === "POST") {
      const ct = req.headers["content-type"] || "";
      const body = await readBody(req);
      return apiUpload(req, res, body, ct);
    }
    res.writeHead(404, { "Content-Type": "application/json" }).end(JSON.stringify({ error: "no such api route" }));
  } catch (e) {
    res.writeHead(500, { "Content-Type": "application/json" }).end(JSON.stringify({ error: String(e && e.message || e) }));
  }
});

server.listen(PORT, () => {
  console.log(`Wedding Dashboard running → http://127.0.0.1:${PORT}`);
  console.log(`  demo  : http://127.0.0.1:${PORT}/`);
  console.log(`  admin : http://127.0.0.1:${PORT}/admin`);
  console.log(`  data  : ${SB.enabled() ? "Supabase" : "JSON fallback (data/couples.json)"}`);
});
