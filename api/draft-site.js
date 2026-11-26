const DRAFTS = require("../lib/preview-drafts");
const { renderDraftPage } = require("../lib/render-draft");

module.exports = async function handler(req, res) {
  if (req.method !== "GET") {
    res.status(405).end("Method not allowed");
    return;
  }
  try {
    const draft = await DRAFTS.getDraft(String(req.query.token || ""));
    if (!draft || DRAFTS.isExpired(draft) && draft.status === "unpaid") {
      res.status(410).end("Preview expired.");
      return;
    }
    if (draft.status === "published" && draft.couple_slug) {
      res.redirect(302, `/${encodeURIComponent(draft.couple_slug)}/`);
      return;
    }
    if (!["unpaid", "paid"].includes(draft.status) || !draft.draft_data) {
      res.status(410).end("Preview unavailable.");
      return;
    }
    const html = renderDraftPage(draft, req);
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Robots-Tag", "noindex, nofollow, noarchive");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.status(200).send(html);
  } catch (error) {
    const status = Number.isInteger(error && error.status) && error.status >= 400 && error.status <= 599
      ? error.status
      : 500;
    res.setHeader("Cache-Control", "no-store");
    res.status(status).end(
      status === 503 ? "Preview storage is temporarily unavailable." : "Could not render this wedding preview."
    );
  }
};
