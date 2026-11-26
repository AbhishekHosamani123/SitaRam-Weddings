const assert = require("node:assert/strict");
const { test } = require("node:test");

const API_ORIGIN = "https://api.example.test";
let workerPromise;
function getWorker() {
  if (!workerPromise) workerPromise = import("../worker.mjs").then((module) => module.default);
  return workerPromise;
}

test("serves static assets without sending them to the API host", async () => {
  const worker = await getWorker();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error("Static routes should not be proxied.");
  };
  try {
    const response = await worker.fetch(new Request("https://sita.example/"), {
      API_ORIGIN,
      ASSETS: { fetch: async () => new Response("landing page", { status: 200 }) },
    });
    assert.equal(response.status, 200);
    assert.equal(await response.text(), "landing page");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("proxies preview APIs with the public host and rewrites preview links", async () => {
  const worker = await getWorker();
  const originalFetch = globalThis.fetch;
  let upstreamRequest;
  globalThis.fetch = async (url, init) => {
    upstreamRequest = { url: String(url), init };
    return Response.json({ preview_url: `${API_ORIGIN}/preview/${"a".repeat(64)}` }, { status: 201 });
  };
  try {
    const response = await worker.fetch(new Request("https://sita.example/api/create-preview", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ template: "ram-mandir" }),
    }), {
      API_ORIGIN,
      ASSETS: { fetch: async () => new Response("not found", { status: 404 }) },
    });
    assert.equal(upstreamRequest.url, `${API_ORIGIN}/api/create-preview`);
    assert.equal(upstreamRequest.init.headers.get("x-forwarded-host"), "sita.example");
    assert.equal(upstreamRequest.init.headers.get("x-forwarded-proto"), "https");
    assert.deepEqual(JSON.parse(new TextDecoder().decode(upstreamRequest.init.body)), { template: "ram-mandir" });
    assert.equal(response.status, 201);
    assert.equal((await response.json()).preview_url, `https://sita.example/preview/${"a".repeat(64)}`);
    assert.equal(response.headers.get("cache-control"), "no-store");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("proxies missing dynamic wedding pages to the backend", async () => {
  const worker = await getWorker();
  const originalFetch = globalThis.fetch;
  let upstreamUrl;
  globalThis.fetch = async (url) => {
    upstreamUrl = String(url);
    return new Response("<h1>Wedding page</h1>", { status: 200, headers: { "content-type": "text/html" } });
  };
  try {
    const response = await worker.fetch(new Request("https://sita.example/aarohi-vihaan/"), {
      API_ORIGIN,
      ASSETS: { fetch: async () => new Response("not found", { status: 404 }) },
    });
    assert.equal(upstreamUrl, `${API_ORIGIN}/aarohi-vihaan/`);
    assert.equal(await response.text(), "<h1>Wedding page</h1>");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("returns a clear gateway error when the backend cannot be reached", async () => {
  const worker = await getWorker();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error("upstream unavailable");
  };
  try {
    const response = await worker.fetch(new Request("https://sita.example/api/create-preview", { method: "POST" }), {
      API_ORIGIN,
      ASSETS: { fetch: async () => new Response("not found", { status: 404 }) },
    });
    assert.equal(response.status, 502);
    assert.match((await response.json()).error, /temporarily unavailable/i);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
