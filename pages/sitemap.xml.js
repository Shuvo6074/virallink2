const SHEET_ID = '1CJU7TtQAvLGwVIrFB4G6uIyDy0m0Uz54kB6ZBpar4zE';

function slugify(text) {
  return text.toString().toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^\w-]/g, '')   // বাংলা সহ সব non-ASCII বাদ দেবে
    .replace(/--+/g, '-')
    .replace(/^-+|-+$/g, '')
    .substring(0, 80);
}

export async function getServerSideProps({ res }) {
  const siteUrl = 'https://virallink2.site';

  const fallbackSitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
    <url>
      <loc>${siteUrl}</loc>
      <changefreq>daily</changefreq>
      <priority>1.0</priority>
    </url>
</urlset>`;

  let sitemap = fallbackSitemap;

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000);

    const response = await fetch(
      `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:json`,
      { signal: controller.signal }
    );
    clearTimeout(timeoutId);

    const text = await response.text();
    const json = JSON.parse(text.substring(47, text.length - 2));
    const rows = json.table.rows;
    const today = new Date().toISOString().split('T')[0];

    const slugCounts = {};
    const videos = rows.map(row => {
      const title = row.c[0]?.v || 'video';
      const baseSlug = slugify(title);
      slugCounts[baseSlug] = (slugCounts[baseSlug] || 0) + 1;
      const slug = slugCounts[baseSlug] > 1 ? `${baseSlug}-${slugCounts[baseSlug]}` : baseSlug;
      return { title, slug };
    }).filter(v => v.title !== 'Title' && v.slug.length > 2);

    const urls = videos.map(v => `
    <url>
      <loc>${siteUrl}/video/${v.slug}</loc>
      <lastmod>${today}</lastmod>
      <changefreq>weekly</changefreq>
      <priority>0.8</priority>
    </url>`).join('');

    sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
    <url>
      <loc>${siteUrl}</loc>
      <changefreq>daily</changefreq>
      <priority>1.0</priority>
    </url>${urls}
</urlset>`;

    res.setHeader('Content-Type', 'application/xml');
    res.setHeader('Cache-Control', 'public, s-maxage=600, stale-while-revalidate=3600');
  } catch (e) {
    sitemap = fallbackSitemap;
    res.setHeader('Content-Type', 'application/xml');
    res.setHeader('Cache-Control', 'public, s-maxage=60');
  }

  res.write(sitemap);
  res.end();

  return { props: {} };
}

export default function Sitemap() {
  return null;
      }
