#!/usr/bin/env node
/**
 * Local server for the cloned Framer site.
 *
 * - Serves index.html at /
 * - Serves mirrored assets under /mirror/<host>/<path>?<query>
 * - If a mirrored file is missing, fetches it from the origin CDN,
 *   caches it into the mirror, and serves it. Assets are immutable, so
 *   the cache is kept forever.
 *
 * Run: node _tools/server.js [port]   (default 8080)
 */
const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const ROOT = path.join(__dirname, "..");
const SITE_ROOT = path.join(ROOT, "public"); // deployable site root
const MIRROR = path.join(SITE_ROOT, "mirror");

const PORT = parseInt(process.argv[2], 10) || 8080;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".png": "image/png",
  ".webp": "image/webp",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".avif": "image/avif",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
  ".map": "application/json",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".pdf": "application/pdf",
};

function mimeFor(p) {
  return MIME[path.extname(p).toLowerCase()] || "application/octet-stream";
}

/**
 * Map an incoming /mirror/ request to (localFile, originUrl).
 * The URL the browser asks for (path + query) is translated 1:1 back to
 * the origin. The local file name appends a hash of the query string so
 * different resize/crop variants of the same base file stay distinct.
 */
function mirrorTarget(urlPath, query) {
  if (!urlPath.startsWith("/mirror/")) return null;
  const rest = urlPath.slice("/mirror/".length); // host/path/...
  const slash = rest.indexOf("/");
  if (slash < 0) return null;
  const host = rest.slice(0, slash);
  const sub = rest.slice(slash + 1);
  const local = path.join(MIRROR, host, sub);
  const origin = `https://${host}/${sub}` + (query ? `?${query}` : "");
  let disk = local;
  if (query) {
    const h = crypto.createHash("sha1").update(query).digest("hex").slice(0, 8);
    disk = local + "__" + h;
  }
  return { disk, origin };
}

function sendStatus(res, code, text) {
  res.writeHead(code, { "Content-Type": "text/plain; charset=utf-8" });
  res.end(text);
}

async function proxyAndCache(res, target) {
  const { disk, origin } = target;
  if (process.env.NO_FALLBACK) {
    sendStatus(res, 404, "not mirrored: " + origin);
    return;
  }
  try {
    const up = await fetch(origin, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; framer-clone)" },
      redirect: "follow",
    });
    if (!up.ok) {
      sendStatus(res, up.status, `origin ${up.status}: ${origin}`);
      return;
    }
    const buf = Buffer.from(await up.arrayBuffer());
    fs.mkdirSync(path.dirname(disk), { recursive: true });
    fs.writeFileSync(disk, buf);
    // Remember the exact origin Content-Type for extension-less files
    const ct = (up.headers.get("content-type") || "").split(";")[0].trim();
    if (ct) fs.writeFileSync(disk + ".mime", ct);
    const basePath = disk.replace(/__[0-9a-f]{8}$/, "");
    const isCode = /\.(mjs|js|json)$/.test(basePath);
    res.writeHead(200, {
      "Content-Type": ct || mimeFor(basePath),
      "Content-Length": buf.length,
      "Cache-Control": isCode ? "no-cache" : "public, max-age=31536000, immutable",
    });
    res.end(buf);
    console.log(`cached ${origin} (${buf.length} bytes)`);
  } catch (e) {
    sendStatus(res, 502, `proxy failed for ${origin}: ${e.message}`);
  }
}

function serveFile(res, file, allowRange) {
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) {
      sendStatus(res, 404, "not found");
      return;
    }
    const basePath = file.replace(/__[0-9a-f]{8}$/, ""); // strip query-hash suffix
    let ct = mimeFor(basePath);
    if (ct === "application/octet-stream") {
      try {
        ct = fs.readFileSync(file + ".mime", "utf8").trim() || ct;
      } catch (e) { /* no sidecar */ }
    }
    // code/data files must not be immutable, so future edits propagate
    const isCode = /\.(mjs|js|json)$/.test(basePath);
    const cc = isCode ? "no-cache" : "public, max-age=31536000, immutable";
    const headers = {
      "Content-Type": ct,
      "Content-Length": st.size,
      "Cache-Control": cc,
    };
    if (allowRange) headers["Accept-Ranges"] = "bytes";
    const range = allowRange ? /bytes=(\d*)-(\d*)/.exec(req.headers.range || "") : null;
    if (range && (range[1] || range[2])) {
      const start = range[1] ? parseInt(range[1], 10) : 0;
      const end = range[2] ? Math.min(parseInt(range[2], 10), st.size - 1) : st.size - 1;
      if (start >= st.size || start > end) {
        res.writeHead(416, { "Content-Range": `bytes */${st.size}` });
        return res.end();
      }
      res.writeHead(206, Object.assign(headers, {
        "Content-Range": `bytes ${start}-${end}/${st.size}`,
        "Content-Length": end - start + 1,
      }));
      fs.createReadStream(file, { start, end }).pipe(res);
    } else {
      res.writeHead(200, headers);
      fs.createReadStream(file).pipe(res);
    }
  });
}

let req = null; // used by serveFile's range parsing (kept simple)
const server = http.createServer((req_, res) => {
  req = req_;
  const u = new URL(req.url, `http://127.0.0.1:${PORT}`);
  const p = decodeURIComponent(u.pathname);

  if (p === "/" || p === "/index.html") {
    const f = path.join(SITE_ROOT, "index.html");
    res.writeHead(200, {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-cache",
    });
    fs.createReadStream(f).pipe(res);
    return;
  }

  const target = mirrorTarget(p, u.search.slice(1));
  if (!target) {
    sendStatus(res, 404, "not found");
    return;
  }
  fs.stat(target.disk, (err) => {
    if (!err) serveFile(res, target.disk, true);
    else proxyAndCache(res, target);
  });
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`Clone site server running at http://127.0.0.1:${PORT}`);
});
