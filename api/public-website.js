/**
 * Vercel serverless — public self-service publishing (no login).
 * Mirrors POST /api/public-website on the local server (server.js),
 * but fully backed by Supabase (couples table + couple-images bucket).
 *
 * Requires env vars in the Vercel project:
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, RZP_KEY_ID, RZP_KEY_SECRET,
 *   WEBSITE_PRICE_PAISE
 */
const fs = require("fs");
const https = require("https");
const path = require("path");
const SB = require("../lib/supabase");
const RZP = require("../lib/razorpay");

const ROOT = path.join(__dirname, "..");
const TEMPLATES_DIR = path.join(ROOT, "templates");

function listTemplates() {
  const out = [];
  if (!fs.existsSync(TEMPLATES_DIR)) return out;
  for (const name of fs.readdirSync(TEMPLATES_DIR)) {
    const dir = path.join(TEMPLATES_DIR, name);
    const metaPath = path.join(dir, "template.json");
    if (!fs.existsSync(metaPath) || !fs.existsSync(path.join(dir, "index.html"))) continue;
    try {
      const meta = JSON.parse(fs.readFileSync(metaPath, "utf8"));
      if (meta.disabled) continue;
      out.push(meta.id || name);
    } catch { /* skip */ }
  }
  return out;
}

function parseBody(req) {
  const raw = req.body;
  if (!raw) return {};
  if (typeof raw === "object" && !Buffer.isBuffer(raw)) return raw;
  try { return JSON.parse(Buffer.isBuffer(raw) ? raw.toString("utf8") : raw); } catch { return {}; }
}

function safeSlug(s) {
  return String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "couple";
}
function strip(s, max) {
  return String(s == null ? "" : s).trim().slice(0, max || 2000);
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

const MIME_EXT = { "image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp", "image/gif": ".gif" };

async function saveImageData(dataUrl, slug, slot) {
  const m = /^data:([a-z/+]+);base64,(.+)$/.exec(dataUrl || "");
  if (!m) return null;
  const ext = MIME_EXT[m[1].toLowerCase()];
  if (!ext) return null;
  const buf = Buffer.from(m[2], "base64");
  if (buf.length < 100 || buf.length > 2.5 * 1024 * 1024) return null;
  try {
    return await SB.uploadImage(`couples/${slug}/${slot}${ext}`, buf, "image/jpeg");
  } catch { return null; }
}

// The recorded order for a verified Razorpay payment (or null).
// Recorded by /api/razorpay/verify with couple_slug = null.
async function paidOrder(orderId, paymentId, signature) {
  if (!RZP.verifyPayment(orderId, paymentId, signature)) return null;
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

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "method not allowed" });
    return;
  }
  const b = parseBody(req);
  const tplIds = listTemplates();
  const template = tplIds.includes(b.template) ? b.template : null;
  const c = (b.couple && typeof b.couple === "object") ? b.couple : {};
  const brideName = strip(c.bride && c.bride.firstName, 40);
  const groomName = strip(c.groom && c.groom.firstName, 40);
  const contact = strip(c.contact, 20).replace(/\D/g, "").slice(0, 15);
  if (!template || !brideName || !groomName) {
    res.status(400).json({ error: "Choose a template and provide bride & groom first names." });
    return;
  }
  if (contact.length < 10) {
    res.status(400).json({ error: "Please provide a valid 10-digit contact number (required)." });
    return;
  }

  const pay = (b.payment && typeof b.payment === "object") ? b.payment : {};
  const order = await paidOrder(pay.order_id, pay.payment_id, pay.signature);

  const { json: rows } = await SB.select("couples", { order: "created_at.asc" });
  const all = (rows || []).map(rowToCouple);

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
  // is simply updating the same published site
  const alreadyPaid = existing && existing.source === "public" && existing.paymentStatus === "paid";
  // a payment counts only once: it must be claimed for THIS slug
  const paid = order ? await claimOrder(order, slug, all) : false;
  if (order && !paid && !alreadyPaid) {
    res.status(402).json({ error: "This payment has already been used for another website. Please complete a new checkout." });
    return;
  }
  if (!paid && !alreadyPaid) {
    res.status(402).json({ error: "Payment required before publishing. Please complete the ₹999 checkout." });
    return;
  }

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

  try {
    if (existing) {
      await SB.update("couples", { id: existing.id }, coupleToRow(couple));
    } else {
      const row = coupleToRow(couple);
      const { json } = await SB.insert("couples", { ...row, created_at: new Date().toISOString(), updated_at: new Date().toISOString() });
      if (json && json[0]) slug = json[0].slug || slug;
    }
    if (paid) {
      try {
        await SB.insert("orders", {
          order_id: pay.order_id,
          payment_id: pay.payment_id,
          signature: pay.signature || null,
          amount: RZP.websitePricePaise(),
          couple_slug: slug,
          created_at: new Date().toISOString(),
        }, { onConflict: "order_id" });
      } catch { /* non-fatal */ }
    }
    const base = process.env.SITE_URL || "https://sitaram-weddings.vercel.app";
    res.status(200).json({ ok: true, slug, url: `${base}/${slug}/` });
  } catch (e) {
    res.status(500).json({ error: "Could not publish right now.", detail: String(e && e.message || e) });
  }
};
