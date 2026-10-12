// ── CPU কমানোর বড় ফিক্স: OpenNext Worker-এর সামনে এজ-ক্যাশ লেয়ার ──
// রোলব্যাক: wrangler.toml-এ main আবার ".open-next/worker.js" করে দিলেই
// আগের অবস্থা ফিরে আসবে।
import openNext from "./.open-next/worker.js";
export * from "./.open-next/worker.js";

const EDGE_TTL_SECONDS = 300; // ৫ মিনিট

function isCacheable(request, url) {
  if (request.method !== "GET") return false;
  if (request.headers.get("range")) return false;
  const p = url.pathname;
  if (p.startsWith("/api/") || p.startsWith("/_next/")) return false;
  return p === "/" || p === "/sitemap.xml" || p.startsWith("/video/") || p.startsWith("/tag/");
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (!isCacheable(request, url)) {
      return openNext.fetch(request, env, ctx);
    }

    const cache = caches.default;
    const cacheKey = new Request(url.toString(), { method: "GET" });

    try {
      const hit = await cache.match(cacheKey);
      if (hit) {
        const res = new Response(hit.body, hit);
        res.headers.set("Cache-Control", "public, max-age=0, must-revalidate");
        res.headers.set("x-edge-cache", "HIT");
        return res;
      }
    } catch (e) {
      // ক্যাশ ফেইল করলে সরাসরি নিচে রেন্ডার হবে
    }

    const response = await openNext.fetch(request, env, ctx);

    if (response.status === 200 && !response.headers.has("set-cookie")) {
      try {
        const toStore = new Response(response.clone().body, response);
        toStore.headers.set("Cache-Control", `public, max-age=${EDGE_TTL_SECONDS}`);
        ctx.waitUntil(cache.put(cacheKey, toStore));
      } catch (e) {}
    }

    const out = new Response(response.body, response);
    out.headers.set("Cache-Control", "public, max-age=0, must-revalidate");
    out.headers.set("x-edge-cache", "MISS");
    return out;
  },
};
