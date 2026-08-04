// ফাইলের পাথ: pages/api/video/[...path].js
//
// ব্যবহার: https://virallink2.site/api/video/videos/<slug>/master.m3u8
// এই URL হিট করলে এই কোড রিফারার চেক করে এবং R2 থেকে ভিডিও এনে দেবে —
// ব্রাউজারে আসল R2 লিংক প্রকাশ হবে না।

export default async function handler(req, res) {
  const pathSegments = req.query.path || [];
  const path = Array.isArray(pathSegments) ? pathSegments.join("/") : pathSegments;

  const R2_BASE = process.env.R2_PUBLIC_BASE_URL;

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
  const upstreamUrl = `${R2_BASE}/${path}`;
  const upstreamRes = await fetch(upstreamUrl);

  if (!upstreamRes.ok) {
    res.status(404).send("Not found");
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

  const buffer = Buffer.from(await upstreamRes.arrayBuffer());
  res.status(200).send(buffer);
}
