#!/usr/bin/env node
/**
 * One-time seed: migrate data/couples.json into Supabase (couples table).
 * Idempotent — upserts by slug (an existing row keeps its id but takes the
 * latest file data).
 *
 * Run:  node tools/seed-supabase.js
 * Requires SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in .env.
 */
const fs = require("fs");
const path = require("path");
const SB = require("../lib/supabase");

const ROOT = path.join(__dirname, "..");
const COUPLES_FILE = path.join(ROOT, "data", "couples.json");

// minimal .env loader (matches server.js)
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

if (!SB.enabled()) {
  console.error("Supabase is not configured. Add SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY to .env");
  process.exit(1);
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

async function main() {
  const db = JSON.parse(fs.readFileSync(COUPLES_FILE, "utf8"));
  const couples = db.couples || [];
  console.log(`Seeding ${couples.length} couples → Supabase`);

  const { json: existingRows } = await SB.select("couples", { select: "id,slug" });
  const existing = new Map((existingRows || []).map((r) => [String(r.slug).toLowerCase(), r.id]));

  let inserted = 0;
  let updated = 0;
  for (const c of couples) {
    const slug = String(c.slug || "").trim().toLowerCase();
    if (!slug) continue;
    const row = {
      slug,
      template: c.template || "ram-mandir",
      title: c.title || "",
      meta_description: c.metaDescription || null,
      source: c.source || (c.demo ? "admin" : "public"),
      demo: !!c.demo,
      active: c.active !== false,
      payment_status: c.paymentStatus || "unpaid",
      payment_ref: c.paymentRef || null,
      paid_at: c.paidAt ? new Date(c.paidAt).toISOString() : null,
      contact: c.contact || "",
      data: (({ id, slug, template, title, metaDescription, source, demo, active, paymentStatus, paymentRef, paidAt, contact, createdAt, ...data }) => data)(c),
      created_at: c.createdAt ? new Date(c.createdAt).toISOString() : new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    if (existing.has(slug)) {
      await SB.update("couples", { id: existing.get(slug) }, row);
      updated++;
    } else {
      await SB.insert("couples", row);
      inserted++;
    }
  }
  console.log(`Done — inserted ${inserted}, updated ${updated}.`);
}

main().catch((e) => {
  console.error("Seed failed:", e && e.message || e);
  process.exit(1);
});
