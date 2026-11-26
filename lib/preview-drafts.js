const crypto = require("crypto");
const SB = require("./supabase");
const RZP = require("./razorpay");

const PREVIEW_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_DRAFT_BYTES = 3_500_000;
const IMAGE_SLOTS = ["hero", "bridePhoto", "groomPhoto", "portrait", "gallery1", "gallery2", "gallery3", "gallery4", "gallery5", "gallery6"];

function strip(value, max = 2000) {
  return String(value == null ? "" : value).trim().slice(0, max);
}

function tokenHash(token) {
  return crypto.createHash("sha256").update(String(token)).digest("hex");
}

function requireSupabase() {
  if (!SB.enabled()) {
    const error = new Error("Supabase must be configured to save preview drafts.");
    error.status = 503;
    throw error;
  }
}

function invalidInput(message) {
  const error = new Error(message);
  error.status = 400;
  return error;
}

function normalizeDraft(template, input) {
  const couple = input && typeof input === "object" ? input : {};
  const bride = couple.bride && typeof couple.bride === "object" ? couple.bride : {};
  const groom = couple.groom && typeof couple.groom === "object" ? couple.groom : {};
  const contact = strip(couple.contact, 30).replace(/\D/g, "").slice(0, 15);
  const brideFirst = strip(bride.firstName, 40);
  const groomFirst = strip(groom.firstName, 40);

  if (!brideFirst || !groomFirst) throw invalidInput("Enter both bride and groom first names.");
  if (contact.length < 10) throw invalidInput("Enter a valid contact phone number.");

  const invitation = couple.invitation && typeof couple.invitation === "object" ? couple.invitation : {};
  const events = Array.isArray(couple.events) ? couple.events.slice(0, 6).map((event) => ({
    slot: 1,
    name: strip(event && event.name, 80) || "Shaadi",
    day: strip(event && event.day, 40),
    time: strip(event && event.time, 40),
    dateLabel: strip(event && event.dateLabel, 60),
    city: strip(event && event.city, 80),
    venueName: strip(event && event.venueName, 120),
    venueAddress: strip(event && event.venueAddress, 200),
    lat: strip(event && event.lat, 20),
    lng: strip(event && event.lng, 20),
    note: strip(event && event.note, 200) || "More details below",
  })).filter((event) => event.name) : [];
  if (!events.length) throw invalidInput("Add at least one wedding event.");

  const sourceImages = couple.images && typeof couple.images === "object" ? couple.images : {};
  const images = {};
  for (const slot of IMAGE_SLOTS) {
    const value = sourceImages[slot];
    if (value == null || value === "") {
      images[slot] = null;
      continue;
    }
    if (typeof value !== "string" || (!/^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(value) && !/^https:\/\//i.test(value))) {
      throw invalidInput(`The ${slot} image is not in a supported format.`);
    }
    images[slot] = value;
  }

  const coupleData = {
    template,
    bride: {
      firstName: brideFirst,
      fullName: strip(bride.fullName, 120),
      parents: strip(bride.parents, 200),
    },
    groom: {
      firstName: groomFirst,
      fullName: strip(groom.fullName, 120),
      parents: strip(groom.parents, 200),
    },
    invitation: {
      headline: strip(invitation.headline, 200) || "{bride} weds {groom}",
      intro: strip(invitation.intro, 300),
      story: strip(invitation.story, 3000),
      hashtag: strip(invitation.hashtag, 60),
      closing: strip(invitation.closing, 120) || "Looking forward to see you",
    },
    events,
    countdownTarget: /^\d{4}-\d{2}-\d{2}T/.test(String(couple.countdownTarget || "")) ? couple.countdownTarget : "",
    whatsapp: {
      display: strip(couple.whatsapp && couple.whatsapp.display, 20),
      intl: strip(couple.whatsapp && couple.whatsapp.intl, 20).replace(/\D/g, "").slice(0, 15),
    },
    gallery: IMAGE_SLOTS.slice(4).map((slot) => images[slot]),
    images,
  };
  const bytes = Buffer.byteLength(JSON.stringify(coupleData), "utf8");
  if (bytes > MAX_DRAFT_BYTES) throw invalidInput("Your photos are too large to save. Remove a few photos and try again.");
  return { coupleData, coupleNames: `${bride.fullName ? strip(bride.fullName, 120) : brideFirst} & ${groom.fullName ? strip(groom.fullName, 120) : groomFirst}`, phone: contact };
}

async function createDraft(template, input, now = Date.now()) {
  requireSupabase();
  const normalized = normalizeDraft(template, input);
  const token = crypto.randomBytes(32).toString("hex");
  const leadResult = await SB.insert("leads", {
    couple_names: normalized.coupleNames,
    phone: normalized.phone,
    payment_status: "unpaid",
    created_at: new Date(now).toISOString(),
    updated_at: new Date(now).toISOString(),
  });
  const lead = leadResult.json && leadResult.json[0];
  if (!lead || !lead.id) throw new Error("Could not save your contact details.");

  try {
    const result = await SB.insert("preview_drafts", {
      token_hash: tokenHash(token),
      lead_id: lead.id,
      template_id: template,
      draft_data: normalized.coupleData,
      status: "unpaid",
      expires_at: new Date(now + PREVIEW_TTL_MS).toISOString(),
      created_at: new Date(now).toISOString(),
      updated_at: new Date(now).toISOString(),
    });
    const draft = result.json && result.json[0];
    if (!draft || !draft.id) throw new Error("Could not save your preview.");
    return { token, expiresAt: draft.expires_at };
  } catch (error) {
    await SB.remove("leads", { id: lead.id });
    throw error;
  }
}

async function createOrUpdateDraft(template, input, token, now = Date.now()) {
  requireSupabase();
  const existing = token ? await getDraft(token) : null;
  if (existing && existing.status === "unpaid" && isExpired(existing, now) && paymentWindowOpen(existing, now)) {
    const error = new Error("A payment is still in progress for this preview. Please wait for it to finish before changing the details.");
    error.status = 409;
    throw error;
  }
  if (existing && existing.status === "unpaid" && !isExpired(existing, now)) {
    if (existing.payment_order_id) {
      const error = new Error("A payment is already in progress for this preview. Please finish payment or create a new preview.");
      error.status = 409;
      throw error;
    }
    const normalized = normalizeDraft(template, input);
    const updated = await SB.update("preview_drafts", { id: existing.id, status: "unpaid" }, {
      template_id: template,
      draft_data: normalized.coupleData,
      updated_at: new Date(now).toISOString(),
    });
    if (!updated.json || !updated.json.length) {
      const error = new Error("This preview changed while you were editing. Reload the page and try again.");
      error.status = 409;
      throw error;
    }
    await SB.update("leads", { id: existing.lead_id, payment_status: "unpaid" }, {
      couple_names: normalized.coupleNames,
      phone: normalized.phone,
      updated_at: new Date(now).toISOString(),
    });
    return { token, expiresAt: existing.expires_at, updated: true };
  }
  return createDraft(template, input, now);
}

async function deleteDraft(id) {
  requireSupabase();
  await SB.remove("preview_drafts", { id });
}

async function getDraft(token) {
  requireSupabase();
  if (!/^[a-f0-9]{64}$/i.test(String(token || ""))) return null;
  const { json } = await SB.select("preview_drafts", {
    select: "id,token_hash,lead_id,template_id,draft_data,status,expires_at,payment_pending_until,payment_order_id,payment_id,couple_slug,created_at",
    eq: { token_hash: tokenHash(token) },
    limit: 1,
  });
  return json && json[0] ? json[0] : null;
}

function isExpired(draft, now = Date.now()) {
  return !draft || Date.parse(draft.expires_at) <= now;
}

function paymentWindowOpen(draft, now = Date.now()) {
  const pendingUntil = draft && Date.parse(draft.payment_pending_until || "");
  return Number.isFinite(pendingUntil) && pendingUntil > now;
}

async function createPaymentOrder(draft, orderId, now = Date.now()) {
  requireSupabase();
  const expiresAt = Date.parse(draft.expires_at);
  if (expiresAt <= now || draft.status !== "unpaid") throw new Error("This preview has expired or is already unlocked.");
  await SB.insert("preview_payment_orders", {
    order_id: orderId,
    draft_id: draft.id,
    created_at: new Date(now).toISOString(),
  });
  const pendingUntil = new Date(now + 20 * 60 * 1000).toISOString();
  await SB.update("preview_drafts", { id: draft.id }, {
    payment_order_id: orderId,
    payment_pending_until: pendingUntil,
    updated_at: new Date(now).toISOString(),
  });
}

async function markPaymentVerified(draft, payment, now = Date.now()) {
  requireSupabase();
  const { json } = await SB.select("preview_payment_orders", {
    select: "order_id,draft_id,payment_id",
    eq: { order_id: payment.order_id },
    limit: 1,
  });
  const order = json && json[0];
  if (!order || order.draft_id !== draft.id) throw new Error("This payment does not belong to this preview.");
  if (draft.payment_id && draft.payment_id !== payment.payment_id) throw new Error("A different payment is already linked to this preview.");

  await SB.insert("orders", {
    order_id: payment.order_id,
    payment_id: payment.payment_id,
    signature: payment.signature,
    amount: RZP.websitePricePaise(),
    couple_slug: draft.couple_slug || null,
    created_at: new Date(now).toISOString(),
  }, { onConflict: "order_id" });
  await SB.update("preview_payment_orders", { order_id: payment.order_id }, {
    payment_id: payment.payment_id,
    signature: payment.signature,
    verified_at: new Date(now).toISOString(),
  });
  await SB.update("preview_drafts", { id: draft.id }, {
    status: draft.couple_slug ? "published" : "paid",
    payment_id: payment.payment_id,
    payment_order_id: payment.order_id,
    payment_pending_until: null,
    paid_at: new Date(now).toISOString(),
    updated_at: new Date(now).toISOString(),
  });
  await SB.update("leads", { id: draft.lead_id }, {
    payment_status: "paid",
    paid_at: new Date(now).toISOString(),
    updated_at: new Date(now).toISOString(),
  });
}

async function getVerifiedPayment(draft) {
  if (!draft || !draft.payment_order_id || !draft.payment_id) return null;
  const { json } = await SB.select("preview_payment_orders", {
    select: "order_id,payment_id,signature,verified_at",
    eq: { order_id: draft.payment_order_id, payment_id: draft.payment_id, draft_id: draft.id },
    limit: 1,
  });
  return json && json[0] && json[0].verified_at ? json[0] : null;
}

async function updatePublishedDraft(draft, slug, now = Date.now()) {
  requireSupabase();
  await SB.update("preview_drafts", { id: draft.id }, {
    status: "published",
    couple_slug: slug,
    draft_data: null,
    updated_at: new Date(now).toISOString(),
  });
}

async function cleanupExpiredDrafts(now = new Date()) {
  requireSupabase();
  return SB.deleteExpiredDrafts(now.toISOString());
}

module.exports = {
  MAX_DRAFT_BYTES,
  PREVIEW_TTL_MS,
  cleanupExpiredDrafts,
  createOrUpdateDraft,
  createDraft,
  createPaymentOrder,
  deleteDraft,
  getDraft,
  getVerifiedPayment,
  isExpired,
  markPaymentVerified,
  normalizeDraft,
  paymentWindowOpen,
  tokenHash,
  updatePublishedDraft,
};
