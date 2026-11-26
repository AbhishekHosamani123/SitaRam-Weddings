/**
 * Vercel serverless function — verify a Razorpay payment signature (production).
 * Mirrors POST /api/razorpay/verify on the local server (server.js).
 * A successful verification records the order in the Supabase `orders`
 * table; the public publish endpoint only marks a couple as paid when the
 * order exists (one-time use).
 */
const { verifyPayment, websitePricePaise, previewPaymentsEnabled } = require("../lib/razorpay");
const SB = require("../lib/supabase");
const DRAFTS = require("../lib/preview-drafts");

function parseBody(req) {
  const raw = req.body;
  if (!raw) return {};
  if (typeof raw === "object" && !Buffer.isBuffer(raw)) return raw;
  try { return JSON.parse(Buffer.isBuffer(raw) ? raw.toString("utf8") : raw); } catch { return {}; }
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "method not allowed" });
    return;
  }
  const b = parseBody(req);
  if (!verifyPayment(b.order_id, b.payment_id, b.signature)) {
    res.status(400).json({ error: "Invalid payment signature." });
    return;
  }
  if (b.draft_token) {
    if (!previewPaymentsEnabled()) {
      res.status(503).json({ error: "Preview checkout requires Razorpay test credentials. Explicitly enable live preview payments only after testing." });
      return;
    }
    try {
      const draft = await DRAFTS.getDraft(String(b.draft_token));
      if (!draft || DRAFTS.isExpired(draft) && draft.status === "unpaid" && !DRAFTS.paymentWindowOpen(draft)) {
        res.status(410).json({ error: "This preview has expired." });
        return;
      }
      await DRAFTS.markPaymentVerified(draft, {
        order_id: String(b.order_id),
        payment_id: String(b.payment_id),
        signature: String(b.signature),
      });
      res.status(200).json({ ok: true, payment_status: "paid" });
    } catch (error) {
      res.status(error.status || 409).json({ error: String(error && error.message || "Payment could not be linked to this preview.") });
    }
    return;
  }
  if (SB.enabled()) {
    try {
      await SB.insert("orders", {
        order_id: b.order_id,
        payment_id: b.payment_id,
        signature: b.signature || null,
        amount: websitePricePaise(),
        couple_slug: null,
        created_at: new Date().toISOString(),
      }, { onConflict: "order_id" });
    } catch { /* non-fatal */ }
  }
  res.status(200).json({ ok: true });
};
