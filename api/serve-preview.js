const DRAFTS = require("../lib/preview-drafts");
const { renderPreviewShell } = require("../lib/preview-page");

function sendExpired(res) {
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Robots-Tag", "noindex, nofollow, noarchive");
  res.status(410).send("<!doctype html><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width\"><title>Preview expired</title><main style=\"font:16px system-ui;max-width:560px;margin:12vh auto;padding:24px;text-align:center\"><h1>This wedding preview has expired</h1><p>Unpaid preview data is removed after 24 hours. Return to the builder to create a new preview.</p><a href=\"/create\">Back to the builder</a></main>");
}

module.exports = async function handler(req, res) {
  if (req.method !== "GET") {
    res.status(405).end("Method not allowed");
    return;
  }
  try {
    const token = String(req.query.token || "");
    const draft = await DRAFTS.getDraft(token);
    if (!draft) return sendExpired(res);
    if (draft.status === "published" && draft.couple_slug) {
      res.setHeader("Cache-Control", "no-store");
      res.redirect(302, `/${encodeURIComponent(draft.couple_slug)}/`);
      return;
    }
    if (draft.status === "unpaid" && DRAFTS.isExpired(draft)) {
      if (!DRAFTS.paymentWindowOpen(draft)) await DRAFTS.deleteDraft(draft.id);
      return sendExpired(res);
    }
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Robots-Tag", "noindex, nofollow, noarchive");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.status(200).send(renderPreviewShell({
      token,
      expiresAt: draft.expires_at,
      paid: draft.status === "paid",
    }));
  } catch (error) {
    res.status(503).json({ error: "Could not load this preview right now." });
  }
};
