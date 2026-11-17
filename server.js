#!/usr/bin/env node
/**
 * Wedding Dashboard server (dependency-free).
 *
 *   • serves the static site (public/) — the demo at /, couple pages at /<slug>/
 *   • serves the Dashboard at /admin
 *   • local API for the Dashboard: auth, couples CRUD, image uploads,
 *     build (regenerate pages) and publish (git commit + push).
 *
 * Run: node server.js   (port 8080 by default, override with PORT=…)
 */
const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { spawn } = require("child_process");

const ROOT = __dirname;
const PUBLIC = path.join(ROOT, "public");
const DATA_DIR = path.join(ROOT, "data");
const COUPLES_FILE = path.join(DATA_DIR, "couples.json");
const ADMIN_FILE = path.join(DATA_DIR, "admin.json");
const IMG_ROOT = path.join(PUBLIC, "mirror", "framerusercontent.com", "images");
const PORT = Number(process.env.PORT || 8080);

// ---------------------------------------------------------------------------
// data helpers
// ---------------------------------------------------------------------------
function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}
function writeJsonAtomic(file, obj) {
  const tmp = file + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2));
  fs.renameSync(tmp, file);
}
function getCouples() { return readJson(COUPLES_FILE); }
function saveCouples(db) { writeJsonAtomic(COUPLES_FILE, db); }

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

function apiCouples(res) {
  res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify(getCouples()));
}

function apiCreateCouple(res) {
  const db = getCouples();
  const id = db.couples.reduce((m, c) => Math.max(m, c.id), 0) + 1;
  const demo = db.couples.find((c) => c.demo) || db.couples[0] || {};
  const couple = {
    id,
    slug: "",
    demo: false,
    active: false,
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
  db.couples.push(couple);
  saveCouples(db);
  res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify(couple));
}

function apiUpdateCouple(req, res, body, rest) {
  const db = getCouples();
  const id = Number(rest[0]);
  const idx = db.couples.findIndex((c) => c.id === id);
  if (idx === -1) { res.writeHead(404).end("Not found"); return; }
  let b;
  try { b = JSON.parse(body.toString()); } catch { b = {}; }
  // enforce unique slugs (case-insensitive)
  if (typeof b.slug === "string") {
    const norm = b.slug.trim().toLowerCase();
    if (!norm || norm === "couple") { res.writeHead(400, { "Content-Type": "application/json" }).end(JSON.stringify({ error: "Slug cannot be empty" })); return; }
    const clash = db.couples.some((c) => c.id !== id && String(c.slug).toLowerCase() === norm);
    if (clash) { res.writeHead(409, { "Content-Type": "application/json" }).end(JSON.stringify({ error: "That URL slug is already used by another couple" })); return; }
  }
  const merged = { ...db.couples[idx], ...b, id, slug: b.slug !== undefined ? String(b.slug).trim() : db.couples[idx].slug };
  db.couples[idx] = merged;
  saveCouples(db);
  res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify(merged));
}

function apiDeleteCouple(req, res, rest) {
  const db = getCouples();
  const id = Number(rest[0]);
  const idx = db.couples.findIndex((c) => c.id === id);
  if (idx === -1) { res.writeHead(404).end("Not found"); return; }
  if (db.couples[idx].demo) { res.writeHead(400).end("Cannot delete the demo couple"); return; }
  db.couples.splice(idx, 1);
  saveCouples(db);
  res.writeHead(200).end("{}");
}

const SLOTS = new Set(["hero", "bridePhoto", "groomPhoto", "portrait", "gallery1", "gallery2", "gallery3", "gallery4", "gallery5", "gallery6"]);
const ALLOWED_EXT = new Set([".jpg", ".jpeg", ".png", ".webp", ".gif"]);

function apiUpload(req, res, body, ct) {
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
  const dir = path.join(IMG_ROOT, "couples", slug);
  fs.mkdirSync(dir, { recursive: true });
  const name = `${slot}${ext}`;
  fs.writeFileSync(path.join(dir, name), file.body);
  const url = `/mirror/framerusercontent.com/images/couples/${slug}/${name}`;
  res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ url, slot, filename: name }));
}

function runCmd(cmd, args, cwd) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { cwd, shell: process.platform === "win32" });
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (out += d));
    child.on("close", (code) => resolve({ code, out }));
  });
}

async function apiBuild(res) {
  const r = await runCmd(process.execPath, [path.join(ROOT, "tools", "build.js")], ROOT);
  res.writeHead(r.code === 0 ? 200 : 500, { "Content-Type": "application/json" })
    .end(JSON.stringify({ ok: r.code === 0, code: r.code, output: r.out.slice(-4000) }));
}

async function apiPublish(res) {
  const steps = [];
  let r = await runCmd("git", ["add", "-A"], ROOT);
  if (r.code !== 0) { steps.push("git add failed: " + r.out); }
  r = await runCmd("git", ["commit", "-m", "Dashboard: update wedding site"], ROOT);
  steps.push(r.out.trim() || "(commit produced no output)");
  r = await runCmd("git", ["push", "origin", "main"], ROOT);
  steps.push(r.out.trim() || "(push produced no output)");
  const ok = !steps.some((s) => s.includes("failed"));
  res.writeHead(ok ? 200 : 500, { "Content-Type": "application/json" })
    .end(JSON.stringify({ ok, steps }));
}

// ---------------------------------------------------------------------------
// router
// ---------------------------------------------------------------------------
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  const p = url.pathname;

  // public/static
  if (!p.startsWith("/api/")) {
    if (p === "/admin" || p.startsWith("/admin/")) {
      const rel = p.slice("/admin/".length) || "index.html";
      serveStatic(res, path.join(ROOT, "admin", decodeURIComponent(rel)), path.join(ROOT, "admin"));
      return;
    }
    serveStatic(res, path.join(PUBLIC, decodeURIComponent(p)));
    return;
  }

  // api
  const rest = p.slice("/api/".length).split("/").filter(Boolean);
  const route = rest[0] || "";

  if (route === "login" && req.method === "POST") {
    const body = await readBody(req, 1e6).catch(() => Buffer.alloc(0));
    return apiLogin(req, res, body);
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

  try {
    if (route === "couples" && req.method === "GET") return apiCouples(res);
    if (route === "couples" && req.method === "POST") return apiCreateCouple(res);
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
    if (route === "build" && req.method === "POST") return apiBuild(res);
    if (route === "publish" && req.method === "POST") return apiPublish(res);
    res.writeHead(404, { "Content-Type": "application/json" }).end(JSON.stringify({ error: "no such api route" }));
  } catch (e) {
    res.writeHead(500, { "Content-Type": "application/json" }).end(JSON.stringify({ error: String(e && e.message || e) }));
  }
});

server.listen(PORT, () => {
  console.log(`Wedding Dashboard running → http://127.0.0.1:${PORT}`);
  console.log(`  demo  : http://127.0.0.1:${PORT}/`);
  console.log(`  admin : http://127.0.0.1:${PORT}/admin`);
});
