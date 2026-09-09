import { getCloudflareContext } from "@opennextjs/cloudflare";

// ── আগে শুধু Cache-Control header বসানো ছিল, যেটা Cloudflare-এ Cache Rule
// ছাড়া আসলে কাজ করে না (dynamic API response এমনিতে edge-এ cache হয় না)।
// এখন সরাসরি Cloudflare-এর Cache API (caches.default) ব্যবহার করে ৬০
// সেকেন্ডের জন্য রেজাল্ট cache করা হচ্ছে — Cache Rule সেট করা থাক বা না
// থাক, D1 database-এ বারবার query যাবে না। ──
const CACHE_KEY_URL = 'https://internal-cache.virallink2.site/get-views-v1';
const CACHE_TTL_SECONDS = 60;

export default async function handler(req, res) {
  try {
    let cache = null;
    let cacheKeyReq = null;

    try {
      cache = caches.default;
      cacheKeyReq = new Request(CACHE_KEY_URL);
      const cached = await cache.match(cacheKeyReq);
      if (cached) {
        const counts = await cached.json();
        res.setHeader('Cache-Control', `public, s-maxage=${CACHE_TTL_SECONDS}, stale-while-revalidate=120`);
        return res.status(200).json(counts);
      }
    } catch (e) {
      // cache না পাওয়া গেলেও নিচে সরাসরি DB থেকে ফ্রেশ ডেটা যাবে
    }

    const { env } = getCloudflareContext();

    if (!env || !env.DB) {
      return res.status(500).json({ error: 'DB binding not found', envKeys: env ? Object.keys(env) : null });
    }

    const { results } = await env.DB.prepare('SELECT slug, count FROM views').all();
    const counts = {};
    results.forEach(r => { counts[r.slug] = r.count; });

    if (cache && cacheKeyReq) {
      try {
        const cacheResponse = new Response(JSON.stringify(counts), {
          headers: {
            'Content-Type': 'application/json',
            'Cache-Control': `public, max-age=${CACHE_TTL_SECONDS}`
          }
        });
        let waited = false;
        try {
          const cfContext = await getCloudflareContext({ async: true });
          if (cfContext?.ctx?.waitUntil) {
            cfContext.ctx.waitUntil(cache.put(cacheKeyReq, cacheResponse));
            waited = true;
          }
        } catch (e) {}
        if (!waited) {
          await cache.put(cacheKeyReq, cacheResponse);
        }
      } catch (e) {}
    }

    res.setHeader('Cache-Control', `public, s-maxage=${CACHE_TTL_SECONDS}, stale-while-revalidate=120`);
    return res.status(200).json(counts);
  } catch (e) {
    return res.status(500).json({ error: 'failed', detail: String(e), stack: e?.stack || null });
  }
}
