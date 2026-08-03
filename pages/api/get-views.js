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
    res.setHeader('Cache-Control', 'public, s-maxage=10, stale-while-revalidate=30');
    return res.status(200).json(counts);
  } catch (e) {
    return res.status(500).json({ error: 'failed', detail: String(e), stack: e?.stack || null });
  }
}
