// ফাইলের পাথ: pages/api/video/[...path].js
//
// আপনার রিপোতে ইতিমধ্যে "pages/api" ফোল্ডার আছে —
// তার ভেতরে "video" নামে নতুন ফোল্ডার বানিয়ে, তার ভেতরে
// "[...path].js" নামে এই ফাইলটা বসান।
//
// ফলাফল: https://virallink2.site/api/video/videos/<slug>/master.m3u8
// এই URL হিট করলে এই কোড চলবে এবং R2 থেকে ভিডিও এনে দেবে —
// ব্রাউজারে আসল R2 লিংক কখনো দেখাবে না।

export const config = {
  runtime: "edge",
};

export default async function handler(request) {
  const url = new URL(request.url);

  // /api/video/ এর পরের অংশটা বের করা, যেমন: videos/my-slug/master.m3u8
  const path = url.pathname.replace(/^\/api\/video\//, "");

  const R2_BASE = process.env.R2_PUBLIC_BASE_URL;

  if (!R2_BASE) {
    return new Response("Server misconfigured", { status: 500 });
  }

  // ---- Referer চেক (হটলিংক প্রোটেকশন) ----
  const referer = request.headers.get("referer") || "";
  const allowedHosts = ["virallink2.site"]; // bd-viral-hub এর ডোমেইন পরে এখানে যোগ করবেন

  const refererHost = (() => {
    try {
      return new URL(referer).hostname;
    } catch {
      return null;
    }
  })();

  const isAllowed =
    refererHost &&
    allowedHosts.some(
      (h) => refererHost === h || refererHost.endsWith("." + h)
    );

  if (!isAllowed) {
    return new Response("Forbidden", { status: 403 });
  }

  // ---- আসল R2 URL থেকে ফাইল আনা (সার্ভার-সাইড) ----
  const upstreamUrl = `${R2_BASE}/${path}`;
  const upstreamRes = await fetch(upstreamUrl);

  if (!upstreamRes.ok) {
    return new Response("Not found", { status: 404 });
  }

  const headers = new Headers();
  headers.set("Cache-Control", "public, max-age=31536000, immutable");

  if (path.endsWith(".m3u8")) {
    headers.set("Content-Type", "application/vnd.apple.mpegurl");
  } else if (path.endsWith(".ts")) {
    headers.set("Content-Type", "video/mp2t");
  } else {
    headers.set(
      "Content-Type",
      upstreamRes.headers.get("content-type") || "application/octet-stream"
    );
  }

  return new Response(upstreamRes.body, { headers, status: 200 });
      }
