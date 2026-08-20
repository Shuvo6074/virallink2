import React, { useState, useEffect } from "react";
import Head from "next/head";

// ── SEO ট্যাগ আর্কাইভ পেজ। video slug system-এর কোনো কিছু স্পর্শ করে না —
// শুধু Sheet-এর কলাম J (Tags) পড়ে সেই ট্যাগ-যুক্ত ভিডিওগুলোর একটা তালিকা
// দেখায়, ঠিক homepage-এর card design অনুসরণ করে (একই CSS class name
// ব্যবহার করা হয়েছে যাতে _app.js-এর global stylesheet থেকে একই স্টাইল
// স্বয়ংক্রিয়ভাবে প্রয়োগ হয়, আলাদা CSS লিখতে হয় না)। ──

const SHEET_ID = '1CJU7TtQAvLGwVIrFB4G6uIyDy0m0Uz54kB6ZBpar4zE';

function slugify(text) {
  return text.toString().toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^\w\u0980-\u09FF-]/g, '')
    .replace(/--+/g, '-')
    .replace(/^-+|-+$/g, '')
    .substring(0, 80);
}

function parseCategories(str) {
  const arr = (str || '').split(',').map(s => s.trim()).filter(Boolean);
  return arr.length ? arr : ['General'];
}

function parseTags(str) {
  return (str || '').split(',').map(s => s.trim()).filter(Boolean);
}

function formatNum(n) {
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
  if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
  return n.toString();
}

function timeAgo(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  if (isNaN(d)) return '';
  const diff = Math.floor((Date.now() - d.getTime()) / 1000);
  if (diff < 60) return 'just now';
  if (diff < 3600) return Math.floor(diff / 60) + 'm ago';
  if (diff < 86400) return Math.floor(diff / 3600) + 'h ago';
  if (diff < 2592000) return Math.floor(diff / 86400) + 'd ago';
  return Math.floor(diff / 2592000) + 'mo ago';
}

// ── homepage/video page-এর সাথে consistent থাম্বনেইল কমপ্রেশন ──
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
      title:       row.c[0]?.v || 'Untitled',
      thumbnail:   row.c[2]?.v || `https://picsum.photos/seed/${i}/640/360`,
      categories:  parseCategories(row.c[3]?.v),
      date:        row.c[4]?.v || '',
      duration:    row.c[5]?.v || '',
      tags:        parseTags(row.c[9]?.v || ''),
      slug:        uniqueSlugs[i]
    })).filter(v => v.title !== 'Title').reverse();

    const matched = allVideos.filter(v => v.tags.some(t => slugify(t) === params.tag));
    if (matched.length === 0) return { notFound: true };

    const tagLabel = matched[0].tags.find(t => slugify(t) === params.tag) || params.tag;

    return { props: { videos: matched, tagLabel, tagSlug: params.tag } };
  } catch (e) {
    return { notFound: true };
  }
}

export default function TagPage({ videos, tagLabel, tagSlug }) {
  const [views, setViews] = useState({});

  // ── homepage-এর মতোই view count fetch করা হচ্ছে, যাতে card-এ views সংখ্যা দেখা যায় ──
  useEffect(() => {
    fetch('/api/get-views')
      .then(r => r.json())
      .then(counts => setViews(counts))
      .catch(() => {});
  }, []);

  const SMARTLINK_URL = 'https://www.effectivecpmnetwork.com/hzn588p39q?key=c22e2da4de74dbe9769bd7bcc477bb63';

  return (
    <>
      <Head>
        <title>Videos Tagged with {tagLabel} | ViralLink BD</title>
        <meta name="description" content={`Browse all videos tagged with ${tagLabel} on ViralLink BD.`} />
        <link rel="canonical" href={`https://virallink2.site/tag/${tagSlug}`} />
      </Head>

      <div className="main">
        <div className="breadcrumb" style={{padding:'1rem 1rem 0'}}>
          <a href="/">Home</a> &rsaquo; Tags &rsaquo; {tagLabel}
        </div>
        <div className="section-title">Videos Tagged with {tagLabel}</div>

        <div className="video-grid">
          {videos.map((v, i) => (
            <a
              key={v.id}
              className="video-card"
              href={`/video/${v.slug}`}
              onClick={(e) => {
                e.preventDefault();
                const win = window.open('', '_blank');
                if (win) {
                  win.location.href = `/video/${v.slug}`;
                  window.location.href = SMARTLINK_URL;
                } else {
                  window.location.href = `/video/${v.slug}`;
                }
              }}
            >
              <div className="thumb-wrap">
                <img
                  src={thumbUrl(v.thumbnail, 480)}
                  alt={`${v.title} - ভাইরাল ভিডিও বাংলাদেশ`}
                  loading={i < 4 ? 'eager' : 'lazy'}
                  decoding="async"
                  fetchpriority={i === 0 ? 'high' : 'auto'}
                  onError={e => {
                    if (e.target.dataset.fallback !== 'original' && v.thumbnail) {
                      e.target.dataset.fallback = 'original';
                      e.target.src = v.thumbnail;
                    } else {
                      e.target.src = `https://picsum.photos/seed/${v.id}/640/360`;
                    }
                  }}
                />
                <div className="play-btn">
                  <svg viewBox="0 0 80 80" fill="none">
                    <circle cx="40" cy="40" r="38" fill="rgba(255,61,61,0.9)" />
                    <polygon points="32,24 60,40 32,56" fill="white" />
                  </svg>
                </div>
                {v.duration && <span className="duration-badge">{v.duration}</span>}
              </div>
              <div className="card-info">
                <div className="card-title">{v.title}</div>
                <div className="card-meta">
                  <span className="cat-badge">{v.categories.join(', ')}</span>
                  <span>{formatNum(views[v.slug] || 0)} views</span>
                  {v.date && <span> &middot; {timeAgo(v.date) || v.date}</span>}
                </div>
              </div>
            </a>
          ))}
        </div>
      </div>
    </>
  );
}
