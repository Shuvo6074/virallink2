// ── রিকোয়েস্ট/CPU কমানোর কেন্দ্রীয় ফিক্স ──
// আগে index.js, video/[slug].js, tag/[tag].js, sitemap.xml.js — প্রতিটা
// ফাইল আলাদাভাবে প্রতিটা রিকোয়েস্টে সরাসরি Google Sheets fetch করত।
// Cache-Control header বসানো থাকলেও সেটা মূলত Vercel-এর edge cache ধরে
// লেখা হয়েছিল — Cloudflare Workers-এ dynamic response এমনিতে cache হয় না
// (আলাদা Cache Rule ছাড়া), তাই প্রতিটা visitor/bot হিট-এই পুরো Sheet
// আবার fetch+parse হচ্ছিল। এখন Cloudflare-এর নিজস্ব Cache API (caches.default)
// ব্যবহার করে Sheet-এর raw rows ৫ মিনিটের জন্য cache করে রাখা হচ্ছে —
// এই সময়ের মধ্যে যত visitor/bot আসুক, Google Sheets-এ নতুন fetch যাবে না,
// আর CPU time-ও অনেক কমবে (JSON parse বারবার হবে না)।
const SHEET_ID = '1CJU7TtQAvLGwVIrFB4G6uIyDy0m0Uz54kB6ZBpar4zE';

// এই cache key-টা কোনো real URL না, শুধু cache entry-কে identify করার জন্য
// একটা fixed string — সব পেজ একই key ব্যবহার করবে, তাই একবার cache হলে
// homepage/video/tag/sitemap সবাই একই cached ডেটা শেয়ার করবে।
const CACHE_KEY_URL = 'https://internal-cache.virallink2.site/sheet-rows-v1';
const CACHE_TTL_SECONDS = 300; // ৫ মিনিট

export async function getSheetRows() {
  let cache = null;
  let cacheKeyReq = null;

  try {
    // caches.default সব Cloudflare Workers রানটাইমে globally available।
    // কোনো কারণে না থাকলে (যেমন local dev), try/catch দিয়ে চুপচাপ স্কিপ।
    cache = caches.default;
    cacheKeyReq = new Request(CACHE_KEY_URL);
    const cached = await cache.match(cacheKeyReq);
    if (cached) {
      const data = await cached.json();
      return data.rows;
    }
  } catch (e) {
    // cache পাওয়া না গেলেও নিচে সরাসরি fetch করে কাজ চলবে
  }

  // ৮ সেকেন্ড টাইমআউট — Google Sheets কখনো ধীর/আটকে গেলে Worker যেন
  // অনির্দিষ্টকাল অপেক্ষা না করে (আগে sitemap.xml.js-এ এই সেফটি ছিল,
  // এখন সব পেজের জন্য এখানেই কেন্দ্রীভূত করা হলো)।
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 8000);
  const res = await fetch(
    `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:json`,
    { signal: controller.signal }
  );
  clearTimeout(timeoutId);
  const text = await res.text();
  const json = JSON.parse(text.substring(47, text.length - 2));
  const rows = json.table.rows;

  if (cache && cacheKeyReq) {
    try {
      const cacheResponse = new Response(JSON.stringify({ rows }), {
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': `public, max-age=${CACHE_TTL_SECONDS}`
        }
      });
      // ctx.waitUntil পাওয়া গেলে background-এ cache.put চলবে (রেসপন্স
      // পাঠাতে দেরি হবে না); না পেলেও সরাসরি await করলে সমস্যা নেই।
      let waited = false;
      try {
        const { getCloudflareContext } = await import("@opennextjs/cloudflare");
        const cfContext = await getCloudflareContext({ async: true });
        if (cfContext?.ctx?.waitUntil) {
          cfContext.ctx.waitUntil(cache.put(cacheKeyReq, cacheResponse));
          waited = true;
        }
      } catch (e) {
        // ignore — নিচে fallback await দিয়ে cache হবে
      }
      if (!waited) {
        await cache.put(cacheKeyReq, cacheResponse);
      }
    } catch (e) {
      // cache.put ব্যর্থ হলেও কোনো সমস্যা নেই, পরের রিকোয়েস্টে আবার fetch হবে
    }
  }

  return rows;
          }
