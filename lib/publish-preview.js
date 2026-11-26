const SB = require("./supabase");
const DRAFTS = require("./preview-drafts");

const IMAGE_SLOTS = ["hero", "bridePhoto", "groomPhoto", "portrait", "gallery1", "gallery2", "gallery3", "gallery4", "gallery5", "gallery6"];
const MIME_EXT = { "image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp" };

function safeSlug(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "couple";
}

async function saveImage(dataUrl, slug, slot) {
  if (!dataUrl) return null;
  if (/^https:\/\//i.test(dataUrl)) return dataUrl;
  const match = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
  if (!match) throw new Error(`The ${slot} image is invalid.`);
  const ext = MIME_EXT[match[1]];
  const buffer = Buffer.from(match[2], "base64");
  if (!buffer.length || buffer.length > 2.5 * 1024 * 1024) throw new Error(`The ${slot} image is too large.`);
  return SB.uploadImage(`couples/${slug}/${slot}${ext}`, buffer, match[1]);
}

async function publishPreview(token) {
  const draft = await DRAFTS.getDraft(token);
  if (!draft) {
    const error = new Error("Preview not found or expired.");
    error.status = 404;
    throw error;
  }
  if (draft.status === "published" && draft.couple_slug) return { slug: draft.couple_slug };
  if (draft.status !== "paid") {
    const error = new Error("Verified payment is required before publishing.");
    error.status = 402;
    throw error;
  }
  const payment = await DRAFTS.getVerifiedPayment(draft);
  if (!payment) {
    const error = new Error("Payment verification is still processing. Please retry in a moment.");
    error.status = 409;
    throw error;
  }
  if (!draft.draft_data) {
    const error = new Error("The paid preview data is unavailable. Contact support.");
    error.status = 500;
    throw error;
  }

  const { json: alreadyPublished } = await SB.select("couples", {
    select: "slug",
    eq: { payment_ref: payment.payment_id },
    limit: 1,
  });
  if (alreadyPublished && alreadyPublished[0]) {
    await DRAFTS.updatePublishedDraft(draft, alreadyPublished[0].slug);
    return { slug: alreadyPublished[0].slug };
  }

  const { json: rows } = await SB.select("couples", { select: "slug", order: "created_at.asc" });
  const taken = new Set((rows || []).map((row) => String(row.slug).toLowerCase()));
  const bride = draft.draft_data.bride || {};
  const groom = draft.draft_data.groom || {};
  const baseSlug = safeSlug((bride.firstName || "Bride") + "-" + (groom.firstName || "Groom"));
  let slug = baseSlug;
  for (let suffix = 2; taken.has(slug.toLowerCase()); suffix++) slug = `${baseSlug}-${suffix}`;

  const sourceImages = draft.draft_data.images || {};
  const images = {};
  const uploadedPaths = [];
  try {
    for (const slot of IMAGE_SLOTS) {
      const url = await saveImage(sourceImages[slot], slug, slot);
      images[slot] = url;
      if (url && !/^https:\/\//i.test(sourceImages[slot] || "")) {
        const ext = MIME_EXT[(String(sourceImages[slot]).match(/^data:(image\/(?:jpeg|png|webp));/) || [])[1]];
        uploadedPaths.push(`couples/${slug}/${slot}${ext}`);
      }
    }

    const coupleData = {
      bride,
      groom,
      invitation: draft.draft_data.invitation || {},
      events: draft.draft_data.events || [],
      countdownTarget: draft.draft_data.countdownTarget || "",
      whatsapp: draft.draft_data.whatsapp || {},
      gallery: IMAGE_SLOTS.slice(4).map((slot) => images[slot]),
      images: {
        hero: images.hero,
        bridePhoto: images.bridePhoto,
        groomPhoto: images.groomPhoto,
        portrait: images.portrait,
      },
      thingsToKnow: [
        { key: "weather", title: "Weather", text: "" },
        { key: "staff", title: "Staff", text: "" },
        { key: "parking", title: "Parking", text: "" },
      ],
    };
    const now = new Date().toISOString();
    const row = {
      slug,
      template: draft.template_id,
      title: `${bride.firstName || "Bride"} & ${groom.firstName || "Groom"} | Wedding Invitation`,
      meta_description: `Join us to celebrate the wedding of ${bride.firstName || "Bride"} & ${groom.firstName || "Groom"}.`,
      source: "public",
      demo: false,
      active: true,
      payment_status: "paid",
      payment_ref: payment.payment_id,
      paid_at: now,
      contact: "",
      data: coupleData,
      created_at: now,
      updated_at: now,
    };
    const inserted = await SB.insert("couples", row, { onConflict: "slug" });
    const couple = inserted.json && inserted.json[0];
    if (!couple) {
      const { json: existing } = await SB.select("couples", { select: "slug,payment_ref", eq: { payment_ref: payment.payment_id }, limit: 1 });
      if (!existing || !existing[0]) throw new Error("Could not publish the paid wedding website.");
      slug = existing[0].slug;
    } else {
      slug = couple.slug || slug;
    }
    await SB.update("orders", { order_id: payment.order_id }, { couple_slug: slug });
    await DRAFTS.updatePublishedDraft(draft, slug);
    return { slug };
  } catch (error) {
    const cleanupResults = await Promise.all(uploadedPaths.map(async (objectPath) => {
      try { await SB.removeImage(objectPath); return null; }
      catch (cleanupError) { return cleanupError; }
    }));
    const cleanupError = cleanupResults.find(Boolean);
    if (cleanupError) error.message += ` (Also failed to remove a temporary image: ${cleanupError.message})`;
    throw error;
  }
}

module.exports = { publishPreview };
