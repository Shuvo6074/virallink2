import { getCloudflareContext } from "@opennextjs/cloudflare";

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { slug } = req.body || {};
  if (!slug || typeof slug !== 'string') {
    return res.status(400).json({ error: 'slug required' });
  }

  try {
    const { env } = getCloudflareContext();
    await env.DB.prepare(
      `INSERT INTO views (slug, count) VALUES (?, 1)
       ON CONFLICT(slug) DO UPDATE SET count = count + 1`
    ).bind(slug).run();

    return res.status(200).json({ success: true });
  } catch (e) {
    return res.status(500).json({ error: 'failed', detail: String(e) });
  }
}
