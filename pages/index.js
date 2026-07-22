import React, { useState, useEffect } from "react";
import Head from "next/head";

const SHEET_ID = '1CJU7TtQAvLGwVIrFB4G6uIyDy0m0Uz54kB6ZBpar4zE';
const PER_PAGE = 30;

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

// ── থাম্বনেইল ফিক্স (আপডেট): wsrv.nl প্রক্সি একসাথে অনেক (৩০টা) রিকোয়েস্ট
// পেলে rate-limit/timeout করে ফেলছিল — এই কারণেই প্রথমবার পেজ লোডে থাম্বনেইল
// কালো দেখাচ্ছিল, আর রিলোড দিলে ঠিক হয়ে যাচ্ছিল (ততক্ষণে wsrv নিজে ক্যাশ
// করে ফেলত)। যেহেতু তোমার থাম্বনেইল মূলত postimg.cc-তে থাকে, আর postimg.cc
// নিজেই একটা ফাস্ট, hotlink-friendly CDN — postimg লিংকের জন্য প্রক্সি
// পুরোপুরি বাদ দিয়ে সরাসরি URL ব্যবহার করা হচ্ছে। অন্য কোনো সোর্স
// (picsum ইত্যাদি) হলে তখনই শুধু wsrv.nl ব্যবহার হবে। ──
function thumbUrl(url, width) {
  if (!url) return url;
  if (url.includes('postimg.cc')) return url;
  const clean = url.replace(/^https?:\/\//, '');
  return `https://wsrv.nl/?url=${encodeURIComponent(clean)}&w=${width}&q=75&output=webp`;
}

// একটা ভিডিও একাধিক ক্যাটাগরিতে থাকতে পারবে — Sheets-এ কমা (,) দিয়ে
// আলাদা করে লিখলেই (যেমন "General, Bangladeshi") ভিডিওটা দুই জায়গাতেই দেখাবে
function parseCategories(str) {
  const arr = (str || '').split(',').map(s => s.trim()).filter(Boolean);
  return arr.length ? arr : ['General'];
}

const SHEET_ID_SSR = '1CJU7TtQAvLGwVIrFB4G6uIyDy0m0Uz54kB6ZBpar4zE';

// ⚠️ [slug].js পেজে ব্যবহৃত একই Google Form Response Sheet, ভিউ কাউন্ট
// একই জায়গা থেকে পড়ার জন্য (যাতে হোমপেজ ও ভিডিও পেজে সংখ্যা মেলে)
const VIEW_RESPONSES_SHEET_ID = '1-y075MwICFApp4D6Ie-7FxDNVl-pkJHpQSiu396nQoI';

function slugifySSR(text) {
  return text.toString().toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^\w-]/g, '')
    .replace(/--+/g, '-')
    .replace(/^-+|-+$/g, '')
    .substring(0, 80);
}

// একই টাইটেল বারবার এলে slug-এর শেষে -2, -3 ... যোগ হবে, যাতে প্রতিটা
// ভিডিওর নিজস্ব আলাদা URL থাকে। sitemap.js আর [slug].js-এও এই একই
// লজিক ব্যবহার করা হয়েছে, তাই সব জায়গায় slug মিলে যাবে।
function getUniqueSlugs(rows, slugifyFn) {
  const counts = {};
  return rows.map(row => {
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

  // ── ফুলস্ক্রিন স্মার্টলিংক ওভারলে: পেজে ঢোকার ১৫ সেকেন্ড পর ওপেন হবে,
  // ৯ সেকেন্ড কাউন্টডাউন শেষে ক্রস (✕) বাটন আসবে, বন্ধ করা যাবে ──
  const SMARTLINK_URL_HOME = 'https://www.effectivecpmnetwork.com/uaq4j6p6s0?key=efcef79acf92e1461afbfa49071f2669';
  const [showSmartOverlay, setShowSmartOverlay] = useState(false);
  const [canCloseSmartOverlay, setCanCloseSmartOverlay] = useState(false);
  const [closeCountdown, setCloseCountdown] = useState(9);

  function closeSmartOverlay() {
    setShowSmartOverlay(false);
  }

  useEffect(() => {
    const openTimer = setTimeout(() => {
      setShowSmartOverlay(true);
      setCanCloseSmartOverlay(false);
      setCloseCountdown(9);

      const countdownInterval = setInterval(() => {
        setCloseCountdown(prev => {
          if (prev <= 1) {
            clearInterval(countdownInterval);
            setCanCloseSmartOverlay(true);
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    }, 15000);

    return () => clearTimeout(openTimer);
  }, []);

  useEffect(() => {
    // ── ভিউ কাউন্ট ডিসপ্লে সাময়িকভাবে বন্ধ করা হলো (২০২৬-০৭-২৩)। কোড ডিলিট করা
    // হয়নি, নিচের ব্লকটা comment করে রাখা হলো। আবার চালু করতে চাইলে শুধু
    // /* এবং */ এই দুইটা মার্কার সরিয়ে দিলেই আগের মতো কাজ করবে। ──
    /*
    // ── ভিউ কাউন্ট: [slug].js পেজের মতোই একই Response Sheet থেকে
    // সব ভিডিওর ভিউ (slug অনুযায়ী গোনা) নিয়ে আসা হচ্ছে, যাতে হোমপেজের
    // কার্ডেও ভিডিও পেজের সাথে মিলিয়ে সঠিক, common ভিউ সংখ্যা দেখায় ──
    fetch(`https://docs.google.com/spreadsheets/d/${VIEW_RESPONSES_SHEET_ID}/gviz/tq?tqx=out:json`)
      .then(res => res.text())
      .then(text => {
        const json = JSON.parse(text.substring(47, text.length - 2));
        const counts = {};
        json.table.rows.forEach(row => {
          const s = row.c[1]?.v; // কলাম B = slug
          if (s) counts[s] = (counts[s] || 0) + 1;
        });
        setViews(counts);
      })
      .catch(() => {});
    */
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
        <title>BD Viral Hub | বাংলাদেশের সেরা ভাইরাল ভিডিও ২০২৬</title>
        <meta name="description" content="BD Viral Hub - বাংলাদেশের সেরা ভাইরাল ভিডিও সাইট। আজকের নতুন ভাইরাল ভিডিও লিংক, TikTok ভাইরাল ক্লিপ, Facebook Reels ভাইরাল, ফানি ভিডিও বিনামূল্যে দেখুন।" />
        <meta name="keywords" content="tiktoker viral video, Bangladesh tiktoker viral video, tiktok viral video bangladesh, বাংলাদেশি ভাইরাল ভিডিও, facebook reels viral bd, funny video bangladesh" />
        <meta property="og:title" content="BD Viral Hub | বাংলাদেশের সেরা ভাইরাল ভিডিও ২০২৬" />
        <meta property="og:description" content="বাংলাদেশের সেরা ভাইরাল ভিডিও সাইট। TikTok ভাইরাল, Facebook Reels ভাইরাল, ফানি ভিডিও ফ্রিতে দেখুন।" />
        <meta property="og:url" content="https://virallink2.site/" />
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify({
          "@context":"https://schema.org","@type":"WebSite","name":"BD Viral Hub",
          "url":"https://virallink2.site","description":"বাংলাদেশের সেরা ভাইরাল ভিডিও সাইট",
          "potentialAction":{"@type":"SearchAction","target":"https://virallink2.site/search?q={search_term_string}","query-input":"required name=search_term_string"}
        })}} />
      </Head>

      <header>
        <div className="header-inner">
          <a className="logo" href="/">BD Viral<span>Hub</span></a>
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
                <a className="video-card" href={`/video/${v.slug}`}>
                  <div className="thumb-wrap">
                    <img
                      src={thumbUrl(v.thumbnail, 400)}
                      alt={`${v.title} - ভাইরাল ভিডিও বাংলাদেশ`}
                      loading={i < 6 ? 'eager' : 'lazy'}
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
                      {/* ভিউ কাউন্ট অপশন বন্ধ (২০২৬-০৭-২৩) — জায়গা বাঁচাতে হাইড করা হলো, কোড রাখা হলো কমেন্টে
                      <span>👁 {formatNum(views[v.slug] || 0)}</span> */}
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
              <h2>BD Viral Hub</h2>
              <p>বাংলাদেশের সেরা ভাইরাল ভিডিও প্ল্যাটফর্ম। প্রতিদিন নতুন TikTok ভাইরাল ক্লিপ, Facebook Reels ভাইরাল, ফানি ভিডিও বিনামূল্যে দেখুন।</p>
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
            <p>© 2026 BD Viral Hub | বাংলাদেশের সেরা ভাইরাল ভিডিও সাইট</p>
          </div>
        </div>
      </footer>

      {/* ফুলস্ক্রিন স্মার্টলিংক ওভারলে — পেজে ঢোকার ১৫ সেকেন্ড পর */}
      {showSmartOverlay && (
        <div className="smart-overlay">
          <iframe src={SMARTLINK_URL_HOME} title="ad" />
          {canCloseSmartOverlay ? (
            <div className="smart-overlay-close" onClick={closeSmartOverlay}>✕</div>
          ) : (
            <div className="smart-overlay-close smart-overlay-countdown">{closeCountdown}</div>
          )}
        </div>
      )}
    </>
  );
    }
