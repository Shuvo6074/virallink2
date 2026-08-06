// ফাইলের পাথ: pages/api/video/[...path].js
//
// ব্যবহার: https://virallink2.site/api/video/videos/<slug>/master.m3u8
//
// ── বড় পরিবর্তন (আপডেট) ──
// আগে এই রুট R2 থেকে পুরো ফাইল টেনে এনে Worker দিয়ে chunk-by-chunk
// স্ট্রিম করে ইউজারকে পাঠাত। এতে দুইটা সমস্যা হচ্ছিল:
//   ১) বড় ভিডিও ফাইলে Cloudflare Worker-এর CPU/resource limit ক্রস হয়ে
//      "Error 1102: Worker exceeded resource limits" — পুরো সাইট ডাউন
//      দেখাচ্ছিল।
//   ২) ডাউনলোড মাঝপথে কেটে গিয়ে অসম্পূর্ণ/করাপ্ট ফাইল সেভ হচ্ছিল
//      (ব্রাউজারে "ভিডিও নাই" এমন একটা ছোট ফাইল হিসেবে দেখা যাচ্ছিল)।
//
// এখন সমাধান: Worker নিজে ফাইল টেনে আনে না। বরং R2-এর S3-compatible
// API দিয়ে একটা সাময়িক (short-lived) সাইনড URL বানিয়ে ব্রাউজারকে
// সরাসরি R2-তে 302 redirect করে দেয়। এতে:
//   - Worker-এর কাজ মাত্র কয়েক মিলিসেকেন্ডের (শুধু sign করা), তাই
//     resource limit ক্রস হওয়ার প্রশ্নই নেই।
//   - ব্রাউজার নিজে R2 থেকে সরাসরি ফুল-স্পিডে ডাউনলোড/স্ট্রিম করে,
//     কোনো মাঝপথে কাটাকাটি হয় না।
//   - লিংকটা মাত্র কিছুক্ষণ (নিচে EXPIRES_IN_SECONDS) ভ্যালিড থাকে,
//     তাই কেউ নেটওয়ার্ক ট্যাব থেকে কপি করলেও পরে সেটা কাজ করবে না —
//     হটলিংক/চুরি ঠেকানো যায়।
//   - Referer চেক আগের মতোই আছে — অন্য সাইট থেকে রিকোয়েস্ট এলে সাইনড
//     URL-ই জেনারেট হবে না।
//
// প্রয়োজনীয় env vars (Cloudflare Pages → Settings → Variables and secrets):
//   R2_ACCOUNT_ID        (Secret)
//   R2_ACCESS_KEY_ID     (Secret)
//   R2_SECRET_ACCESS_KEY (Secret)
//   R2_BUCKET_NAME       (Text)  — এখানে "v2-videos"

import { AwsClient } from "aws4fetch";

// সাইনড URL কতক্ষণ ভ্যালিড থাকবে (সেকেন্ডে)। ১২০ সেকেন্ড = ২ মিনিট —
// এতটুকু সময় স্ট্রিমিং/ডাউনলোড শুরু করার জন্য যথেষ্ট, কিন্তু লিংক কপি
// করে পরে ব্যবহার করার মতো দীর্ঘ না।
const EXPIRES_IN_SECONDS = 120;

async function getEnv(req) {
  // Cloudflare Pages Functions (via @opennextjs/cloudflare) রানটাইমে env
  // পাওয়ার সবচেয়ে রিলায়েবল উপায় getCloudflareContext — process.env
  // মাঝে মাঝে undefined আসে (আগের মন্তব্যেও এই সমস্যার কথা লেখা ছিল)।
  try {
    const { getCloudflareContext } = await import("@opennextjs/cloudflare");
    const ctx = await getCloudflareContext({ async: true });
    if (ctx?.env?.R2_ACCOUNT_ID) return ctx.env;
  } catch (e) {
    // লোকাল dev-এ বা edge না হলে fail করতে পারে, চুপচাপ ইগনোর
  }
  return process.env;
}

export default async function handler(req, res) {
  const pathSegments = req.query.path || [];
  const path = Array.isArray(pathSegments) ? pathSegments.join("/") : pathSegments;

  // ---- Referer চেক (হটলিংক প্রোটেকশন) — আগের মতোই ----
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

  const env = await getEnv(req);
  const accountId = env.R2_ACCOUNT_ID;
  const accessKeyId = env.R2_ACCESS_KEY_ID;
  const secretAccessKey = env.R2_SECRET_ACCESS_KEY;
  const bucketName = env.R2_BUCKET_NAME;

  if (!accountId || !accessKeyId || !secretAccessKey || !bucketName) {
    res.status(500).send("Server misconfigured");
    return;
  }

  try {
    const client = new AwsClient({
      accessKeyId,
      secretAccessKey,
      service: "s3",
      region: "auto",
    });

    // R2-এর S3 API এন্ডপয়েন্ট — বাকেটের নির্দিষ্ট অবজেক্টের জন্য
    const endpoint = `https://${accountId}.r2.cloudflarestorage.com/${bucketName}/${path}`;

    const url = new URL(endpoint);
    url.searchParams.set("X-Amz-Expires", String(EXPIRES_IN_SECONDS));

    // aws4fetch দিয়ে presigned URL বানানো (query-string sign করা GET রিকোয়েস্ট)
    const signedRequest = await client.sign(
      new Request(url.toString(), { method: "GET" }),
      { aws: { signQuery: true } }
    );

    const signedUrl = signedRequest.url;

    // ---- ব্রাউজারকে সরাসরি R2-এর সাইনড URL-এ পাঠিয়ে দেওয়া হচ্ছে ----
    // 302 (temporary redirect) — Worker নিজে ফাইল টাচ করছে না, তাই
    // resource limit ক্রস হওয়ার সুযোগ নেই।
    res.setHeader("Cache-Control", "private, no-store"); // সাইনড URL কখনো cache হওয়া উচিত না
    res.writeHead(302, { Location: signedUrl });
    res.end();
  } catch (err) {
    res.status(502).send("Failed to generate video link");
  }
}
