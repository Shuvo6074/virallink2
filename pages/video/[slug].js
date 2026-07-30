import { useState, useEffect } from "react";
import Head from "next/head";
import { useRouter } from "next/router";

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

  // ২) হাতে লেখা DD/MM/YYYY বা DD-MM-YYYY (তোমার Sheet-এর মতো)
  m = raw.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (m) return new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));

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

// ── থাম্বনেইল ফিক্স (আপডেট): index.js-এর মতোই — postimg.cc লিংকের জন্য
// প্রক্সি বাদ দিয়ে সরাসরি URL ব্যবহার করা হচ্ছে, কারণ wsrv.nl একসাথে
// অনেক রিকোয়েস্ট পেলে rate-limit/timeout করে ফেলছিল (প্রথমবার কালো
// থাম্বনেইল, রিলোডে ঠিক হওয়ার কারণ এটাই)। ──
function thumbUrl(url, width) {
  if (!url) return url;
  if (url.includes('postimg.cc')) return url;
  const clean = url.replace(/^https?:\/\//, '');
  return `https://wsrv.nl/?url=${encodeURIComponent(clean)}&w=${width}&q=75&output=webp`;
}

// index.js-এর PER_PAGE-এর সাথে অবশ্যই মিলতে হবে, নাহলে pageBatch নম্বর গরমিল হবে
const PER_PAGE = 30;

// একটা ভিডিও একাধিক ক্যাটাগরিতে থাকতে পারবে — Sheets-এ কমা (,) দিয়ে
// আলাদা করে লিখলেই ভিডিওটা দুই জায়গাতেই দেখাবে (index.js-এর সাথে consistent)
function parseCategories(str) {
  const arr = (str || '').split(',').map(s => s.trim()).filter(Boolean);
  return arr.length ? arr : ['General'];
}

// একই টাইটেল বারবার এলে slug-এর শেষে -2, -3 ... যোগ হবে, যাতে প্রতিটা
// ভিডিওর নিজস্ব আলাদা URL থাকে। index.js আর sitemap.js-এও এই একই
// লজিক ব্যবহার করা হয়েছে, তাই সব জায়গায় slug মিলে যাবে।
function getUniqueSlugs(rows, slugifyFn) {
  const counts = {};
  return rows.map(row => {
    const base = slugifyFn(row.c[0]?.v || 'video');
    counts[base] = (counts[base] || 0) + 1;
    return counts[base] > 1 ? `${base}-${counts[base]}` : base;
  });
}

// ⚠️ ভিউ কাউন্ট এখন Google Form-এর মাধ্যমে জমা হয় (Apps Script লাগে না)
const VIEW_FORM_URL = 'https://docs.google.com/forms/d/e/1FAIpQLScWpnit1sXMbza8XgWmdVV065Y6oYFC9zWEu7i0tGBoQW0S8w/formResponse';
const VIEW_FORM_ENTRY = 'entry.1785504240';
const VIEW_RESPONSES_SHEET_ID = '1-y075MwICFApp4D6Ie-7FxDNVl-pkJHpQSiu396nQoI';

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

export async function getServerSideProps({ params, res: httpRes }) {
  // ── পারফরম্যান্স ফিক্স: index.js-এর মতোই এই পেজও Edge-এ ৬০ সেকেন্ড
  // cache হবে, দ্বিতীয়বার একই ভিডিও পেজে কেউ গেলে সাথে সাথে লোড হবে। ──
  httpRes.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=300');

  try {
    const res = await fetch(`https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:json`);
    const text = await res.text();
    const json = JSON.parse(text.substring(47, text.length - 2));
    const rows = json.table.rows;
    const uniqueSlugs = getUniqueSlugs(rows, slugify);

    const allVideos = rows.map((row, i) => ({
      id: i,
      title:       row.c[0]?.v || 'Untitled',
      videoUrl:    row.c[1]?.v || '',
      thumbnail:   row.c[2]?.v || `https://picsum.photos/seed/${i}/640/360`,
      categories:  parseCategories(row.c[3]?.v),
      date:        row.c[4]?.v || '',
      duration:    row.c[5]?.v || '',
      description: row.c[6]?.v || '',
      slug:        uniqueSlugs[i]
    })).filter(v => v.title !== 'Title').reverse()
      .map((v, idx) => ({ ...v, pageBatch: Math.floor(idx / PER_PAGE) + 1 }));

    const video = allVideos.find(v => v.slug === params.slug);
    if (!video) return { notFound: true };

    // ── Related videos (আপডেট): শুধু এই ভিডিওর নিজের ক্যাটাগরি না, বরং
    // সাইটের সব ক্যাটাগরি থেকেই কিছু কিছু ভিডিও মিক্স করে দেখানো হচ্ছে।
    // প্রথমে এই ভিডিওর নিজের ক্যাটাগরি(গুলো) থেকে ৫টা করে (সবচেয়ে বেশি
    // প্রাসঙ্গিক বলে আগে রাখা হলো), তারপর সাইটের বাকি সব ক্যাটাগরি থেকেও
    // ৫টা করে ভিডিও যোগ করা হচ্ছে, আর শেষে একই batch/page থেকে ২-৩টা। ──
    const usedIds = new Set([video.id]);
    const relatedVideos = [];

    video.categories.forEach(cat => {
      const matches = allVideos.filter(v => !usedIds.has(v.id) && v.categories.includes(cat)).slice(0, 5);
      matches.forEach(v => { relatedVideos.push(v); usedIds.add(v.id); });
    });

    const allCategories = [...new Set(allVideos.flatMap(v => v.categories))];
    const otherCategories = allCategories.filter(cat => !video.categories.includes(cat));
    otherCategories.forEach(cat => {
      const matches = allVideos.filter(v => !usedIds.has(v.id) && v.categories.includes(cat)).slice(0, 5);
      matches.forEach(v => { relatedVideos.push(v); usedIds.add(v.id); });
    });

    const batchRelated = allVideos.filter(v => !usedIds.has(v.id) && v.pageBatch === video.pageBatch).slice(0, 3);
    batchRelated.forEach(v => usedIds.add(v.id));
    const related = [...relatedVideos, ...batchRelated].slice(0, 40);

    return { props: { video, related } };
  } catch(e) {
    return { notFound: true };
  }
}

export default function VideoPage({ video, related }) {
  const [likes, setLikes] = useState({});
  const [views, setViews] = useState({});
  const [liked, setLiked] = useState(false);
  const [showOverlay, setShowOverlay] = useState(true);

  const [iframeStarted, setIframeStarted] = useState(false); // Google Drive/archive.org embed-এর ক্ষেত্রে থাম্বনেইলে ক্লিক করার আগ পর্যন্ত iframe লোড হবে না

  const SMARTLINK_URL = 'https://www.effectivecpmnetwork.com/hzn588p39q?key=c22e2da4de74dbe9769bd7bcc477bb63';

  function handleOverlayClick() {
    window.open(SMARTLINK_URL, '_blank');
    setShowOverlay(false);
    setIframeStarted(true); // ── ফিক্স: আগে এই ক্লিকে শুধু স্মার্টলিংক ওপেন হতো, ভিডিও শুরু
    // হতো না — ইউজারকে ফিরে এসে দ্বিতীয়বার থাম্বনেইলে ক্লিক করতে হতো। এখন
    // একই ক্লিকে স্মার্টলিংক ওপেন হওয়ার পাশাপাশি ভিডিও/iframe-ও সাথে সাথে
    // চলা শুরু করবে। ──
  }

  function handleRelatedClick(e, slug) {
    e.preventDefault();
    window.open(SMARTLINK_URL, '_blank');
    setTimeout(() => { window.location.href = `/video/${slug}`; }, 50);
  }

  function handleDownloadClick(e) {
    e.preventDefault();
    window.open(SMARTLINK_URL, '_blank');
  }

  function handleBackClick(e) {
    e.preventDefault();
    window.open(SMARTLINK_URL, '_blank');
    setTimeout(() => { window.location.href = '/'; }, 50);
  }

  useEffect(() => {
    try {
      const l = JSON.parse(localStorage.getItem('vhub_likes') || '{}');
      setLikes(l);
      setLiked(!!l[video.id]);
    } catch(e) {}

    // ── ভিউ কাউন্ট: প্রতিবার পেজ খুললে এই ভিডিওর slug একটা Google Form-এ
    // জমা (submit) হয়। এটাই একটা "ভিউ" হিসেবে গণনা হয়। সব ভিজিটরের
    // জমা একই Response Sheet-এ গিয়ে জমা হয়, তাই এটা সবার জন্য COMMON,
    // real সংখ্যা — localStorage-এর মতো নিজের ব্রাউজারে সীমাবদ্ধ না। ──
    try {
      const formData = new URLSearchParams();
      // ── সাইট আইডেন্টিফায়ার প্রিফিক্স 'v2-' যোগ করা হলো, যাতে
      // virallink2.site আর bd-viral-hub-এর ভিউ একই sheet-এ গিয়েও
      // একে অপরের সাথে মিশে না যায় ──
      formData.append(VIEW_FORM_ENTRY, `v2-${video.slug}`);
      fetch(VIEW_FORM_URL, {
        method: 'POST',
        mode: 'no-cors', // Google Form নিজে থেকেই এটা require করে, রেসপন্স পড়া যায় না কিন্তু submit ঠিকই হয়
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: formData.toString()
      }).catch(() => {});
    } catch(e) {}

    // ── Apps Script-এর তৈরি "Summary" শিট থেকে ভিউ কাউন্ট পড়া হচ্ছে (fast) —
    // পুরো Response Sheet না পড়ে শুধু slug-অনুযায়ী আগে থেকেই গোনা সংখ্যাগুলো
    // পড়া হচ্ছে, তাই ভিউ যতই বাড়ুক পেজ লোড ধীর হবে না ──
    fetch(`https://docs.google.com/spreadsheets/d/${VIEW_RESPONSES_SHEET_ID}/gviz/tq?tqx=out:json&sheet=Summary`)
      .then(res => res.text())
      .then(text => {
        const json = JSON.parse(text.substring(47, text.length - 2));
        const counts = {};
        json.table.rows.forEach(row => {
          const s = row.c[0]?.v; // কলাম A = slug (prefix সহ, যেমন v2-xxxx)
          const c = row.c[1]?.v; // কলাম B = views
          // শুধু virallink2.site-এর নিজের এন্ট্রি গোনা হচ্ছে, prefix বাদ দিয়ে
          if (s && s.startsWith('v2-')) {
            counts[s.slice(3)] = Number(c) || 0;
          }
        });
        setViews(counts);
      })
      .catch(() => {});
  }, [video.id]);

  // Inject highperformanceformat.com 728x90 banner ads (isolated iframe, runs twice)
  useEffect(() => {
    function buildAdIframe(key, width, height) {
      const iframe = document.createElement('iframe');
      iframe.style.width = width + 'px';
      iframe.style.height = height + 'px';
      iframe.style.maxWidth = '100%';
      iframe.style.border = '0';
      iframe.style.overflow = 'hidden';
      iframe.scrolling = 'no';

      const html = `<!DOCTYPE html><html><head><style>html,body{margin:0;padding:0;overflow:hidden;}</style></head><body>
<script type="text/javascript">
atOptions = {
  'key' : '${key}',
  'format' : 'iframe',
  'height' : ${height},
  'width' : ${width},
  'params' : {}
};
</script>
<script type="text/javascript" src="https://www.highperformanceformat.com/${key}/invoke.js"></script>
</body></html>`;

      iframe.srcdoc = html;
      return iframe;
    }

    ['ad-banner-mid'].forEach(id => {
      const container = document.getElementById(id);
      if (!container || container.dataset.loaded) return;
      container.dataset.loaded = 'true';
      container.appendChild(buildAdIframe('408f7fe8d5566eee24a05d83101d2638', 300, 250));
    });
  }, [video.id]);

  // ── নেটিভ ব্যানার অ্যাড (effectivecpmnetwork) — related videos-এর নিচে,
  // আগে এখানে দুইটা 300x250 highperformanceformat ব্যানার ছিল, সেগুলো
  // সরিয়ে এই একটা নেটিভ অ্যাড বসানো হলো ──
  useEffect(() => {
    const container = document.getElementById('native-banner-related');
    if (!container || container.dataset.loaded) return;
    container.dataset.loaded = 'true';

    const adDiv = document.createElement('div');
    adDiv.id = 'container-e474628fdcec06f52100e0b84b3fa759';

    const script = document.createElement('script');
    script.async = true;
    script.setAttribute('data-cfasync', 'false');
    script.src = 'https://pl30569233.effectivecpmnetwork.com/e474628fdcec06f52100e0b84b3fa759/invoke.js';

    container.appendChild(adDiv);
    container.appendChild(script);
  }, [video.id]);

  // ── JuicyAds Native Interstitial (Zone ID: 1123228): ভিডিও পেজে ঢোকার
  // ১ মিনিট পর প্রথমবার স্ক্রিপ্ট অ্যাক্টিভ হবে, তারপর প্রতি ২ মিনিট পর পর
  // আবার রিলোড হবে। মনে রাখবে: এই ফরম্যাটটা `data-targets="a"` অনুযায়ী
  // লিংকে ক্লিক করলে ট্রিগার হওয়ার জন্য বানানো, তাই স্ক্রিপ্ট "লোড" হওয়া
  // মানেই popup দেখা যাবে তা নাও হতে পারে — ইউজার এর ভিতরে কোনো লিংকে
  // ক্লিক করলেই এটা কার্যকর হবে। ──
  useEffect(() => {
    function loadJuicyNativeInterstitial() {
      const old = document.getElementById('juicyads-native-ads-script');
      if (old) old.remove();
      const script = document.createElement('script');
      script.id = 'juicyads-native-ads-script';
      script.type = 'text/javascript';
      script.setAttribute('data-id', 'juicyads-native-ads');
      script.setAttribute('data-ad-zone', '1123228');
      script.setAttribute('data-targets', 'a');
      script.src = 'https://js.juicyads.com/juicyads-native-ads.min.js';
      document.body.appendChild(script);
    }

    const firstTimer = setTimeout(() => {
      loadJuicyNativeInterstitial();
    }, 60000); // ১ মিনিট পর প্রথমবার

    let repeatInterval;
    const startRepeat = setTimeout(() => {
      repeatInterval = setInterval(loadJuicyNativeInterstitial, 120000); // এরপর প্রতি ২ মিনিটে
    }, 60000);

    return () => {
      clearTimeout(firstTimer);
      clearTimeout(startRepeat);
      if (repeatInterval) clearInterval(repeatInterval);
      const s = document.getElementById('juicyads-native-ads-script');
      if (s) s.remove();
    };
  }, [video.id]);

  function toggleLike() {
    const newLikes = { ...likes };
    if (newLikes[video.id]) { delete newLikes[video.id]; setLiked(false); }
    else { newLikes[video.id] = 1; setLiked(true); }
    setLikes(newLikes);
    localStorage.setItem('vhub_likes', JSON.stringify(newLikes));
  }

  function shareVideo() {
    const url = `${SITE_URL}/video/${video.slug}`;
    if (typeof navigator !== 'undefined' && navigator.share) {
      navigator.share({ title: video.title + ' | ViralLink BD', url });
    } else if (typeof navigator !== 'undefined' && navigator.clipboard) {
      navigator.clipboard.writeText(url).then(() => alert('লিংক কপি হয়েছে!'));
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
    "uploadDate": video.date || new Date().toISOString().split('T')[0],
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
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=DM+Sans:wght@300;400;500;600&display=swap" rel="stylesheet" />
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(videoSchema) }} />
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbSchema) }} />
        <style>{`
          :root{--bg:#0d0d0d;--surface:#181818;--surface2:#222;--accent:#ff3d3d;--text:#f5f5f5;--muted:#888;--border:#2a2a2a;--radius:10px;}
          *{margin:0;padding:0;box-sizing:border-box;}
          body{background:var(--bg);color:var(--text);font-family:'DM Sans',sans-serif;min-height:100vh;}
          header{background:#111;border-bottom:2px solid var(--accent);padding:0 4%;position:sticky;top:0;z-index:200;}
          .header-inner{max-width:1400px;margin:0 auto;display:flex;align-items:center;height:60px;gap:1rem;}
          .logo{font-family:'Bebas Neue',sans-serif;font-size:1.8rem;letter-spacing:2px;color:var(--text);text-decoration:none;}
          .logo span{color:var(--accent);}
          .main{max-width:1400px;margin:0 auto;padding:1rem 2%;}
          .back-btn{display:inline-flex;align-items:center;gap:0.5rem;color:var(--muted);background:var(--surface2);border:1px solid var(--border);border-radius:var(--radius);padding:0.4rem 1rem;cursor:pointer;font-family:inherit;font-size:0.85rem;margin-bottom:1rem;text-decoration:none;transition:all 0.2s;}
          .back-btn:hover{color:var(--text);border-color:var(--accent);}
          .player-layout{display:grid;grid-template-columns:1fr 320px;gap:1.5rem;}
          @media(max-width:768px){.player-layout{grid-template-columns:1fr;}.related-sidebar{display:none !important;}.related-mobile{display:block !important;}}
          .video-container{position:relative;padding-top:56.25%;background:#000;border-radius:var(--radius);overflow:hidden;margin-bottom:1rem;}
          .video-container video,.video-container iframe{position:absolute;inset:0;width:100%;height:100%;border:none;}
          .video-title-big{font-family:'Bebas Neue',sans-serif;font-size:1.5rem;letter-spacing:0.5px;margin-bottom:0.75rem;line-height:1.2;}
          .video-stats-row{display:flex;justify-content:space-between;align-items:center;color:var(--muted);font-size:0.82rem;margin-bottom:1rem;flex-wrap:wrap;gap:0.5rem;}
          .stats-left{display:flex;align-items:center;gap:0.35rem;color:var(--muted);}
          .stats-category{color:var(--muted);}
          .stats-date{color:var(--muted);}
          .stats-views{color:var(--muted);white-space:nowrap;}
          .video-actions{display:flex;gap:0.6rem;flex-wrap:nowrap;margin-bottom:1rem;padding-bottom:1rem;border-bottom:1px solid var(--border);overflow-x:auto;}
          .action-btn{display:flex;align-items:center;gap:0.35rem;padding:0.45rem 0.9rem;border-radius:var(--radius);border:1px solid var(--border);background:var(--surface2);color:var(--text);cursor:pointer;font-family:inherit;font-size:0.82rem;font-weight:600;transition:all 0.2s;text-decoration:none;white-space:nowrap;}
          .action-btn:hover{border-color:var(--accent);color:var(--accent);}
          .action-btn.liked{background:var(--accent);border-color:var(--accent);color:#fff;}
          .download-btn{background:#2563eb;border-color:#2563eb;color:#fff;}
          .download-btn:hover{background:#1d4ed8;border-color:#1d4ed8;color:#fff;}
          .share-btn{background:#16a34a;border-color:#16a34a;color:#fff;}
          .share-btn:hover{background:#15803d;border-color:#15803d;color:#fff;}
          .video-description{color:#ccc;font-size:0.9rem;line-height:1.7;margin-bottom:1rem;padding:0.75rem 1rem;background:var(--surface2);border-radius:var(--radius);border-left:3px solid var(--accent);}
          .related-section-title{font-family:'Bebas Neue',sans-serif;font-size:1.2rem;margin-bottom:1rem;letter-spacing:1px;}
          .related-list{display:grid;grid-template-columns:repeat(2,1fr);gap:2px;}
          @media(min-width:600px){.related-list{grid-template-columns:repeat(3,1fr);}}
          @media(min-width:1024px){.player-layout .related-sidebar .related-list{grid-template-columns:repeat(2,1fr);}}
          .related-card{background:var(--surface);overflow:hidden;cursor:pointer;transition:box-shadow 0.2s;border-bottom:1px solid var(--border);text-decoration:none;color:inherit;display:block;}
          .related-card:hover{box-shadow:0 4px 20px rgba(255,61,61,0.2);}
          .related-thumb{position:relative;width:100%;padding-top:56.25%;background:#000;overflow:hidden;}
          .related-thumb img{position:absolute;top:0;left:0;width:100%;height:100%;object-fit:cover;transition:transform 0.3s;}
          .related-card:hover .related-thumb img{transform:scale(1.03);}
          .related-info{padding:0.5rem 0.6rem;}
          .related-title-text{font-size:0.78rem;font-weight:600;display:-webkit-box;-webkit-line-clamp:1;-webkit-box-orient:vertical;overflow:hidden;line-height:1.3;margin-bottom:0.25rem;}
          .related-meta{font-size:0.7rem;color:var(--muted);}
          .breadcrumb{font-size:0.8rem;color:var(--muted);margin-bottom:1rem;}
          .breadcrumb a{color:var(--muted);text-decoration:none;}
          .breadcrumb a:hover{color:var(--accent);}
          .related-mobile{display:none;}
          .ad-banner-slot{display:flex;justify-content:center;margin:1rem 0;overflow:hidden;}
          .ad-banner-slot iframe{max-width:100%;}
          .iframe-click-gate{position:absolute;inset:0;width:100%;height:100%;cursor:pointer;background:#000;}
          .iframe-click-gate img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;opacity:0.75;}
          .iframe-click-gate .play-btn-icon{position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);width:64px;height:64px;border-radius:50%;background:rgba(255,61,61,0.9);display:flex;align-items:center;justify-content:center;color:#fff;font-size:24px;box-shadow:0 4px 16px rgba(0,0,0,0.5);}
          .video-overlay{position:absolute;inset:0;width:100%;height:100%;background:transparent;cursor:pointer;z-index:10;}
        `}</style>
      </Head>

      <header>
        <div className="header-inner">
          <a className="logo" href="/">ViralLink<span>BD</span></a>
        </div>
      </header>

      <div className="main">
        <a className="back-btn" href="/" onClick={handleBackClick}>← হোমে ফিরুন</a>

        <div className="breadcrumb">
          <a href="/">Home</a> › <a href={`/?cat=${video.categories[0]}`}>{video.categories.join(', ')}</a> › {video.title}
        </div>

        <div className="player-layout">
          <div className="player-main">
            <div className="video-container">
              {isDirectVideo ? (
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
                    src={thumbUrl(video.thumbnail, 640)}
                    alt={video.title}
                    onError={e => { e.target.src = video.thumbnail; }}
                  />
                  <div className="play-btn-icon">▶</div>
                </div>
              )}
              {showOverlay && (
                <div className="video-overlay" onClick={handleOverlayClick}></div>
              )}
            </div>

            <h1 className="video-title-big">{video.title}</h1>

            <div className="video-stats-row">
              <div className="stats-left">
                <span className="stats-category">{video.categories.join(', ')}</span>
                {video.date && <span className="stats-date">· {timeAgo(video.date) || video.date}</span>}
              </div>
              <span className="stats-views">👁 {formatNum(views[video.slug] || 0)} views</span>
            </div>

            {video.description && (
              <p className="video-description">{video.description}</p>
            )}

            <div className="video-actions">
              <button className="action-btn download-btn" onClick={handleDownloadClick}>⬇️ Download</button>
              <button className={`action-btn${liked ? ' liked' : ''}`} onClick={toggleLike}>
                ❤️ {formatNum(likes[video.id] || 0)} Like
              </button>
              <button className="action-btn share-btn" onClick={shareVideo}>🔗 Share</button>
            </div>

            {/* 300x250 Banner Ad - below player, above related */}
            <div style={{display:'flex',justifyContent:'center',margin:'1rem 0'}}>
              <div className="ad-banner-slot" id="ad-banner-mid"></div>
            </div>

            {/* Mobile related */}
            <div className="related-mobile">
              <div className="related-section-title">Related Videos</div>
              <div className="related-list">
                {related.length === 0 ? (
                  <p style={{ color: 'var(--muted)' }}>No related videos</p>
                ) : related.map(v => (
                  <a key={v.id} className="related-card" href={`/video/${v.slug}`} onClick={e => handleRelatedClick(e, v.slug)}>
                    <div className="related-thumb">
                      <img
                        src={thumbUrl(v.thumbnail, 320)}
                        alt={v.title}
                        loading="lazy"
                        onError={e => {
                          if (e.target.dataset.fallback !== 'original' && v.thumbnail) {
                            e.target.dataset.fallback = 'original';
                            e.target.src = v.thumbnail;
                          } else {
                            e.target.src = `https://picsum.photos/seed/${v.id}/320/180`;
                          }
                        }}
                      />
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

          {/* Desktop sidebar */}
          <div className="related-sidebar">
            <div className="related-section-title">Related Videos</div>
            <div className="related-list">
              {related.length === 0 ? (
                <p style={{ color: 'var(--muted)' }}>No related videos</p>
              ) : related.map(v => (
                <a key={v.id} className="related-card" href={`/video/${v.slug}`} onClick={e => handleRelatedClick(e, v.slug)}>
                  <div className="related-thumb">
                    <img
                      src={thumbUrl(v.thumbnail, 320)}
                      alt={v.title}
                      loading="lazy"
                      onError={e => {
                        if (e.target.dataset.fallback !== 'original' && v.thumbnail) {
                          e.target.dataset.fallback = 'original';
                          e.target.src = v.thumbnail;
                        } else {
                          e.target.src = `https://picsum.photos/seed/${v.id}/320/180`;
                        }
                      }}
                    />
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

        {/* Native Banner Ad - below related videos (effectivecpmnetwork) */}
        <div style={{display:'flex',justifyContent:'center',margin:'1rem 0'}} id="native-banner-related"></div>

      </div>
    </>
  );
            }
