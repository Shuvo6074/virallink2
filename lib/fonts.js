 import { Bebas_Neue, DM_Sans } from 'next/font/google';

// ── শেয়ার্ড ফন্ট লোডার: _app.js আর _document.js দুই জায়গাতেই এখান
// থেকে ইমপোর্ট হবে, যাতে একই ফন্ট ইনস্ট্যান্স দুই জায়গায় ব্যবহার হয় ──
export const dmSans = DM_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  display: 'swap',
  variable: '--font-dm-sans',
});

export const bebasNeue = Bebas_Neue({
  subsets: ['latin'],
  weight: '400',
  display: 'swap',
  variable: '--font-bebas',
});
