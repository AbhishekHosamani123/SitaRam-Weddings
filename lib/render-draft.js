const path = require("path");
const B = require("../tools/build");
const RENDER = require("./render-couple");

const SITE_SUBDIR = "/mirror/framerusercontent.com/sites/" + path.basename(B.SITES_DIR) + "/";
const REL_SPEC_RE = /(["'`])(\.{1,2}\/[A-Za-z0-9._\-\/@%]+\.(?:mjs|js|css|json))\1/g;
const PAGE_SPEC = "srw-preview-page";

function originFor(req) {
  const host = String((req.headers && (req.headers["x-forwarded-host"] || req.headers.host)) || "").split(",")[0].trim();
  if (/^[a-z0-9.-]+(:\d+)?$/i.test(host)) {
    const protocol = String((req.headers && req.headers["x-forwarded-proto"]) || "https").split(",")[0].trim();
    return `${protocol === "http" ? "http" : "https"}://${host}`;
  }
  return String(process.env.SITE_URL || "https://sitaram-weddings.vercel.app").replace(/\/+$/, "");
}

function absolutize(src, dirUrl) {
  return src.replace(REL_SPEC_RE, (match, quote, specifier) => quote + new URL(specifier, dirUrl).href + quote);
}

function jsDataUrl(source) {
  return "data:text/javascript;base64," + Buffer.from(source, "utf8").toString("base64");
}

function addPreviewWatermark(html) {
  const overlay = `<style id="srw-preview-watermark-style">#srw-preview-watermark{position:fixed;inset:0;z-index:2147483647;pointer-events:none;opacity:.22;background:repeating-linear-gradient(-30deg,transparent 0 170px,#fff 171px 202px,transparent 203px 360px)}#srw-preview-watermark:after{content:"PREVIEW · PAY ₹999 TO UNLOCK";position:absolute;top:50%;left:50%;transform:translate(-50%,-50%) rotate(-24deg);padding:16px 25px;border:2px solid #a83e4c;border-radius:10px;color:#a83e4c;background:#fffdf9a8;font:800 clamp(18px,3vw,32px)/1.2 Arial,sans-serif;white-space:nowrap;letter-spacing:.04em}</style><div id="srw-preview-watermark" aria-hidden="true"></div>`;
  if (/<\/body\s*>/i.test(html)) return html.replace(/<\/body\s*>/i, overlay + "</body>");
  return html + overlay;
}

function renderDraftPage(draft, req) {
  const couple = { ...draft.draft_data, slug: "preview-" + draft.id.replace(/-/g, "") };
  const template = B.discoverTemplates().find((item) => item.id === draft.template_id);
  if (!template || template.disabled) throw new Error("The selected wedding template is no longer available.");

  if (template.engine !== "legacy-framer") {
    const html = B.buildPlaceholderPage(couple, require("fs").readFileSync(template.htmlPath, "utf8"), template, { demo: false }).html;
    return draft.status === "unpaid" ? addPreviewWatermark(html) : html;
  }

  const sources = RENDER.legacySources();
  const result = B.buildLegacyCouplePage(couple, sources.html, sources.pageBundle, sources.mainBundle, { rootOnly: false, noWrite: true });
  if (!result.bundles) throw new Error("Could not render the wedding preview.");

  const origin = originFor(req);
  const dirUrl = origin + SITE_SUBDIR;
  const page = absolutize(result.bundles.page, dirUrl);
  const main = absolutize(result.bundles.main.split("./" + result.bundles.pageName).join(PAGE_SPEC), dirUrl);
  let html = result.html;
  const mainRe = new RegExp(`(["'])[^"']*${String(result.bundles.mainName).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\1`, "g");
  html = html.replace(mainRe, (match, quote) => quote + jsDataUrl(main) + quote);

  const importMap = `<script type="importmap">${JSON.stringify({ imports: { [PAGE_SPEC]: jsDataUrl(page) } })}</script>`;
  const headExtra = `<base href="${origin}/">${importMap}`;
  const renderedHtml = /<head[^>]*>/i.test(html) ? html.replace(/<head[^>]*>/i, (head) => head + headExtra) : headExtra + html;
  return draft.status === "unpaid" ? addPreviewWatermark(renderedHtml) : renderedHtml;
}

module.exports = { originFor, renderDraftPage };
