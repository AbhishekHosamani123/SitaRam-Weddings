/**
 * Vercel serverless function — create a Razorpay order (production).
 * Mirrors POST /api/razorpay/order on the local server (server.js).
 * Requires RZP_KEY_ID / RZP_KEY_SECRET env vars in the Vercel project.
 */
const { createOrder, websitePricePaise, previewPaymentsEnabled } = require("../lib/razorpay");
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
  const amt = Number(b.amount);
  const price = websitePricePaise();
  if (b.draft_token && !previewPaymentsEnabled()) {
    res.status(503).json({ error: "Preview checkout requires Razorpay test credentials. Explicitly enable live preview payments only after testing." });
    return;
  }
  if (!Number.isInteger(amt) || amt !== price) {
    res.status(400).json({ error: "Invalid amount." });
    return;
  }
  try {
    let draft = null;
    if (b.draft_token) {
      draft = await DRAFTS.getDraft(String(b.draft_token));
      if (!draft || DRAFTS.isExpired(draft) || draft.status !== "unpaid") {
        res.status(410).json({ error: "This preview has expired or is already unlocked." });
        return;
      }
    }
    const order = await createOrder(amt, "weds-" + Date.now());
    if (draft) await DRAFTS.createPaymentOrder(draft, order.id);
    res.status(200).json({
      order_id: order.id,
      key_id: process.env.RZP_KEY_ID,
      amount: order.amount,
      currency: order.currency || "INR",
    });
  } catch (e) {
    const status = String(e && e.message || "").includes("Supabase") ? 503 : 502;
    res.status(status).json({ error: String(e && e.message || "Payment provider unavailable — try again in a moment.") });
  }
};
