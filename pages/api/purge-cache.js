// ── নতুন ভিডিও এড করার পর সাথে সাথে সবাইকে দেখানোর জন্য ──
// আগে sheet-rows ৫ মিনিটের জন্য cache হয়ে থাকত (lib/sheetData.js),
// তাই নতুন ভিডিও এড করলেও সর্বোচ্চ ৫ মিনিট আগের ডেটা দেখাচ্ছিল।
// Google Sheet-এ ভিডিও এড করার পর এই URL-টা ভিজিট করলে ওই cache সাথে
// সাথে মুছে যাবে — এরপর যেই ভিজিট করুক (আগে থেকে সাইটে থাকা ইউজারও
// পরের পেজে গেলে), নতুন ভিডিওসহ ফ্রেশ ডেটা দেখবে।
//
// ব্যবহার: https://yoursite.com/api/purge-cache?key=YOUR_SECRET_KEY
// SECRET বদলে নিজের একটা গোপন key বসান (নিচে PURGE_SECRET ভ্যারিয়েবলে)।
const PURGE_SECRET = 'change-this-secret-2026';
const CACHE_KEY_URL = 'https://internal-cache.virallink2.site/sheet-rows-v1';

export default async function handler(req, res) {
  if (req.query.key !== PURGE_SECRET) {
    return res.status(403).json({ error: 'Unauthorized — key ভুল বা মিসিং' });
  }
  try {
    const cache = caches.default;
    const deleted = await cache.delete(new Request(CACHE_KEY_URL));
    return res.status(200).json({ success: true, deleted });
  } catch (e) {
    return res.status(500).json({ error: String(e) });
  }
}
