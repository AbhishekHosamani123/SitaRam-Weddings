const B = require("../tools/build");
const DRAFTS = require("../lib/preview-drafts");

function parseBody(req) {
  const raw = req.body;
  if (!raw) return {};
  if (typeof raw === "object" && !Buffer.isBuffer(raw)) return raw;
  try { return JSON.parse(Buffer.isBuffer(raw) ? raw.toString("utf8") : raw); } catch { return {}; }
}

function baseUrl(req) {
  const host = String(req.headers["x-forwarded-host"] || req.headers.host || "").split(",")[0].trim();
  if (/^[a-z0-9.-]+(:\d+)?$/i.test(host)) {
    const protocol = String(req.headers["x-forwarded-proto"] || "https").split(",")[0].trim();
    return `${protocol === "http" ? "http" : "https"}://${host}`;
  }
  return String(process.env.SITE_URL || "https://sitaram-weddings.vercel.app").replace(/\/+$/, "");
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "method not allowed" });
    return;
  }
  const body = parseBody(req);
  const template = String(body.template || "");
  if (!B.discoverTemplates().some((item) => item.id === template)) {
    res.status(400).json({ error: "Choose an available wedding template." });
    return;
  }
  try {
    const saved = await DRAFTS.createOrUpdateDraft(template, body.couple, String(body.draft_token || ""));
    res.setHeader("Cache-Control", "no-store");
    res.status(201).json({
      draft_token: saved.token,
      preview_url: `${baseUrl(req)}/preview/${saved.token}`,
      expires_at: saved.expiresAt,
    });
  } catch (error) {
    const message = String(error && error.message || error);
    const status = error.status || (message.includes("Supabase must be configured") ? 503 : 400);
    res.status(status).json({ error: message });
  }
};
