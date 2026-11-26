const { originFor } = require("../lib/render-draft");
const { publishPreview } = require("../lib/publish-preview");

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
  try {
    const { slug } = await publishPreview(String(parseBody(req).draft_token || ""));
    res.setHeader("Cache-Control", "no-store");
    res.status(200).json({ ok: true, slug, url: `${originFor(req)}/${encodeURIComponent(slug)}/` });
  } catch (error) {
    res.status(error.status || 500).json({ error: String(error && error.message || "Could not publish the wedding website.") });
  }
};
