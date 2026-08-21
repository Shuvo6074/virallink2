import { getCloudflareContext } from "@opennextjs/cloudflare";

export default async function handler(req, res) {
  try {
    const { env } = getCloudflareContext();

    if (!env || !env.DB) {
      return res.status(500).json({ error: 'DB binding not found', envKeys: env ? Object.keys(env) : null });
    }

    const { results } = await env.DB.prepare('SELECT slug, count FROM views').all();
    const counts = {};
    results.forEach(r => { counts[r.slug] = r.count; });
    // ── রিকোয়েস্ট কমানোর সবচেয়ে বড় ফিক্স: এই endpoint homepage, video
    // page, tag page — সব জায়গা থেকে প্রতিটা পেজ-লোডে কল হয়। আগে মাত্র
    // 10 সেকেন্ড cache ছিল, তাই ৩০০+ visitor থাকলে সেকেন্ডে বহুবার D1
    // database হিট হচ্ছিল। View count প্রতি মুহূর্তে নিখুঁত হওয়ার দরকার
    // নেই — 60 সেকেন্ড cache করলেও visitor এর চোখে কোনো পার্থক্য পড়বে
    // না, কিন্তু database/Worker load অনেকাংশে কমে যাবে। ──
    res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=120');
    return res.status(200).json(counts);
  } catch (e) {
    return res.status(500).json({ error: 'failed', detail: String(e), stack: e?.stack || null });
  }
}
