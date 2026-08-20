import React from "react";
import Head from "next/head";

// ── SEO ট্যাগ আর্কাইভ পেজ (নতুন ফাইল, সম্পূর্ণ স্বাধীন)। এটা video slug
// system-এর কোনো কিছু স্পর্শ করে না — শুধু Sheet-এর কলাম J (Tags) পড়ে
// সেই ট্যাগ-যুক্ত ভিডিওগুলোর একটা তালিকা দেখায়। প্রতিযোগী সাইট
// (banglachotikahinii.com)-এর মতোই "Videos Tagged with {tag}" স্টাইলে
// পেজ টাইটেল বসানো হয়েছে, যাতে মানুষ ঠিক যা লিখে সার্চ করে সেই phrase-এর
// সাথে match হয়। ──

const SHEET_ID = '1CJU7TtQAvLGwVIrFB4G6uIyDy0m0Uz54kB6ZBpar4zE';

function slugify(text) {
  return text.toString().toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^\w\u0980-\u09FF-]/g, '')
    .replace(/--+/g, '-')
    .replace(/^-+|-+$/g, '')
    .substring(0, 80);
}

function parseTags(str) {
  return (str || '').split(',').map(s => s.trim()).filter(Boolean);
}

function formatNum(n) {
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
  if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
  return n.toString();
}

// ── একই থাম্বনেইল কমপ্রেশন লজিক index.js/[slug].js-এর সাথে consistent ──
function thumbUrl(url, width) {
  if (!url) return url;
  const clean = url.replace(/^https?:\/\//, '');
  return `https://wsrv.nl/?url=${encodeURIComponent(clean)}&w=${width}&q=85&output=webp&n=-1`;
}

// ── SLUG ফ্রিজ ফিক্স: index.js/[slug].js-এর সাথে consistent — কলাম I
// (index 8)-তে slug থাকলে সেটাই ব্যবহার হবে, নাহলে Title থেকে generate ──
function getUniqueSlugs(rows) {
  const counts = {};
  return rows.map(row => {
    const frozen = (row.c[8]?.v || '').toString().trim();
    if (frozen) return frozen;
    const base = slugify(row.c[0]?.v || 'video');
    counts[base] = (counts[base] || 0) + 1;
    return counts[base] > 1 ? `${base}-${counts[base]}` : base;
  });
}

export async function getServerSideProps({ params, res: httpRes }) {
  httpRes.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=600');

  try {
    const res = await fetch(`https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:json`);
    const text = await res.text();
    const json = JSON.parse(text.substring(47, text.length - 2));
    const rows = json.table.rows;
    const uniqueSlugs = getUniqueSlugs(rows);

    const allVideos = rows.map((row, i) => ({
      id: i,
      title:     row.c[0]?.v || 'Untitled',
      thumbnail: row.c[2]?.v || `https://picsum.photos/seed/${i}/640/360`,
      tags:      parseTags(row.c[9]?.v || ''),
      slug:      uniqueSlugs[i]
    })).filter(v => v.title !== 'Title').reverse();

    // ── URL-এর tag slug-এর সাথে ভিডিওর tags মিলিয়ে দেখা হচ্ছে (case/slug-insensitive) ──
    const matched = allVideos.filter(v => v.tags.some(t => slugify(t) === params.tag));

    if (matched.length === 0) return { notFound: true };

    // ── আসল (readable) ট্যাগ নামটা প্রথম matched ভিডিও থেকে নেওয়া হচ্ছে,
    // যাতে পেজের টাইটেলে সুন্দর করে দেখানো যায় (স্ল্যাগ না, আসল টেক্সট) ──
    const tagLabel = matched[0].tags.find(t => slugify(t) === params.tag) || params.tag;

    return { props: { videos: matched, tagLabel, tagSlug: params.tag } };
  } catch (e) {
    return { notFound: true };
  }
}

export default function TagPage({ videos, tagLabel, tagSlug }) {
  return (
    <>
      <Head>
        <title>Videos Tagged with {tagLabel} | ViralLink BD</title>
        <meta name="description" content={`Browse all videos tagged with ${tagLabel} on ViralLink BD.`} />
        <link rel="canonical" href={`https://virallink2.site/tag/${tagSlug}`} />
      </Head>

      <style jsx>{`
        .wrap{max-width:1200px;margin:0 auto;padding:1rem;}
        .heading{font-size:1.4rem;color:#fff;margin-bottom:0.25rem;}
        .sub{color:#999;font-size:0.85rem;margin-bottom:1.25rem;}
        .breadcrumb{font-size:0.8rem;color:#999;margin-bottom:1rem;}
        .breadcrumb a{color:#999;text-decoration:none;}
        .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:0.75rem;}
        .card{display:block;text-decoration:none;color:#eee;background:#181818;border-radius:8px;overflow:hidden;}
        .card img{width:100%;aspect-ratio:16/9;object-fit:cover;display:block;}
        .card-title{font-size:0.8rem;padding:0.5rem;line-height:1.3;
          display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;}
      `}</style>

      <div className="wrap">
        <div className="breadcrumb"><a href="/">Home</a> › Tags › {tagLabel}</div>
        <h1 className="heading">Videos Tagged with {tagLabel}</h1>
        <p className="sub">{videos.length} video{videos.length === 1 ? '' : 's'} found</p>

        <div className="grid">
          {videos.map(v => (
            <a key={v.id} href={`/video/${v.slug}`} className="card">
              <img src={thumbUrl(v.thumbnail, 300)} alt={v.title} loading="lazy" decoding="async" />
              <div className="card-title">{v.title}</div>
            </a>
          ))}
        </div>
      </div>
    </>
  );
        }
