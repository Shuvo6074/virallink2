import { useState, useEffect, useRef } from "react";
import Head from "next/head";
import { useRouter } from "next/router";
import { getSheetRows } from "../../lib/sheetData";

const SHEET_ID = '1CJU7TtQAvLGwVIrFB4G6uIyDy0m0Uz54kB6ZBpar4zE';
const SITE_URL = 'https://virallink2.site';

function slugify(text) {
  return text.toString().toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^\w\u0980-\u09FF-]/g, '')
    .replace(/--+/g, '-')
    .replace(/^-+|-+$/g, '')
    .substring(0, 80);
}

function formatNum(n) {
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
  if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
  return n.toString();
}

// ── থাম্বনেইল ফলব্যাক (external placeholder সাইটের বদলে সাইটের নিজের ভিডিও দিয়ে) ──
// প্রক্সি + original দুটোই ফেইল করলে, একই ক্যাটাগরির অন্য একটা ভিডিওর
// থাম্বনেইল বসিয়ে দেওয়া হয় — কোনো বাইরের placeholder সাইট ব্যবহার হয় না।
function getFallbackThumb(excludeId, categories, pool) {
  if (!pool || pool.length === 0) return null;
  const cats = categories || [];
  const sameCat = pool.find(x => x.id !== excludeId && x.thumbnail && x.categories?.some(c => cats.includes(c)));
  if (sameCat) return sameCat.thumbnail;
  const anyOther = pool.find(x => x.id !== excludeId && x.thumbnail);
  return anyOther ? anyOther.thumbnail : null;
}

// ── Google Sheet-এ সেল "Date" টাইপ হলে gviz API সেটা প্লেইন টেক্সট না দিয়ে
// "Date(2026,6,29)" এই অদ্ভুত ফরম্যাটে পাঠায় (মাস 0-based, তাই 6 = জুলাই)।
// আবার তুমি যদি হাতে "29/07/2026" (DD/MM/YYYY) লেখো, সেটা প্লেইন টেক্সট
// থাকলে সাধারণ new Date() দিয়ে ভুল পড়ে (মাস ভেবে মাস>12 হওয়ায় Invalid
// Date হয়ে যায়) — এই ফাংশন তিন ধরনের ফরম্যাটই ঠিকভাবে পার্স করে। ──
function parseSheetDate(raw) {
  if (!raw) return null;
  if (typeof raw !== 'string') return null;

  // ১) Sheet-এর নিজস্ব Date অবজেক্ট ফরম্যাট: Date(2026,6,29)
  let m = raw.match(/^Date\((\d+),(\d+),(\d+)/);
  if (m) return new Date(Number(m[1]), Number(m[2]), Number(m[3]));

  // ২) স্ল্যাশ/হাইফেন দিয়ে লেখা তারিখ — DD/MM/YYYY অথবা MM/DD/YYYY দুটোই হতে পারে।
  // যেই সংখ্যাটা ১২-এর বেশি সেটাই আসলে "দিন" (day), কারণ মাস কখনো ১২-এর বেশি হয় না।
  // এই ফিক্সের আগে কোড সবসময় DD/MM ধরে নিত, তাই "07/31/2026"-এর মতো
  // MM/DD/YYYY এন্ট্রি ভুলভাবে পার্স হচ্ছিল (মাস ৩১ ধরে নিত) — এখন সেটা ঠিক হলো।
  m = raw.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (m) {
    const a = Number(m[1]), b = Number(m[2]), y = Number(m[3]);
    let day, month;
    if (a > 12) { day = a; month = b; }         // DD/MM/YYYY (প্রথম সংখ্যা ১২-এর বেশি)
    else if (b > 12) { day = b; month = a; }    // MM/DD/YYYY (দ্বিতীয় সংখ্যা ১২-এর বেশি)
    else { day = b; month = a; }                 // দুটোই ≤12 হলে MM/DD/YYYY ধরে নেওয়া হলো (Sheet-এর বর্তমান ফরম্যাট)
    return new Date(y, month - 1, day);
  }

  // ৩) YYYY-MM-DD (ISO ফরম্যাট)
  const d = new Date(raw);
  return isNaN(d.getTime()) ? null : d;
}

// ── "কতদিন আগে আপলোড হয়েছে" — Sheet-এর কলাম E (date)-এ তারিখ থাকলে
// সেটা থেকে "৩ দিন আগে" ইত্যাদি হিসাব করে ──
function timeAgo(dateStr) {
  const then = parseSheetDate(dateStr);
  if (!then) return '';
  const diffMs  = Date.now() - then.getTime();
  if (diffMs < 0) return '';
  const diffMin = Math.floor(diffMs / 60000);
  const diffHr  = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHr / 24);
  const diffMon = Math.floor(diffDay / 30);
  const diffYr  = Math.floor(diffDay / 365);
  if (diffMin < 60) return diffMin <= 1 ? 'just now' : `${diffMin} minute${diffMin === 1 ? '' : 's'} ago`;
  if (diffHr < 24)  return `${diffHr} hour${diffHr === 1 ? '' : 's'} ago`;
  if (diffDay < 30) return `${diffDay} day${diffDay === 1 ? '' : 's'} ago`;
  if (diffMon < 12) return `${diffMon} month${diffMon === 1 ? '' : 's'} ago`;
  return `${diffYr} year${diffYr === 1 ? '' : 's'} ago`;
}

// ── schema.org VideoObject-এর uploadDate ফিল্ডের জন্য পুরো ISO 8601
// ফরম্যাট (সময় + timezone সহ) বানায়, যেমন "2026-07-29T00:00:00+06:00"।
// Bangladesh সবসময় UTC+6 (কোনো DST নেই), তাই অফসেট ফিক্সড রাখা নিরাপদ। ──
function formatIso8601BD(date) {
  const pad = n => String(n).padStart(2, '0');
  const y = date.getFullYear();
  const mo = pad(date.getMonth() + 1);
  const d = pad(date.getDate());
  return `${y}-${mo}-${d}T00:00:00+06:00`;
}

// ── থাম্বনেইল: postimg.cc লিংকের জন্য প্রক্সি বাদ দিয়ে সরাসরি URL ব্যবহার হচ্ছে,
// কারণ wsrv.nl একসাথে অনেক রিকোয়েস্ট পেলে rate-limit/timeout করে ফেলছিল। ──
function thumbUrl(url, width, quality = 78) {
  if (!url) return url;
  if (url.includes('postimg.cc')) return url;
  const clean = url.replace(/^https?:\/\//, '');
  return `https://wsrv.nl/?url=${encodeURIComponent(clean)}&w=${width}&q=${quality}&output=webp`;
}

// index.js-এর PER_PAGE-এর সাথে অবশ্যই মিলতে হবে, নাহলে pageBatch নম্বর গরমিল হবে
const PER_PAGE = 30;

// একটা ভিডিও একাধিক ক্যাটাগরিতে থাকতে পারবে — Sheets-এ কমা (,) দিয়ে
// আলাদা করে লিখলেই ভিডিওটা দুই জায়গাতেই দেখাবে (index.js-এর সাথে consistent)
function parseCategories(str) {
  const arr = (str || '').split(',').map(s => s.trim()).filter(Boolean);
  return arr.length ? arr : ['General'];
}

// ── SEO ট্যাগ সিস্টেম। Sheet-এর কলাম J (index 9)-এ কমা দিয়ে আলাদা করা ট্যাগ লেখা যাবে।
// প্রতিটা /tag/[tag-slug] নামে আলাদা archive পেজে নিয়ে যাবে। ──
function parseTags(str) {
  return (str || '').split(',').map(s => s.trim()).filter(Boolean);
}

// একই টাইটেল বারবার এলে slug-এর শেষে -2, -3 ... যোগ হবে, যাতে প্রতিটা
// ভিডিওর নিজস্ব আলাদা URL থাকে। index.js আর sitemap.js-এও এই একই
// লজিক ব্যবহার করা হয়েছে, তাই সব জায়গায় slug মিলে যাবে।
//
// ── SLUG ফ্রিজ ফিক্স: Sheet-এর কলাম I (index 8)-তে slug বসানো থাকলে
// সেটাই ব্যবহার হবে (Title বদলালেও URL অক্ষত থাকে)। কলাম I খালি থাকলে
// আগের মতোই Title থেকে auto-generate হবে। ──
function getUniqueSlugs(rows, slugifyFn) {
  const counts = {};
  return rows.map(row => {
    const frozen = (row.c[8]?.v || '').toString().trim();
    if (frozen) return frozen.replace(/\s+/g, '-');
    const base = slugifyFn(row.c[0]?.v || 'video');
    counts[base] = (counts[base] || 0) + 1;
    return counts[base] > 1 ? `${base}-${counts[base]}` : base;
  });
}

// ── পুরনো প্লেয়ার ক্লিক-অ্যাড (overlay + বাইরে প্রথম ক্লিক) এখন বন্ধ।
// তার বদলে নিচে HilltopAds Popunder script ব্যবহার হচ্ছে। ──
const ENABLE_PLAYER_CLICK_AD = false;
const PLAYER_AD_URL = '';

function getEmbedUrl(url) {
  if (!url) return '';
  if (url.includes('archive.org/embed/')) return url;
  const arcMatch = url.match(/archive\.org\/details\/([^\/\?&]+)/);
  if (arcMatch) return `https://archive.org/embed/${arcMatch[1]}`;
  if (url.includes('drive.google.com/file/d/') && url.includes('/preview')) return url;
  const f1 = url.match(/drive\.google\.com\/file\/d\/([^\/\?&]+)/);
  if (f1) return `https://drive.google.com/file/d/${f1[1]}/preview`;
  const f2 = url.match(/[?&]id=([^&]+)/);
  if (f2) return `https://drive.google.com/file/d/${f2[1]}/preview`;
  return url;
}

// ── Sheet-এর "hls_url" কলামে (column H, index 7) হয় পুরো R2 লিংক
// অথবা শুধু path অংশ বসানো যাবে — দুটোই কাজ করবে।
// এই ফাংশন শুধু path অংশটুকু বের করে আনে, যাতে সেটা /api/video/<path>
// প্রোটেক্টেড প্রক্সি রুটে পাঠানো যায়। ──
function getHlsProxyPath(raw) {
  if (!raw) return '';
  const trimmed = raw.trim();
  try {
    const u = new URL(trimmed); // পুরো URL হলে শুধু pathname নেওয়া হচ্ছে
    return u.pathname.replace(/^\/+/, '');
  } catch {
    return trimmed.replace(/^\/+/, ''); // ইতিমধ্যে relative path হলে সরাসরি ব্যবহার
  }
}

// ── CPU কমানোর ফিক্স: getSheetRows() ৩০ সেকেন্ড একই rows array ফেরত দেয়,
// তাই array একই থাকলে আগের হিসাব করা ফলাফলই ব্যবহার হবে। ──
let _allRows = null;
let _allVideos = null;
function buildAllVideos(rows) {
  if (_allRows === rows && _allVideos) return _allVideos;
    const uniqueSlugs = getUniqueSlugs(rows, slugify);

    const built = rows.map((row, i) => ({
      id: i,
      title:       row.c[0]?.v || 'Untitled',
      videoUrl:    row.c[1]?.v || '',
      thumbnail:   row.c[2]?.v || `https://picsum.photos/seed/${i}/640/360`,
      categories:  parseCategories(row.c[3]?.v),
      date:        row.c[4]?.v || '',
      duration:    row.c[5]?.v || '',
      description: row.c[6]?.v || '',
      hlsPath:     getHlsProxyPath(row.c[7]?.v || ''), // ── কলাম H: hls_url ──
      tags:        parseTags(row.c[9]?.v || ''), // ── কলাম J: Tags ──
      slug:        uniqueSlugs[i]
    })).filter(v => v.title !== 'Title').reverse()
      .map((v, idx) => ({ ...v, pageBatch: Math.floor(idx / PER_PAGE) + 1 }));
  _allRows = rows;
  _allVideos = built;
  return built;
}

export async function getServerSideProps({ params, query, res: httpRes }) {
  // ── রিকোয়েস্ট কমানোর ফিক্স: 900s (15 মিনিট) Edge cache + stale-while-revalidate ──
  httpRes.setHeader('Cache-Control', 'public, s-maxage=900, stale-while-revalidate=1800');

  try {
    const rows = await getSheetRows();
    const allVideos = buildAllVideos(rows);

    const norm = s => String(s).trim().replace(/\s+/g, '-');
    const video = allVideos.find(v => v.slug === params.slug)
               || allVideos.find(v => v.slug === norm(params.slug));
    if (!video) return { notFound: true };
    if (video.slug !== params.slug) {
      return { redirect: { destination: `/video/${encodeURIComponent(video.slug)}`, permanent: true } };
    }

    // ── ?autoplay=1 ট্যাব: লিস্টগুলো প্রথম ট্যাব থেকেই আসবে, তাই সার্ভার আবার বানাবে না। ──
    if (query && query.autoplay === '1') {
      return { props: { video, related: [], moreVideos: [], latestVideos: [] } };
    }

    // ── Related videos: এই ভিডিওর নিজের ক্যাটাগরি থেকে ৫টা করে, তারপর
    // সাইটের বাকি সব ক্যাটাগরি থেকেও ৫টা করে, আর শেষে একই batch/page থেকে ২-৩টা। ──
    const usedIds = new Set([video.id]);
    const relatedVideos = [];

    // প্রতিটা ক্যাটাগরির পুরো লিস্ট থেকে random ৫টা বাছা হচ্ছে, তাই ভিডিও বদলালে related-ও বদলে যাবে।
    function pickRotated(cat, count) {
      const pool = allVideos.filter(v => v.categories.includes(cat) && !usedIds.has(v.id));
      for (let i = pool.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [pool[i], pool[j]] = [pool[j], pool[i]];
      }
      return pool.slice(0, count);
    }

    video.categories.forEach(cat => {
      const matches = pickRotated(cat, 5);
      matches.forEach(v => { relatedVideos.push(v); usedIds.add(v.id); });
    });

    const allCategories = [...new Set(allVideos.flatMap(v => v.categories))];
    const otherCategories = allCategories.filter(cat => !video.categories.includes(cat));
    otherCategories.forEach(cat => {
      const matches = pickRotated(cat, 5);
      matches.forEach(v => { relatedVideos.push(v); usedIds.add(v.id); });
    });

    const batchRelated = allVideos.filter(v => !usedIds.has(v.id) && v.pageBatch === video.pageBatch).slice(0, 3);
    batchRelated.forEach(v => usedIds.add(v.id));
    const related = [...relatedVideos, ...batchRelated].slice(0, 40);

    // moreVideos কম্পোনেন্টে ব্যবহার হয় না, তাই খালি পাঠানো হচ্ছে (পেলোড ছোট রাখতে)।
    const leanify = v => ({ id: v.id, title: v.title, thumbnail: v.thumbnail, categories: v.categories, date: v.date, slug: v.slug, duration: v.duration });
    const moreVideos = [];

    // ── Latest Videos: allVideos (নতুন থেকে পুরোনো) থেকে সরাসরি সবচেয়ে নতুনগুলো ──
    const LATEST_VIDEOS_COUNT = 12;
    const latestVideos = allVideos.filter(v => v.id !== video.id).slice(0, LATEST_VIDEOS_COUNT).map(leanify);

    return { props: { video, related, moreVideos, latestVideos } };
  } catch(e) {
    httpRes.setHeader('Cache-Control', 'no-store');
    return { notFound: true };
  }
}

// ── নিজস্ব R2 (Cloudflare) থেকে আসা ভিডিওর জন্য ইউনিভার্সাল কাস্টম প্লেয়ার —
// .m3u8 (HLS) এবং .mp4/.webm/.mov দুই ধরনের ফাইলই চেনে ও চালায়।
// - .m3u8 হলে: hls.js (CDN থেকে লোড) দিয়ে চলে; Safari-তে native HLS।
// - .mp4/.webm/.mov হলে: সাধারণ <video><source> দিয়ে সরাসরি চলে। ──
function ProtectedPlayer({ src }) {
  const videoRef = useRef(null);
  const isHls = /\.m3u8(\?|$)/i.test(src);

  useEffect(() => {
    if (!isHls) return; // MP4/WebM-এর জন্য আলাদা JS সেটআপ লাগে না
    const video = videoRef.current;
    if (!video || !src) return;

    let hls;

    function setup() {
      if (video.canPlayType('application/vnd.apple.mpegurl')) {
        video.src = src; // Safari / iOS native HLS
      } else if (window.Hls && window.Hls.isSupported()) {
        hls = new window.Hls();
        hls.loadSource(src);
        hls.attachMedia(video);
      }
    }

    if (window.Hls) {
      setup();
    } else {
      const script = document.createElement('script');
      script.src = 'https://cdnjs.cloudflare.com/ajax/libs/hls.js/1.5.15/hls.min.js';
      script.onload = setup;
      document.body.appendChild(script);
    }

    return () => {
      if (hls) hls.destroy();
    };
  }, [src, isHls]);

  return (
    <video
      ref={videoRef}
      controls
      autoPlay
      playsInline
      preload="metadata"
      controlsList="nodownload"
      style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', background: '#000', objectFit: 'contain' }}
    >
      {!isHls && <source src={src} />}
    </video>
  );
}

export default function VideoPage({ video, related: relatedProp, moreVideos, latestVideos: latestProp }) {
  const router = useRouter();
  // ── ?autoplay=1 ট্যাবে লিস্ট সার্ভার থেকে আবার আনা হয় না; প্রথম ট্যাব
  // ওভারলে ক্লিকের সময় লিস্টটা localStorage-এ রেখে যায়, এখানে সেটাই দেখানো হয়। ──
  const [passedLists, setPassedLists] = useState(null);
  useEffect(() => {
    if (router.query.autoplay !== '1') return;
    try {
      const key = 'vhub_pass_' + video.slug;
      const raw = localStorage.getItem(key);
      if (!raw) return;
      localStorage.removeItem(key);
      const d = JSON.parse(raw);
      if (d && Date.now() - d.t < 10 * 60 * 1000) setPassedLists(d);
    } catch (e) {}
  }, [router.query.autoplay, video.slug]);
  const related = passedLists ? passedLists.related : relatedProp;
  const latestVideos = passedLists ? passedLists.latestVideos : latestProp;
  const [likes, setLikes] = useState({});
  // ── নেট স্পিড ডিটেকশন: প্রথমে 'normal' (hydration mismatch এড়াতে),
  // mount-এর পর আসল অবস্থা (slow/normal/fast) অনুযায়ী state বদলায় ──
  const [netTier, setNetTier] = useState('normal'); // 'slow' | 'normal' | 'fast'
  useEffect(() => {
    try {
      const conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
      if (!conn) return;
      const check = () => {
        if (conn.saveData || ['slow-2g', '2g', '3g'].includes(conn.effectiveType)) {
          setNetTier('slow');
        } else if (conn.effectiveType === '4g' && (conn.downlink === undefined || conn.downlink >= 5)) {
          setNetTier('fast');
        } else {
          setNetTier('normal');
        }
      };
      check();
      conn.addEventListener && conn.addEventListener('change', check);
      return () => conn.removeEventListener && conn.removeEventListener('change', check);
    } catch (e) {}
  }, []);
  // স্লো নেটে ছোট সাইজ+কম quality, ফাস্ট নেটে সাইজ+quality বাড়িয়ে শার্প থাম্বনেইল ──
  const adaptiveThumb = (url, width) => {
    if (netTier === 'slow') return thumbUrl(url, Math.round(width * 0.55), 55);
    if (netTier === 'fast') return thumbUrl(url, Math.round(width * 1.25), 82);
    return thumbUrl(url, width);
  };
  const [views, setViews] = useState({});
  const [liked, setLiked] = useState(false);
  const [showOverlay, setShowOverlay] = useState(ENABLE_PLAYER_CLICK_AD);

  const [iframeStarted, setIframeStarted] = useState(false); // Google Drive/archive.org embed-এর ক্ষেত্রে থাম্বনেইলে ক্লিক করার আগ পর্যন্ত iframe লোড হবে না

  // প্লেয়ার overlay-র নিজস্ব ক্লিক (ENABLE_PLAYER_CLICK_AD বন্ধ থাকলে এটা কখনো চলে না)
  function handleOverlayClick() {
    window.open(PLAYER_AD_URL, '_blank');
    setShowOverlay(false);
  }

  // প্লেয়ারের বাইরের অংশে প্রথম ক্লিক (ENABLE_PLAYER_CLICK_AD বন্ধ থাকলে কিছুই করে না)
  useEffect(() => {
    if (!ENABLE_PLAYER_CLICK_AD) return;
    function onFirstClick(e) {
      if (e.target && e.target.closest && e.target.closest('.video-overlay')) return; // প্লেয়ারের ক্লিক overlay নিজে সামলায়
      document.removeEventListener('click', onFirstClick, true);
      e.preventDefault();
      e.stopImmediatePropagation();
      window.open(PLAYER_AD_URL, '_blank');
    }
    document.addEventListener('click', onFirstClick, true);
    return () => document.removeEventListener('click', onFirstClick, true);
  }, [video.slug]);

  // ── Popunder script (HilltopAds) ──
  useEffect(() => {
    const s = document.createElement('script');
    s.settings = {};
    s.src = '//infamous-maximum.com/c/D.9H6pbI2y5LljS/WYQY9AN/z/Ul5GMcjTQ/4EM-Sa0T3KN/TwkYynN-DFgC1P';
    s.async = true;
    s.referrerPolicy = 'no-referrer-when-downgrade';
    document.body.appendChild(s);
    return () => { if (s.parentNode) s.parentNode.removeChild(s); };
  }, []);

  // ── URL-এ ?autoplay=1 প্যারাম থাকলে overlay স্কিপ করে ভিডিও/iframe সাথে সাথেই চালু হয় ──
  useEffect(() => {
    if (router.query.autoplay === '1') {
      setShowOverlay(false);
      setIframeStarted(true);
    }
  }, [router.query.autoplay]);

  // ── Infinite scroll: শুরুতে related videos-এর প্রথম ১২টা দেখানো হয়,
  // স্ক্রল করলে ৮টা করে ব্যাচে বাকিগুলো লোড হয় (সর্বোচ্চ ৪০টা) ──
  const INITIAL_RELATED_SHOW = 12;
  const LOAD_CHUNK = 8;
  const [extraCount, setExtraCount] = useState(0);
  const loadMoreRef = useRef(null);

  const initialRelated = related.slice(0, INITIAL_RELATED_SHOW);
  const infiniteScrollPool = related.slice(INITIAL_RELATED_SHOW);
  const extraRelated = infiniteScrollPool.slice(0, extraCount);
  const hasMoreToLoad = extraCount < infiniteScrollPool.length;

  // ── ফাইল ডাউনলোড হেল্পার: নিজস্ব R2 সার্ভারের mp4/webm ভিডিও হলে ফাইল ডাউনলোড হয় ──
  function triggerFileDownload(url, filename) {
    const a = document.createElement('a');
    a.href = url;
    a.download = filename || 'video';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }

  // ── ডাউনলোড: শুধু ফাইল ডাউনলোড হবে (HLS হলে কিছু হবে না), কোনো অ্যাড নেই ──
  function handleDownloadClick(e) {
    e.preventDefault();

    const isHlsFile = /\.m3u8(\?|$)/i.test(video.hlsPath || '');
    const downloadSrc = (video.hlsPath && !isHlsFile)
      ? `/api/video/${video.hlsPath}`
      : (isDirectVideo ? video.videoUrl : null);

    if (downloadSrc) {
      triggerFileDownload(downloadSrc, video.title);
    }
  }

  // ── নতুন ভিডিও পেজে গেলে (video.id বদলালে) infinite-scroll কাউন্টার রিসেট ──
  useEffect(() => {
    setExtraCount(0);
  }, [video.id]);

  // ── সেন্টিনেল এলিমেন্ট viewport-এ এলে আরও একটা ব্যাচ (৮টা) ভিডিও লোড হবে ──
  useEffect(() => {
    const el = loadMoreRef.current;
    if (!el) return;

    const observer = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting) {
        setExtraCount(prev => Math.min(prev + LOAD_CHUNK, infiniteScrollPool.length));
      }
    }, { rootMargin: '300px 0px' });

    observer.observe(el);
    return () => observer.disconnect();
  }, [video.id, infiniteScrollPool.length]);

  useEffect(() => {
    try {
      const l = JSON.parse(localStorage.getItem('vhub_likes') || '{}');
      setLikes(l);
      setLiked(!!l[video.id]);
    } catch(e) {}

    // ── ভিউ কাউন্ট: Cloudflare D1 database (/api/track-view)।
    // ?autoplay=1 ট্যাব একই ভিজিটের কপি, তাই সেখানে আবার গণনা হয় না। ──
    try {
      if (router.query.autoplay !== '1') {
        fetch('/api/track-view', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ slug: video.slug })
        }).catch(() => {});
      }
    } catch(e) {}

    // ── D1 থেকে সব ভিডিওর ভিউ কাউন্ট একসাথে fetch করা হচ্ছে ──
    fetch('/api/get-views')
      .then(res => res.json())
      .then(counts => setViews(counts))
      .catch(() => {});
  }, [video.id]);


  function toggleLike() {
    const newLikes = { ...likes };
    if (newLikes[video.id]) { delete newLikes[video.id]; setLiked(false); }
    else { newLikes[video.id] = 1; setLiked(true); }
    setLikes(newLikes);
    localStorage.setItem('vhub_likes', JSON.stringify(newLikes));
  }

  function shareVideo() {
    const url = `${SITE_URL}/video/${encodeURIComponent(video.slug)}`;
    if (typeof navigator !== 'undefined' && navigator.share) {
      navigator.share({ title: video.title + ' | ViralLink BD', url }).catch(() => {});
      return;
    }
    const manual = () => prompt('লিংকটা কপি করুন:', url);
    if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url).then(() => alert('লিংক কপি হয়েছে!')).catch(manual);
    } else {
      manual();
    }
  }

  const pageUrl = `${SITE_URL}/video/${video.slug}`;
  const embedUrl = getEmbedUrl(video.videoUrl);
  const isDirectVideo = /\.(mp4|webm|ogg|mov)/i.test(video.videoUrl) &&
    !video.videoUrl.includes('drive.google.com') &&
    !video.videoUrl.includes('archive.org');

  const videoSchema = {
    "@context": "https://schema.org",
    "@type": "VideoObject",
    "name": video.title,
    "description": video.description || video.title,
    "thumbnailUrl": video.thumbnail,
    // পুরো ISO 8601 ফরম্যাট (সময় + timezone সহ), যেমন: "2026-07-29T00:00:00+06:00"
    "uploadDate": formatIso8601BD(parseSheetDate(video.date) || new Date()),
    "contentUrl": video.videoUrl,
    "embedUrl": pageUrl,
    "publisher": { "@type": "Organization", "name": "ViralLink BD", "url": SITE_URL }
  };

  const breadcrumbSchema = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    "itemListElement": [
      { "@type": "ListItem", "position": 1, "name": "Home", "item": SITE_URL },
      { "@type": "ListItem", "position": 2, "name": video.categories[0], "item": `${SITE_URL}/?cat=${video.categories[0]}` },
      { "@type": "ListItem", "position": 3, "name": video.title, "item": pageUrl }
    ]
  };

  return (
    <>
      <Head>
        <title>{video.title} | ViralLink BD</title>
        <meta name="description" content={(video.description || video.title) + ' - ViralLink BD ভাইরাল ভিডিও বাংলাদেশ ২০২৬'} />
        <meta name="keywords" content={`tiktoker viral video, Bangladesh tiktoker viral video, tiktok viral video bangladesh, ${video.categories.join(', ')}, বাংলাদেশি ভাইরাল ভিডিও`} />
        <meta name="robots" content="index, follow" />
        <meta name="rating" content="adult" />
        <meta name="rating" content="RTA-5042-1996-1400-1577-RTA" />
        <link rel="canonical" href={pageUrl} />
        <meta property="og:title" content={video.title + ' | ViralLink BD'} />
        <meta property="og:description" content={video.description || video.title} />
        <meta property="og:url" content={pageUrl} />
        <meta property="og:type" content="video.other" />
        <meta property="og:image" content={video.thumbnail} />
        <meta property="og:site_name" content="ViralLink BD" />
        <meta name="twitter:card" content="summary_large_image" />
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(videoSchema) }} />
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbSchema) }} />
        <style>{`
          :root{--bg:#0d0d0d;--surface:#181818;--surface2:#222;--accent:#ff3d3d;--text:#f5f5f5;--muted:#888;--border:#2a2a2a;--radius:10px;}
          *{margin:0;padding:0;box-sizing:border-box;}
          body{background:var(--bg);color:var(--text);font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,'Noto Sans Bengali',sans-serif;min-height:100vh;}
          header{background:#111;border-bottom:2px solid var(--accent);padding:0 4%;position:sticky;top:0;z-index:200;}
          .header-inner{max-width:1400px;margin:0 auto;display:flex;align-items:center;height:44px;gap:1rem;}
          .logo{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,'Noto Sans Bengali',sans-serif;font-size:1.8rem;letter-spacing:2px;color:var(--text);text-decoration:none;}
          .logo span{color:var(--accent);}
          .main{max-width:1400px;margin:0 auto;padding:0.5rem 2% 1rem;}
          .back-btn{display:inline-flex;align-items:center;gap:0.5rem;color:var(--muted);background:var(--surface2);border:1px solid var(--border);border-radius:var(--radius);padding:0.4rem 1rem;cursor:pointer;font-family:inherit;font-size:0.85rem;margin-bottom:0.5rem;text-decoration:none;transition:all 0.2s;}
          .back-btn:hover{color:var(--text);border-color:var(--accent);}
          .player-layout{display:grid;grid-template-columns:1fr 320px;gap:1.5rem;}
          @media(max-width:768px){.player-layout{grid-template-columns:1fr;}.related-sidebar{display:none !important;}.related-mobile{display:block !important;}}
          .video-container{position:relative;padding-top:56.25%;background:#000;border-radius:var(--radius);overflow:hidden;margin-bottom:1rem;}
          .video-container video,.video-container iframe{position:absolute;inset:0;width:100%;height:100%;border:none;}
          .video-stats-row{display:flex;justify-content:space-between;align-items:center;color:var(--muted);font-size:0.82rem;margin-bottom:0.75rem;flex-wrap:wrap;gap:0.5rem;}
          .stats-left{display:flex;align-items:center;gap:0.35rem;color:var(--muted);}
          .stats-category{color:var(--muted);}
          .stats-date{color:var(--muted);}
          .stats-views{color:var(--muted);white-space:nowrap;}
          .video-actions{display:flex;gap:0.5rem;flex-wrap:nowrap;margin:0.9rem 0 1rem;padding-bottom:1rem;border-bottom:1px solid var(--border);}
          .action-btn{display:flex;align-items:center;justify-content:center;gap:0.3rem;flex:1;min-width:0;padding:0.55rem 0.4rem;border-radius:10px;border:1px solid var(--border);background:var(--surface2);color:var(--text);cursor:pointer;font-family:inherit;font-size:0.78rem;font-weight:600;transition:all 0.2s;text-decoration:none;white-space:nowrap;}
          .action-btn:hover{border-color:var(--accent);color:var(--accent);}
          .action-btn.liked{border-color:#dc2626;color:#dc2626;}
          .action-btn.share-btn:hover{border-color:#16a34a;color:#16a34a;}
          .action-btn.download-btn:hover{border-color:#dc2626;color:#dc2626;}
          .video-description{color:#ccc;font-size:0.9rem;line-height:1.7;margin-bottom:1rem;padding:0.75rem 1rem;background:var(--surface2);border-radius:var(--radius);border-left:3px solid var(--accent);}
          .video-tags{display:flex;flex-wrap:wrap;gap:0.5rem;margin-bottom:1rem;}
          .tag-pill{display:inline-block;padding:0.3rem 0.75rem;background:var(--surface2);color:var(--muted);font-size:0.8rem;border-radius:999px;text-decoration:none;border:1px solid rgba(255,255,255,0.1);transition:background 0.15s,color 0.15s;}
          .tag-pill:hover{background:var(--accent);color:#fff;}
          .related-section-title{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,'Noto Sans Bengali',sans-serif;font-size:1.2rem;margin-bottom:1rem;letter-spacing:1px;}
          .related-list{display:grid;grid-template-columns:repeat(2,1fr);gap:2px;}
          @media(min-width:600px){.related-list{grid-template-columns:repeat(3,1fr);}}
          @media(min-width:1024px){.player-layout .related-sidebar .related-list{grid-template-columns:repeat(2,1fr);}}
          .related-card{background:var(--surface);overflow:hidden;cursor:pointer;transition:box-shadow 0.2s;border-bottom:1px solid var(--border);text-decoration:none;color:inherit;display:block;}
          .related-card:hover{box-shadow:0 4px 20px rgba(255,61,61,0.2);}
          .related-thumb{position:relative;width:100%;padding-top:56.25%;background:#000;overflow:hidden;}
          .related-thumb img{position:absolute;top:0;left:0;width:100%;height:100%;object-fit:cover;transition:transform 0.3s;}
          .video-seo-footer{padding:1.5rem 0 0.5rem;font-size:0.85rem;color:var(--muted);line-height:1.7;border-top:1px solid var(--border);margin-top:1.5rem;}
          .video-seo-footer p{margin:0;}
          .thumb-blur{filter:blur(14px);transform:scale(1.15);}
          .thumb-full{opacity:0;transition:opacity 0.35s ease;}
          .thumb-full.loaded{opacity:1;}
          .duration-badge{position:absolute;bottom:4px;right:4px;background:rgba(0,0,0,0.45);color:#fff;font-size:0.62rem;font-weight:600;padding:1px 5px;border-radius:3px;line-height:1.3;z-index:2;}
          .related-card:hover .related-thumb img{transform:scale(1.03);}
          .related-info{padding:0.5rem 0.6rem;}
          .related-title-text{font-size:0.78rem;font-weight:600;display:-webkit-box;-webkit-line-clamp:1;-webkit-box-orient:vertical;overflow:hidden;line-height:1.3;margin-bottom:0.25rem;}
          .related-meta{font-size:0.7rem;color:var(--muted);}
          .breadcrumb{font-size:0.8rem;color:var(--muted);margin-bottom:0.5rem;}
          .breadcrumb a{color:var(--muted);text-decoration:none;}
          .breadcrumb a:hover{color:var(--accent);}
          .related-mobile{display:none;}
          .latest-videos-block{margin-bottom:1.5rem;}
          .ad-banner-slot{display:flex;justify-content:center;margin:1rem 0;overflow:hidden;}
          .ad-banner-slot iframe{max-width:100%;}
          .iframe-click-gate{position:absolute;inset:0;width:100%;height:100%;cursor:pointer;background:#000;}
          .iframe-click-gate img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;}
          .iframe-click-gate .thumb-blur{filter:blur(14px);transform:scale(1.15);opacity:0.75;}
          .iframe-click-gate .thumb-full{opacity:0;transition:opacity 0.35s ease;}
          .iframe-click-gate .thumb-full.loaded{opacity:0.75;}
          .iframe-click-gate .play-btn-icon{position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);width:64px;height:64px;border-radius:50%;background:rgba(255,61,61,0.9);display:flex;align-items:center;justify-content:center;color:#fff;font-size:24px;box-shadow:0 4px 16px rgba(0,0,0,0.5);}
          .video-overlay{position:absolute;inset:0;width:100%;height:100%;background:transparent;cursor:pointer;z-index:10;}
          .player-wrap{position:relative;}
          .ad-anchor{position:relative;}
          .bottom-ad{position:absolute;left:0;right:0;top:100%;height:100vh;background:#000;z-index:150;}
          .bottom-ad iframe{position:absolute;inset:0;width:100%;height:100%;border:0;background:#000;}
          .bottom-ad-badge{position:absolute;z-index:2;top:10px;right:10px;width:34px;height:34px;border-radius:50%;background:rgba(255,255,255,0.15);color:#fff;font-size:0.95rem;font-weight:700;display:flex;align-items:center;justify-content:center;border:1px solid rgba(255,255,255,0.35);}
          .bottom-ad-close{cursor:pointer;font-size:1.05rem;line-height:1;padding:0;}
          .inline-ad-overlay{position:relative;width:100%;height:100vh;margin:1rem 0;background:#000;overflow:hidden;transition:height .4s ease;}
          .inline-ad-overlay iframe{position:absolute;inset:0;width:100%;height:100%;border:0;background:#000;}
        `}</style>
      </Head>

      <header>
        <div className="header-inner">
          <a className="logo" href="/">ViralLink<span>BD</span></a>
        </div>
      </header>

      <div className="main">
        <a className="back-btn" href="/">← হোমে ফিরুন</a>

        <div className="breadcrumb">
          <a href="/">Home</a> › <a href={`/?cat=${video.categories[0]}`}>{video.categories.join(', ')}</a> › {video.title}
        </div>

        <div className="player-layout">
          <div className="player-main">
            <div className="ad-anchor">
            <div className="player-wrap">
            <div className="video-container">
              {video.hlsPath ? (
                // ── নিজের R2 (Cloudflare) থেকে ভিডিও — /api/video/... প্রোটেক্টেড প্রক্সি দিয়ে চলে ──
                <ProtectedPlayer src={`/api/video/${video.hlsPath}`} />
              ) : isDirectVideo ? (
                <video controls autoPlay playsInline preload="metadata" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', background: '#000', objectFit: 'contain' }}>
                  <source src={video.videoUrl} type="video/mp4" />
                </video>
              ) : iframeStarted ? (
                <iframe
                  src={embedUrl}
                  allowFullScreen
                  allow="autoplay; fullscreen; encrypted-media"
                  style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', border: 'none', background: '#000' }}
                />
              ) : (
                // cross-origin iframe-এর ভিতরের ক্লিক ধরা যায় না, তাই থাম্বনেইল+▶ বসিয়ে
                // প্রথম ক্লিকটা এখানেই ধরা হচ্ছে — এতে iframe লোড হয়
                <div className="iframe-click-gate" onClick={() => setIframeStarted(true)}>
                  <img
                    src={adaptiveThumb(video.thumbnail, 800)}
                    alt={video.title}
                    onError={e => {
                      if (e.target.dataset.fallback !== 'original' && video.thumbnail) {
                        e.target.dataset.fallback = 'original';
                        e.target.src = video.thumbnail;
                      } else if (e.target.dataset.fallback !== 'category') {
                        e.target.dataset.fallback = 'category';
                        const fb = getFallbackThumb(video.id, video.categories, related);
                        if (fb) e.target.src = fb; else e.target.style.visibility = 'hidden';
                      } else {
                        e.target.style.visibility = 'hidden';
                      }
                    }}
                  />
                  <div className="play-btn-icon">▶</div>
                </div>
              )}
              {ENABLE_PLAYER_CLICK_AD && showOverlay && (
                <div className="video-overlay" onClick={handleOverlayClick}></div>
              )}
            </div>
            </div>

            <div className="video-stats-row">
              <div className="stats-left">
                <span className="stats-category">{video.categories.join(', ')}</span>
                {video.date && <span className="stats-date">· {timeAgo(video.date) || video.date}</span>}
              </div>
              <span className="stats-views">👁 {formatNum(views[video.slug] || 0)} views</span>
            </div>

            </div>

            {/* কমপ্যাক্ট তিনটা বাটন এক লাইনে: ডাউনলোড, লাইক, শেয়ার */}
            <div className="video-actions">
              <button className="action-btn download-btn" onClick={handleDownloadClick}>⬇ Download</button>
              <button className={`action-btn${liked ? ' liked' : ''}`} onClick={toggleLike}>
                ❤️ {formatNum(likes[video.id] || 0)}
              </button>
              <button className="action-btn share-btn" onClick={shareVideo}>🔗 Share</button>
            </div>

            {video.description && (
              <p className="video-description">{video.description}</p>
            )}

            {video.tags && video.tags.length > 0 && (
              <div className="video-tags">
                {video.tags.map((tag, ti) => (
                  <a key={ti} href={`/tag/${slugify(tag)}`} className="tag-pill">#{tag}</a>
                ))}
              </div>
            )}

            {/* ── লেটেস্ট ভিডিও: সাইটের সবচেয়ে নতুন ভিডিওগুলো ── */}
            {latestVideos.length > 0 && (
              <div className="latest-videos-block">
                <div className="related-section-title">Latest Videos</div>
                <div className="related-list">
                  {latestVideos.map(v => (
                    <a key={v.id} className="related-card" href={`/video/${v.slug}`}>
                      <div className="related-thumb">
                        <img
                          src={adaptiveThumb(v.thumbnail, 400)}
                          alt={v.title}
                          loading="lazy"
                          onError={e => {
                            if (e.target.dataset.fallback !== 'original' && v.thumbnail) {
                              e.target.dataset.fallback = 'original';
                              e.target.src = v.thumbnail;
                            } else if (e.target.dataset.fallback !== 'category') {
                              e.target.dataset.fallback = 'category';
                              const fb = getFallbackThumb(v.id, v.categories, related);
                              if (fb) e.target.src = fb; else e.target.style.visibility = 'hidden';
                            } else {
                              e.target.style.visibility = 'hidden';
                            }
                          }}
                        />
                        {v.duration && <span className="duration-badge">{v.duration}</span>}
                      </div>
                      <div className="related-info">
                        <div className="related-title-text">{v.title}</div>
                        <div className="related-meta">
                          <span>{v.categories.join(', ')}</span>
                          <span> · 👁 {formatNum(views[v.slug] || 0)}</span>
                          {v.date && <span> · {timeAgo(v.date) || v.date}</span>}
                        </div>
                      </div>
                    </a>
                  ))}
                </div>
              </div>
            )}

            {/* Mobile related — শুরুতে শুধু প্রথম ব্যাচ (initialRelated) */}
            <div className="related-mobile">
              <div className="related-section-title">Related Videos</div>
              <div className="related-list">
                {initialRelated.length === 0 ? (
                  <p style={{ color: 'var(--muted)' }}>No related videos</p>
                ) : initialRelated.map(v => (
                  <a key={v.id} className="related-card" href={`/video/${v.slug}`}>
                    <div className="related-thumb">
                      <img
                        src={adaptiveThumb(v.thumbnail, 400)}
                        alt={v.title}
                        loading="lazy"
                        onError={e => {
                          if (e.target.dataset.fallback !== 'original' && v.thumbnail) {
                            e.target.dataset.fallback = 'original';
                            e.target.src = v.thumbnail;
                          } else if (e.target.dataset.fallback !== 'category') {
                            e.target.dataset.fallback = 'category';
                            const fb = getFallbackThumb(v.id, v.categories, related);
                            if (fb) e.target.src = fb; else e.target.style.visibility = 'hidden';
                          } else {
                            e.target.style.visibility = 'hidden';
                          }
                        }}
                      />
                      {v.duration && <span className="duration-badge">{v.duration}</span>}
                    </div>
                    <div className="related-info">
                      <div className="related-title-text">{v.title}</div>
                      <div className="related-meta">
                      <span>{v.categories.join(', ')}</span>
                      <span> · 👁 {formatNum(views[v.slug] || 0)}</span>
                      {v.date && <span> · {timeAgo(v.date) || v.date}</span>}
                    </div>
                    </div>
                  </a>
                ))}
              </div>
            </div>
          </div>

          {/* Desktop sidebar — শুরুতে initialRelated (প্রথম ব্যাচ) */}
          <div className="related-sidebar">
            <div className="related-section-title">Related Videos</div>
            <div className="related-list">
              {initialRelated.length === 0 ? (
                <p style={{ color: 'var(--muted)' }}>No related videos</p>
              ) : initialRelated.map(v => (
                <a key={v.id} className="related-card" href={`/video/${v.slug}`}>
                  <div className="related-thumb">
                    <img
                      src={adaptiveThumb(v.thumbnail, 400)}
                      alt={v.title}
                      loading="lazy"
                      onError={e => {
                        if (e.target.dataset.fallback !== 'original' && v.thumbnail) {
                          e.target.dataset.fallback = 'original';
                          e.target.src = v.thumbnail;
                        } else if (e.target.dataset.fallback !== 'category') {
                          e.target.dataset.fallback = 'category';
                          const fb = getFallbackThumb(v.id, v.categories, related);
                          if (fb) e.target.src = fb; else e.target.style.visibility = 'hidden';
                        } else {
                          e.target.style.visibility = 'hidden';
                        }
                      }}
                    />
                    {v.duration && <span className="duration-badge">{v.duration}</span>}
                  </div>
                  <div className="related-info">
                    <div className="related-title-text">{v.title}</div>
                    <div className="related-meta">
                      <span>{v.categories.join(', ')}</span>
                      <span> · 👁 {formatNum(views[v.slug] || 0)}</span>
                      {v.date && <span> · {timeAgo(v.date) || v.date}</span>}
                    </div>
                  </div>
                </a>
              ))}
            </div>
          </div>
        </div>

        {/* ── Infinite scroll: স্ক্রল করলে ধীরে ধীরে আরও related videos ── */}
        {extraRelated.length > 0 && (
          <>
            <div className="related-list">
              {extraRelated.map(v => (
                <a key={v.id} className="related-card" href={`/video/${v.slug}`}>
                  <div className="related-thumb">
                    <img
                      src={adaptiveThumb(v.thumbnail, 400)}
                      alt={v.title}
                      loading="lazy"
                      onError={e => {
                        if (e.target.dataset.fallback !== 'original' && v.thumbnail) {
                          e.target.dataset.fallback = 'original';
                          e.target.src = v.thumbnail;
                        } else if (e.target.dataset.fallback !== 'category') {
                          e.target.dataset.fallback = 'category';
                          const fb = getFallbackThumb(v.id, v.categories, related);
                          if (fb) e.target.src = fb; else e.target.style.visibility = 'hidden';
                        } else {
                          e.target.style.visibility = 'hidden';
                        }
                      }}
                    />
                    {v.duration && <span className="duration-badge">{v.duration}</span>}
                  </div>
                  <div className="related-info">
                    <div className="related-title-text">{v.title}</div>
                    <div className="related-meta">
                      <span>{v.categories.join(', ')}</span>
                      <span> · 👁 {formatNum(views[v.slug] || 0)}</span>
                      {v.date && <span> · {timeAgo(v.date) || v.date}</span>}
                    </div>
                  </div>
                </a>
              ))}
            </div>
          </>
        )}

        {/* সেন্টিনেল: viewport-এ এলে আরও একটা ব্যাচ ভিডিও লোড হবে */}
        {hasMoreToLoad && (
          <div ref={loadMoreRef} style={{ height: '40px' }}></div>
        )}

        {/* ── SEO: পেজের একদম নিচে ভাইরাল ভিডিও সম্পর্কিত টেক্সট ── */}
        <div className="video-seo-footer">
          <p>ViralLink BD-তে প্রতিদিন নতুন বাংলাদেশি ভাইরাল ভিডিও, ট্রেন্ডিং TikTok ক্লিপ, Facebook Reels আর ফানি ভিডিও একদম ফ্রিতে দেখুন। এই ভিডিওটার মতো আরও হাজারো ভাইরাল ভিডিও বাংলাদেশ ২০২৬-এর সবচেয়ে বড় সংগ্রহ এখানেই পাবেন — প্রতিদিন আপডেট হওয়া নতুন কনটেন্ট নিয়ে।</p>
        </div>

      </div>
    </>
  );
}
