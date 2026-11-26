const DEFAULT_API_ORIGIN = "https://sitaram-weddings.vercel.app";
const PREVIEW_PATH = /^\/preview\/[a-f0-9]{64}\/?$/i;

function isApiRequest(pathname) {
  return pathname === "/api" || pathname.startsWith("/api/");
}

function apiOrigin(env) {
  const upstream = new URL(env.API_ORIGIN || DEFAULT_API_ORIGIN);
  if (upstream.protocol !== "https:" || upstream.username || upstream.password) {
    throw new Error("API_ORIGIN must be an HTTPS origin.");
  }
  return upstream.origin;
}

async function proxyToApi(request, env, origin) {
  try {
    const upstreamOrigin = apiOrigin(env);
    const incoming = new URL(request.url);
    const target = new URL(incoming.pathname + incoming.search, upstreamOrigin);
    const headers = new Headers(request.headers);
    headers.delete("host");
    headers.delete("content-length");
    headers.set("x-forwarded-host", incoming.host);
    headers.set("x-forwarded-proto", incoming.protocol.slice(0, -1));

    const init = {
      method: request.method,
      headers,
      redirect: "manual",
    };
    if (request.method !== "GET" && request.method !== "HEAD") {
      init.body = await request.arrayBuffer();
    }

    const upstreamResponse = await fetch(target, init);
    const responseHeaders = new Headers(upstreamResponse.headers);
    const location = responseHeaders.get("location");
    if (location) responseHeaders.set("location", location.replace(upstreamOrigin, origin));

    const contentType = responseHeaders.get("content-type") || "";
    if (contentType.includes("text/html") || contentType.includes("application/json")) {
      const body = (await upstreamResponse.text()).replaceAll(upstreamOrigin, origin);
      responseHeaders.delete("content-length");
      responseHeaders.delete("content-encoding");
      if (isApiRequest(incoming.pathname) || PREVIEW_PATH.test(incoming.pathname)) {
        responseHeaders.set("cache-control", "no-store");
      }
      return new Response(body, {
        status: upstreamResponse.status,
        statusText: upstreamResponse.statusText,
        headers: responseHeaders,
      });
    }

    if (isApiRequest(incoming.pathname) || PREVIEW_PATH.test(incoming.pathname)) {
      responseHeaders.set("cache-control", "no-store");
    }
    return new Response(upstreamResponse.body, {
      status: upstreamResponse.status,
      statusText: upstreamResponse.statusText,
      headers: responseHeaders,
    });
  } catch {
    return Response.json(
      { error: "The wedding service is temporarily unavailable. Please try again shortly." },
      { status: 502, headers: { "cache-control": "no-store" } },
    );
  }
}

export default {
  async fetch(request, env) {
    const incoming = new URL(request.url);
    const origin = incoming.origin;
    if (isApiRequest(incoming.pathname) || PREVIEW_PATH.test(incoming.pathname)) {
      return proxyToApi(request, env, origin);
    }

    const asset = await env.ASSETS.fetch(request);
    if (asset.status !== 404) return asset;
    return proxyToApi(request, env, origin);
  },
};
