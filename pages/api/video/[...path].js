// ফাইলের পাথ: pages/api/video/[...path].js
//
// ব্যবহার: https://virallink2.site/api/video/videos/<slug>/master.m3u8
// এই URL হিট করলে এই কোড রিফারার চেক করে এবং R2 থেকে ভিডিও এনে দেবে —
// ব্রাউজারে আসল R2 লিংক প্রকাশ হবে না।

// ── env var পড়ার জন্য: সাধারণত process.env.R2_PUBLIC_BASE_URL কাজ করা
// উচিত (nodejs_compat flag চালু থাকলে Cloudflare এটা অটো পপুলেট করে),
// কিন্তু কিছু কিছু ডিপ্লয়মেন্টে এটা ফাঁকা আসে। তাই getCloudflareContext()
// দিয়ে সরাসরি Worker binding থেকেও একবার চেষ্টা করা হচ্ছে — যেটাতেই
// ভ্যালু পাওয়া যায় সেটাই ব্যবহার হবে। ──
async function getR2Base() {
  const fromProcessEnv = process.env.R2_PUBLIC_BASE_URL;
  if (fromProcessEnv) return fromProcessEnv.trim();

  try {
    const { getCloudflareContext } = await import("@opennextjs/cloudflare");
    const ctx = await getCloudflareContext({ async: true });
    const fromBinding = ctx?.env?.R2_PUBLIC_BASE_URL;
    if (fromBinding) return fromBinding.trim();
  } catch (e) {
    // getCloudflareContext লোকাল dev-এ বা edge না হলে fail করতে পারে, চুপচাপ ইগনোর
  }

  return null;
}

export default async function handler(req, res) {
  const pathSegments = req.query.path || [];
  const path = Array.isArray(pathSegments) ? pathSegments.join("/") : pathSegments;

  const R2_BASE = await getR2Base();

  if (!R2_BASE) {
    res.status(500).send("Server misconfigured");
    return;
  }

  // ---- Referer চেক (হটলিংক প্রোটেকশন) ----
  const referer = req.headers.referer || "";
  const allowedHosts = ["virallink2.site"]; // bd-viral-hub এর হোস্ট এখানে অ্যাড করতে পারেন

  let refererHost = null;
  try {
    refererHost = referer ? new URL(referer).hostname : null;
  } catch {
    refererHost = null;
  }

  const isAllowed =
    refererHost &&
    allowedHosts.some((h) => refererHost === h || refererHost.endsWith("." + h));

  if (!isAllowed) {
    res.status(403).send("Forbidden");
    return;
  }

  // ---- আসল R2 URL থেকে ফাইল আনা (সার্ভার-সাইড) ----
  // ব্রাউজার ভিডিওর মাঝখানে ক্লিক করে সিক (scrub/seek) করলে "Range" header
  // পাঠায় — সেটা R2-তে ফরওয়ার্ড না করলে প্রতিবার পুরো ফাইল আবার লোড করতে
  // হবে, স্লো হবে ও বড় ফাইলে Worker টাইমআউট/মেমোরি এরর হতে পারে। তাই
  // Range header যদি থাকে সেটা upstream fetch-এ পাঠানো হচ্ছে, এবং উত্তরে
  // 206 Partial Content + Content-Range ফিরিয়ে দেওয়া হচ্ছে।
  const upstreamUrl = `${R2_BASE}/${path}`;
  const rangeHeader = req.headers.range;
  const upstreamRes = await fetch(upstreamUrl, {
    headers: rangeHeader ? { Range: rangeHeader } : {},
  });

  if (!upstreamRes.ok && upstreamRes.status !== 206) {
    res.status(upstreamRes.status === 404 ? 404 : 502).send("Not found");
    return;
  }

  if (path.endsWith(".m3u8")) {
    res.setHeader("Content-Type", "application/vnd.apple.mpegurl");
  } else if (path.endsWith(".ts")) {
    res.setHeader("Content-Type", "video/mp2t");
  } else {
    res.setHeader(
      "Content-Type",
      upstreamRes.headers.get("content-type") || "application/octet-stream"
    );
  }
  res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
  res.setHeader("Accept-Ranges", "bytes");

  const contentRange = upstreamRes.headers.get("content-range");
  if (contentRange) res.setHeader("Content-Range", contentRange);

  const contentLength = upstreamRes.headers.get("content-length");
  if (contentLength) res.setHeader("Content-Length", contentLength);

  res.status(upstreamRes.status); // 200 (পুরো ফাইল) অথবা 206 (partial/seek)

  // ── পুরো ফাইল একসাথে মেমোরিতে না নিয়ে চাংক-বাই-চাংক স্ট্রিম করা হচ্ছে,
  // যাতে বড় ভিডিওতেও Worker মেমোরি/সময় সীমার মধ্যে থাকে। ──
  if (upstreamRes.body) {
    const reader = upstreamRes.body.getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        res.write(Buffer.from(value));
      }
    } finally {
      res.end();
    }
  } else {
    const buffer = Buffer.from(await upstreamRes.arrayBuffer());
    res.end(buffer);
  }
}
