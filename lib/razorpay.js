/**
 * Shared Razorpay helper (zero-dependency).
 * Used both by server.js (local dashboard) and api/*.js (Vercel serverless).
 *
 * Reads RZP_KEY_ID / RZP_KEY_SECRET / WEBSITE_PRICE_PAISE from the environment
 * (server.js loads .env locally; Vercel injects project env vars).
 */
const https = require("https");
const crypto = require("crypto");

// one-time price for publishing a couple website (paise: 99900 = ₹999)
function websitePricePaise() {
  return Number(process.env.WEBSITE_PRICE_PAISE || 99900);
}

function authHeader() {
  const id = process.env.RZP_KEY_ID || "";
  const secret = process.env.RZP_KEY_SECRET || "";
  return "Basic " + Buffer.from(id + ":" + secret).toString("base64");
}

function apiRequest(method, pathname, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const req = https.request({
      host: "api.razorpay.com",
      port: 443,
      path: "/v1" + pathname,
      method,
      headers: {
        Authorization: authHeader(),
        "Content-Type": "application/json",
        ...(data ? { "Content-Length": Buffer.byteLength(data) } : {}),
      },
    }, (res) => {
      let out = "";
      res.on("data", (d) => (out += d));
      res.on("end", () => {
        let json = {};
        try { json = out ? JSON.parse(out) : {}; } catch { /* non-JSON error body */ }
        if (res.statusCode >= 200 && res.statusCode < 300) return resolve(json);
        const err = json.error || {};
        reject(new Error(err.description || err.reason || `Razorpay HTTP ${res.statusCode}`));
      });
    });
    req.on("error", reject);
    if (data) req.write(data);
    req.end();
  });
}

// create a payment order (this does not charge anything — the client-side
// checkout completes it later)
async function createOrder(amountPaise, receipt) {
  return apiRequest("POST", "/orders", {
    amount: amountPaise,
    currency: "INR",
    receipt: String(receipt || "").slice(0, 40),
    notes: { product: "wedding-website" },
  });
}

// verify the signature Razorpay returns after a payment, using the key secret
function verifyPayment(orderId, paymentId, signature) {
  if (!orderId || !paymentId || !signature) return false;
  const expected = crypto
    .createHmac("sha256", process.env.RZP_KEY_SECRET || "")
    .update(String(orderId) + "|" + String(paymentId))
    .digest("hex");
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(String(signature), "utf8");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

module.exports = { createOrder, verifyPayment, websitePricePaise };
