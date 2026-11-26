/**
 * Supabase REST client (zero-dependency — plain HTTPS against PostgREST
 * and the Storage API). Used by server.js (local) and api/*.js (Vercel).
 *
 * Env vars:
 *   SUPABASE_URL                 https://<project-ref>.supabase.co
 *   SUPABASE_ANON_KEY            anon key (public)
 *   SUPABASE_SERVICE_ROLE_KEY    service_role key (server-only — bypasses RLS)
 */
const https = require("https");

const BUCKET = process.env.SUPABASE_BUCKET || "couple-images";

function cfg() {
  const url = (process.env.SUPABASE_URL || "").replace(/\/+$/, "");
  return {
    url,
    anon: process.env.SUPABASE_ANON_KEY || "",
    service: process.env.SUPABASE_SERVICE_ROLE_KEY || "",
  };
}

function enabled() {
  const c = cfg();
  return !!(c.url && c.service);
}

function request(pathname, { method = "GET", key = "service", body, headers = {}, rawBody } = {}) {
  return new Promise((resolve, reject) => {
    const c = cfg();
    const u = new URL(c.url);
    const token = key === "anon" ? c.anon : c.service;
    const data = rawBody !== undefined ? rawBody : (body !== undefined ? JSON.stringify(body) : null);
    const h = {
      apikey: token,
      Authorization: "Bearer " + token,
      ...headers,
      ...(data !== null && rawBody === undefined ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data) } : {}),
    };
    const req = https.request({ host: u.host, path: pathname, method, headers: h }, (res) => {
      let out = "";
      res.on("data", (d) => (out += d));
      res.on("end", () => {
        let json = null;
        try { json = out ? JSON.parse(out) : null; } catch { json = { raw: out.slice(0, 500) }; }
        if (res.statusCode >= 200 && res.statusCode < 300) return resolve({ status: res.statusCode, json });
        const err = new Error((json && (json.message || json.error || json.hint)) || `Supabase HTTP ${res.statusCode}`);
        err.status = res.statusCode;
        err.detail = json;
        reject(err);
      });
    });
    req.on("error", reject);
    if (data !== null) req.write(data);
    req.end();
  });
}

// ---------------------------------------------------------------------------
// PostgREST helpers
// ---------------------------------------------------------------------------
function select(table, { select = "*", eq, limit, order } = {}) {
  const q = new URLSearchParams();
  q.set("select", select);
  if (eq) for (const [k, v] of Object.entries(eq)) q.set(k, `eq.${v}`);
  if (limit) q.set("limit", String(limit));
  if (order) q.set("order", order);
  return request(`/rest/v1/${table}?${q.toString()}`);
}

function insert(table, rows, { onConflict, select = "*" } = {}) {
  const headers = { Prefer: "return=representation" };
  if (onConflict) headers["Prefer"] = `resolution=ignore-duplicates,return=representation`;
  return request(`/rest/v1/${table}?select=${encodeURIComponent(select)}${onConflict ? `&on_conflict=${onConflict}` : ""}`, {
    method: "POST",
    body: Array.isArray(rows) || typeof rows === "object" ? rows : rows,
    headers,
  });
}

function upsert(table, rows, { onConflict, select = "*" } = {}) {
  const headers = {
    Prefer: "resolution=merge-duplicates,return=representation",
    "Content-Type": "application/json",
  };
  return request(`/rest/v1/${table}?select=${encodeURIComponent(select)}${onConflict ? `&on_conflict=${onConflict}` : ""}`, {
    method: "POST",
    body: Array.isArray(rows) ? rows : [rows],
    headers,
  });
}

function update(table, eq, patch, { select = "*" } = {}) {
  const q = new URLSearchParams();
  if (eq) for (const [k, v] of Object.entries(eq)) q.set(k, `eq.${v}`);
  return request(`/rest/v1/${table}?${q.toString()}&select=${encodeURIComponent(select)}`, {
    method: "PATCH",
    body: patch,
    headers: { Prefer: "return=representation" },
  });
}

function remove(table, eq) {
  const q = new URLSearchParams();
  if (eq) for (const [k, v] of Object.entries(eq)) q.set(k, `eq.${v}`);
  return request(`/rest/v1/${table}?${q.toString()}`, { method: "DELETE" });
}

function deleteExpiredDrafts(now = new Date().toISOString()) {
  const q = new URLSearchParams();
  q.set("status", "eq.unpaid");
  q.set("expires_at", `lte.${now}`);
  q.set("or", `(payment_pending_until.is.null,payment_pending_until.lte.${now})`);
  return request(`/rest/v1/preview_drafts?${q.toString()}`, { method: "DELETE" });
}

// ---------------------------------------------------------------------------
// Storage helpers
// ---------------------------------------------------------------------------
function uploadImage(objectPath, buffer, contentType) {
  return request(`/storage/v1/object/${BUCKET}/${objectPath}`, {
    method: "PUT",
    rawBody: buffer,
    headers: {
      "Content-Type": contentType || "application/octet-stream",
      "x-upsert": "true",
    },
  }).then(() => publicUrl(objectPath));
}

function removeImage(objectPath) {
  const safePath = String(objectPath).split("/").map(encodeURIComponent).join("/");
  return request(`/storage/v1/object/${BUCKET}/${safePath}`, { method: "DELETE" });
}

function publicUrl(objectPath) {
  const c = cfg();
  return `${c.url}/storage/v1/object/public/${BUCKET}/${objectPath}`;
}

module.exports = {
  cfg,
  enabled,
  BUCKET,
  select,
  insert,
  upsert,
  update,
  remove,
  deleteExpiredDrafts,
  uploadImage,
  removeImage,
  publicUrl,
};
