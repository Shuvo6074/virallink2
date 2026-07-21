const SHEET_ID = '1nHoGwVeoKe7p64ko6nkwWVY-svuonzBH936pbdv1t5A';

function slugify(text) {
  return text.toString().toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^\w-]/g, '')   // বাংলা সহ সব non-ASCII বাদ দেবে
    .replace(/--+/g, '-')
    .replace(/^-+|-+$/g, '')
    .substring(0, 80);
}

export default function Sitemap() { return null; }

export async function getServerSideProps({ res }) {
  const siteUrl = 'https://virallink2.site';

  // fallback sitemap — শুধু হোমপেজ থাকবে, কিন্তু সবসময় valid XML
  const fallbackSitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
    <url>
      <loc>${siteUrl}</loc>
      <changefreq>daily</changefreq>
      <priority>1.0</priority>
    </url>
</urlset>`;

  try {
    // ৮ সেকেন্ডের বেশি সময় নিলে Google Sheets fetch বাতিল করে দাও,
    // যাতে Googlebot-এর টাইমআউটের আগেই একটা রেসপন্স পাঠানো যায়
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

    // একই টাইটেল বারবার এলে slug-এর শেষে -2, -3 ... যোগ হবে,
    // যাতে প্রতিটা ভিডিওর নিজস্ব আলাদা URL থাকে (কোনোটাই বাদ পড়বে না)
    const slugCounts = {};
    const videos = rows.map(row => {
      const title = row.c[0]?.v || 'video';
      const baseSlug = slugify(title);
      slugCounts[baseSlug] = (slugCounts[baseSlug] || 0) + 1;
      const slug = slugCounts[baseSlug] > 1 ? `${baseSlug}-${slugCounts[baseSlug]}` : baseSlug;
      return { title, slug };
    }).filter(v => v.title !== 'Title' && v.slug.length > 2);

    const uniqueVideos = videos;

    const urls = uniqueVideos.map(v => `
    <url>
      <loc>${siteUrl}/video/${v.slug}</loc>
      <lastmod>${today}</lastmod>
      <changefreq>weekly</changefreq>
      <priority>0.8</priority>
    </url>`).join('');

    const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
    <url>
      <loc>${siteUrl}</loc>
      <changefreq>daily</changefreq>
      <priority>1.0</priority>
    </url>${urls}
</urlset>`;

    res.setHeader('Content-Type', 'application/xml');
    res.setHeader('Cache-Control', 'public, s-maxage=600, stale-while-revalidate=3600');
    res.write(sitemap);
    res.end();
  } catch(e) {
    // Google Sheets fetch fail করলেও Googlebot যেন সবসময় VALID XML পায় —
    // "Error" টেক্সট পাঠানো বন্ধ, কারণ সেটাই "Couldn't fetch" এর আসল কারণ ছিল
    res.setHeader('Content-Type', 'application/xml');
    res.setHeader('Cache-Control', 'public, s-maxage=60');  // দ্রুত retry হোক
    res.write(fallbackSitemap);
    res.end();
  }
  return { props: {} };
}
