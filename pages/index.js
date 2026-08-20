import React, { useState, useEffect } from "react";
import Head from "next/head";

const SHEET_ID = '1CJU7TtQAvLGwVIrFB4G6uIyDy0m0Uz54kB6ZBpar4zE';
const PER_PAGE = 30;

// ── ভিডিও কার্ডে ক্লিক করলেই এই SmartLink নতুন ট্যাবে খুলবে (প্রতি ক্লিকেই,
// কোনো frequency cap ছাড়া) — লিংক বদলাতে হলে শুধু এই ভ্যারিয়েবলটা বদলালেই হবে ──
const SMARTLINK_URL = 'https://www.effectivecpmnetwork.com/c2sf8tayk?key=984425aa15cb3a2477cbdb8098fbf9ff';

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

// ── থাম্বনেইল ফিক্স (আপডেট ৩): আগের সেটিং (w=300, q=72) সাইজে খুব ছোট
// হয়ে যাচ্ছিল, তাই মোবাইলের হাই-রেজোলিউশন স্ক্রিনে ঝাপসা/লো-কোয়ালিটি
// দেখাচ্ছিল। width আর quality বাড়িয়ে HD-এর কাছাকাছি আনা হলো, তাও
// original raw ছবির চেয়ে এখনো অনেক হালকা (webp + compress আছে)। ──
function thumbUrl(url, width) {
  if (!url) return url;
  const clean = url.replace(/^https?:\/\//, '');
  return `https://wsrv.nl/?url=${encodeURIComponent(clean)}&w=${width}&q=85&output=webp&n=-1`;
}

// একটা ভিডিও একাধিক ক্যাটাগরিতে থাকতে পারবে — Sheets-এ কমা (,) দিয়ে
// আলাদা করে লিখলেই (যেমন "General, Bangladeshi") ভিডিওটা দুই জায়গাতেই দেখাবে
function parseCategories(str) {
  const arr = (str || '').split(',').map(s => s.trim()).filter(Boolean);
  return arr.length ? arr : ['General'];
}

const SHEET_ID_SSR = '1CJU7TtQAvLGwVIrFB4G6uIyDy0m0Uz54kB6ZBpar4zE';

function slugifySSR(text) {
  return text.toString().toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^\w\u0980-\u09FF-]/g, '')
    .replace(/--+/g, '-')
    .replace(/^-+|-+$/g, '')
    .substring(0, 80);
}

// একই টাইটেল বারবার এলে slug-এর শেষে -2, -3 ... যোগ হবে, যাতে প্রতিটা
// ভিডিওর নিজস্ব আলাদা URL থাকে। sitemap.js আর [slug].js-এও এই একই
// লজিক ব্যবহার করা হয়েছে, তাই সব জায়গায় slug মিলে যাবে।
//
// ── SLUG ফ্রিজ ফিক্স: Sheet-এর কলাম I (index 8)-তে slug বসানো থাকলে
// সেটাই ব্যবহার হবে (Title বদলালেও URL অক্ষত থাকে)। কলাম I খালি থাকলে
// আগের মতোই Title থেকে auto-generate হবে। ──
function getUniqueSlugs(rows, slugifyFn) {
  const counts = {};
  return rows.map(row => {
    const frozen = (row.c[8]?.v || '').toString().trim();
    if (frozen) return frozen;
    const base = slugifyFn(row.c[0]?.v || 'video');
    counts[base] = (counts[base] || 0) + 1;
    return counts[base] > 1 ? `${base}-${counts[base]}` : base;
  });
}

export async function getServerSideProps({ res: httpRes }) {
  // ── পারফরম্যান্স ফিক্স: পেজটা Vercel-এর Edge-এ ৬০ সেকেন্ডের জন্য cache
  // হবে। এই সময়ের মধ্যে আসা সব ভিজিটর সরাসরি cached, দ্রুত পেজ পাবে —
  // প্রতিবার নতুন করে Google Sheets fetch করতে হবে না। ডেটা বদলালে
  // (নতুন ভিডিও যোগ হলে) সর্বোচ্চ ৬০ সেকেন্ড দেরিতে দেখাবে, এটা নিয়ে
  // চিন্তার কিছু নেই — বাকি সব লজিক আগের মতোই অপরিবর্তিত। ──
  httpRes.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=300');

  try {
    const res = await fetch(`https://docs.google.com/spreadsheets/d/${SHEET_ID_SSR}/gviz/tq?tqx=out:json`);
    const text = await res.text();
    const json = JSON.parse(text.substring(47, text.length - 2));
    const rows = json.table.rows;
    const uniqueSlugs = getUniqueSlugs(rows, slugifySSR);
    const initialVideos = rows.map((row, i) => ({
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
    return { props: { initialVideos } };
  } catch(e) {
    return { props: { initialVideos: [] } };
  }
}

export default function Home({ initialVideos }) {
  const [allVideos, setAllVideos]   = useState(initialVideos);
  const [filtered, setFiltered]     = useState(initialVideos);
  const [currentPage, setCurrentPage] = useState(1);
  const [searchQ, setSearchQ]       = useState('');
  const [activeCat, setActiveCat]   = useState('all');
  const [cats, setCats]             = useState([...new Set(initialVideos.flatMap(v => v.categories))]);
  const [loading, setLoading]       = useState(false);
  const [error, setError]           = useState('');
  const [views, setViews]           = useState({});

  useEffect(() => {
    // ── ভিউ কাউন্ট (নতুন সিস্টেম): এখন Google Sheets-এর বদলে Cloudflare D1
    // database থেকে সব ভিডিওর ভিউ কাউন্ট একসাথে fetch করা হচ্ছে ──
    fetch('/api/get-views')
      .then(res => res.json())
      .then(counts => setViews(counts))
      .catch(() => {});
  }, []);

  // ── পপআন্ডার এড ইনজেক্ট (আগে এখানে স্মার্টলিংক ছিল, সরিয়ে এইটা বসানো হলো) ──
  useEffect(() => {
    if (document.getElementById('popunder-script-e11add4186ad924a2c35518025bbb7c2')) return;
    const script = document.createElement('script');
    script.id = 'popunder-script-e11add4186ad924a2c35518025bbb7c2';
    script.src = 'https://pl29731380.effectivecpmnetwork.com/e1/1a/dd/e11add4186ad924a2c35518025bbb7c2.js';
    script.async = true;
    document.body.appendChild(script);
  }, []);

  // ── JuicyAds Native Interstitial (Zone ID: 1123228): হোমপেজে ঢোকার
  // ১৫ সেকেন্ড পর প্রথমবার স্ক্রিপ্ট অ্যাক্টিভ হবে, তারপর প্রতি ২ মিনিট পর পর
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
    }, 15000); // ১৫ সেকেন্ড পর প্রথমবার

    let repeatInterval;
    const startRepeat = setTimeout(() => {
      repeatInterval = setInterval(loadJuicyNativeInterstitial, 120000); // এরপর প্রতি ২ মিনিটে
    }, 15000);

    return () => {
      clearTimeout(firstTimer);
      clearTimeout(startRepeat);
      if (repeatInterval) clearInterval(repeatInterval);
      const s = document.getElementById('juicyads-native-ads-script');
      if (s) s.remove();
    };
  }, []);

  // ── highperformanceformat.com banner ads inject ──
  useEffect(() => {
    const container = document.getElementById('ad-bottom-container');
    if (!container || container.dataset.loaded) return;
    container.dataset.loaded = 'true';

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
atOptions = {'key':'${key}','format':'iframe','height':${height},'width':${width},'params':{}};
</script>
<script type="text/javascript" src="https://www.highperformanceformat.com/${key}/invoke.js"></script>
</body></html>`;
      iframe.srcdoc = html;
      return iframe;
    }

    const bannerWrap = document.createElement('div');
    bannerWrap.style.cssText = 'display:flex;justify-content:center;margin:1rem 0;';
    bannerWrap.appendChild(buildAdIframe('5adf6dca592b0a84d1333f77bd5c167c', 728, 90));
    container.appendChild(bannerWrap);

    const gridWrap = document.createElement('div');
    gridWrap.style.cssText = 'display:flex;flex-wrap:wrap;justify-content:center;gap:1rem;margin:1rem 0;';
    const cell = document.createElement('div');
    cell.style.cssText = 'width:300px;height:250px;';
    cell.appendChild(buildAdIframe('408f7fe8d5566eee24a05d83101d2638', 300, 250));
    gridWrap.appendChild(cell);
    container.appendChild(gridWrap);
  }, [loading]);

  async function loadVideos() {
    try {
      const res  = await fetch(`https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:json`);
      const text = await res.text();
      const json = JSON.parse(text.substring(47, text.length - 2));
      const rows = json.table.rows;
      const uniqueSlugs = getUniqueSlugs(rows, slugify);
      const videos = rows.map((row, i) => ({
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

      setCats([...new Set(videos.flatMap(v => v.categories))]);
      setAllVideos(videos);
      setFiltered(videos);
      setLoading(false);
    } catch(e) {
      setError(e.message);
      setLoading(false);
    }
  }

  function filterCat(cat) {
    setActiveCat(cat);
    setCurrentPage(1);
    const q = searchQ.toLowerCase();
    setFiltered(allVideos.filter(v =>
      (cat === 'all' || v.categories.includes(cat)) &&
      (!q || v.title.toLowerCase().includes(q))
    ));
  }

  function handleSearch(q) {
    setSearchQ(q);
    setCurrentPage(1);
    setFiltered(allVideos.filter(v =>
      (activeCat === 'all' || v.categories.includes(activeCat)) &&
      (!q || v.title.toLowerCase().includes(q.toLowerCase()))
    ));
  }

  const totalPages = Math.ceil(filtered.length / PER_PAGE);
  const paginated  = filtered.slice((currentPage - 1) * PER_PAGE, currentPage * PER_PAGE);

  return (
    <>
      <Head>
        <title>ViralLink BD | আজকের ভাইরাল ভিডিও বাংলাদেশ ২০২৬</title>
        <meta name="description" content="ViralLink BD - বাংলাদেশের ভাইরাল ভিডিও নেটওয়ার্ক। প্রতিদিনের ট্রেন্ডিং TikTok ক্লিপ, Facebook Reels, ফানি ভিডিও এক জায়গায় দেখুন।" />
        <meta name="keywords" content="tiktoker viral video, Bangladesh tiktoker viral video, tiktok viral video bangladesh, বাংলাদেশি ভাইরাল ভিডিও, facebook reels viral bd, funny video bangladesh" />
        <meta property="og:title" content="ViralLink BD | আজকের ভাইরাল ভিডিও বাংলাদেশ ২০২৬" />
        <meta property="og:description" content="বাংলাদেশের ভাইরাল ভিডিও নেটওয়ার্ক। ট্রেন্ডিং TikTok ক্লিপ, Facebook Reels, ফানি ভিডিও ফ্রিতে দেখুন।" />
        <meta property="og:site_name" content="ViralLink BD" />
        <meta property="og:url" content="https://virallink2.site/" />
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify({
          "@context":"https://schema.org","@type":"WebSite","name":"ViralLink BD",
          "url":"https://virallink2.site","description":"বাংলাদেশের ভাইরাল ভিডিও নেটওয়ার্ক",
          "potentialAction":{"@type":"SearchAction","target":"https://virallink2.site/search?q={search_term_string}","query-input":"required name=search_term_string"}
        })}} />
      </Head>

      <header>
        <div className="header-inner">
          <a className="logo" href="/">ViralLink<span>BD</span></a>
          <div className="search-bar">
            <input type="text" placeholder="ভিডিও খুঁজুন..." value={searchQ} onChange={e => handleSearch(e.target.value)} />
            <button>🔍</button>
          </div>
        </div>
      </header>

      <div className="cat-tabs">
        <span className={`cat-tab${activeCat === 'all' ? ' active' : ''}`} onClick={() => filterCat('all')}>🎬 All</span>
        {cats.map(cat => (
          <span key={cat} className={`cat-tab${activeCat === cat ? ' active' : ''}`} onClick={() => filterCat(cat)}>📁 {cat}</span>
        ))}
      </div>

      <div className="main">
        <div className="section-title">{activeCat === 'all' ? 'Latest Videos' : activeCat}</div>

        {loading && <div className="loading"><div className="spinner"></div><p>Loading videos...</p></div>}
        {error   && <div className="empty">❌ Could not load videos.<br /><small>{error}</small></div>}

        {!loading && !error && (
          <div className="video-grid">
            {paginated.length === 0 ? (
              <div className="empty">🎬 No videos found.</div>
            ) : paginated.map((v, i) => (
              <React.Fragment key={v.id}>
                <a
                  className="video-card"
                  href={`/video/${v.slug}`}
                  onClick={(e) => {
                    // ── ফিক্স (popup blocker সমস্যা সমাধান): আগে window.open('')
                    // দিয়ে খালি ট্যাব "reserve" করা হচ্ছে — এটা ক্লিক ইভেন্টের
                    // একদম শুরুতেই synchronously কল হয়, তাই ব্রাউজার এটাকে
                    // trusted user-gesture হিসেবে ধরে এবং ব্লক করার সম্ভাবনা
                    // সবচেয়ে কম থাকে। win রেফারেন্স আসলেই খুলেছে কিনা (null
                    // নয়, popup blocker কর্তৃক বাতিল হয়নি) সেটা চেক করে তবেই
                    // SmartLink-এ redirect করা হচ্ছে — popup ব্লক হলে (কিছু
                    // মোবাইল ব্রাউজার/in-app webview-তে এটা browser-নিয়ন্ত্রিত,
                    // ১০০% এড়ানো সম্ভব না) সরাসরি ভিডিও পেজে পাঠিয়ে দেওয়া হচ্ছে,
                    // যাতে ইউজার কখনোই আটকে না যায় বা কোথাও না গিয়ে থেমে না যায়। ──
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
                        // ── প্রক্সি ফেইল করলে আগে original থাম্বনেইল ট্রাই, তারপর picsum ফলব্যাক ──
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
                      <span>👁 {formatNum(views[v.slug] || 0)}</span>
                      {v.date && <span> · {timeAgo(v.date) || v.date}</span>}
                    </div>
                  </div>
                </a>
                {(i + 1) % 15 === 0 && (
                  <div
                    style={{gridColumn:'1/-1',margin:'1.5rem 0',padding:'0.5rem 0',borderTop:'1px solid var(--border)',borderBottom:'1px solid var(--border)',display:'flex',justifyContent:'center',minHeight:'100px'}}
                    ref={el => {
                      if (!el || el.dataset.loaded) return;
                      el.dataset.loaded = 'true';
                      const containerId = `container-60b2b8f15d0710a277749b5a0ab2cbeb`;
                      const d = document.createElement('div');
                      d.id = containerId;
                      el.appendChild(d);
                      const s = document.createElement('script');
                      s.async = true;
                      s.setAttribute('data-cfasync', 'false');
                      s.src = 'https://pl29894049.effectivecpmnetwork.com/60b2b8f15d0710a277749b5a0ab2cbeb/invoke.js';
                      el.appendChild(s);
                    }}
                  ></div>
                )}
              </React.Fragment>
            ))}
          </div>
        )}

        {totalPages > 1 && (
          <div className="pagination">
            <button className="page-btn" onClick={() => setCurrentPage(p => p - 1)} disabled={currentPage === 1}>← Prev</button>
            {Array.from({ length: totalPages }, (_, i) => i + 1).map(i => {
              if (i === 1 || i === totalPages || Math.abs(i - currentPage) <= 1)
                return <button key={i} className={`page-btn${i === currentPage ? ' active' : ''}`} onClick={() => { setCurrentPage(i); window.scrollTo(0,0); }}>{i}</button>;
              else if (Math.abs(i - currentPage) === 2)
                return <span key={i} className="page-info">...</span>;
              return null;
            })}
            <button className="page-btn" onClick={() => setCurrentPage(p => p + 1)} disabled={currentPage === totalPages}>Next →</button>
          </div>
        )}

        <div id="ad-bottom-container"></div>

        {/* ── SEO: হিডেন লিংক ব্লক ──
             পেজিনেশন client-side state দিয়ে চলে বলে সার্ভার-রেন্ডারড HTML-এ
             শুধু বর্তমান পেজের ভিডিও লিংকই থাকে। Googlebot যাতে হোমপেজ থেকেই
             সব ভিডিওর লিংক খুঁজে পায় (sitemap ছাড়াও), তাই সব ভিডিওর <a href>
             এখানে রাখা হলো — ভিজুয়ালি hidden কিন্তু HTML-এ উপস্থিত, তাই crawlable। */}
        <div style={{ position: 'absolute', width: '1px', height: '1px', overflow: 'hidden', clip: 'rect(0,0,0,0)', whiteSpace: 'nowrap' }} aria-hidden="true">
          {initialVideos.map(v => (
            <a key={`seo-link-${v.id}`} href={`/video/${v.slug}`}>{v.title}</a>
          ))}
        </div>
      </div>

      <footer>
        <div className="footer-inner">
          <div className="footer-grid">
            <div>
              <h2>ViralLink BD</h2>
              <p>বাংলাদেশের ভাইরাল ভিডিও নেটওয়ার্ক। প্রতিদিন নতুন TikTok ক্লিপ, Facebook Reels, ফানি ভিডিও বিনামূল্যে দেখুন।</p>
            </div>
            <div>
              <h3>ভিডিও ক্যাটাগরি</h3>
              <ul>
                <li>🎬 ভাইরাল ভিডিও বাংলাদেশ</li>
                <li>📱 TikTok ভাইরাল ক্লিপ ২০২৬</li>
                <li>😂 ফানি ভিডিও বাংলাদেশ</li>
                <li>🆕 আজকের নতুন ভাইরাল ভিডিও</li>
                <li>📘 Facebook Reels ভাইরাল BD</li>
              </ul>
            </div>
            <div>
              <h3>জনপ্রিয় সার্চ</h3>
              <ul>
                <li><a href="/search?q=tiktok+viral">🔥 TikTok Viral BD 2026</a></li>
                <li><a href="/search?q=funny+video">😂 Funny Video Bangladesh</a></li>
                <li><a href="/search?q=facebook+reels">📘 Facebook Reels Viral BD</a></li>
                <li><a href="/search?q=new+viral">🆕 New Viral Video Today BD</a></li>
              </ul>
            </div>
          </div>
          <div className="footer-bottom">
            <p>© 2026 ViralLink BD | বাংলাদেশের ভাইরাল ভিডিও নেটওয়ার্ক</p>
          </div>
        </div>
      </footer>
    </>
  );
    }
