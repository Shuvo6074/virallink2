import Head from 'next/head';
import Script from 'next/script';
import { Bebas_Neue, DM_Sans } from 'next/font/google';
import '../styles/globals.css';

// ── ফন্ট সেলফ-হোস্টিং (স্পিড ফিক্স) ──
// আগে fonts.googleapis.com থেকে <link> দিয়ে ফন্ট লোড হতো — ব্রাউজারকে
// প্রথমে ওই CSS ফাইলটা আনতে হতো, তারপর সেখান থেকে বলা আসল ফন্ট ফাইল
// (fonts.gstatic.com) আনতে হতো — মানে ২টা আলাদা ডোমেইনে রাউন্ড-ট্রিপ।
// এতে "আগে খালি টেক্সট, পরে আসল ডিজাইন (ফন্ট বদলে যাওয়া)" — এই
// পার্থক্যটা বেশি চোখে পড়ত।
// next/font বিল্ড টাইমেই ফন্ট ফাইল ডাউনলোড করে সাইটের নিজস্ব সার্ভার
// থেকে সার্ভ করে (Cloudflare-এর মাধ্যমে) — বাইরের কোনো ডোমেইনে যেতে হয়
// না, তাই ফন্ট দ্রুত আসে আর টেক্সট->ডিজাইন বদলের সময়টা অনেক কমে যায়।
const dmSans = DM_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600'], // ৩০০ (light) কোথাও ব্যবহার হয় না, বাদ দেওয়া হলো
  display: 'swap',
  variable: '--font-dm-sans',
});

const bebasNeue = Bebas_Neue({
  subsets: ['latin'],
  weight: '400',
  display: 'swap',
  variable: '--font-bebas',
});

function MyApp({ Component, pageProps }) {
  return (
    <div className={`${dmSans.variable} ${bebasNeue.variable}`}>
      <Head>
        <link rel="icon" href="/favicon.ico" />
        <link rel="icon" type="image/png" sizes="32x32" href="/favicon-32x32.png" />
        <link rel="icon" type="image/png" sizes="16x16" href="/favicon-16x16.png" />
        <link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png" />
        <link rel="manifest" href="/site.webmanifest" />
      </Head>

      <Script
        strategy="afterInteractive"
        src="https://www.googletagmanager.com/gtag/js?id=G-BF6FEVSLHZ"
      />
      <Script id="google-analytics" strategy="afterInteractive">
        {`
          window.dataLayer = window.dataLayer || [];
          function gtag(){dataLayer.push(arguments);}
          gtag('js', new Date());
          gtag('config', 'G-BF6FEVSLHZ');
        `}
      </Script>

      <Component {...pageProps} />
    </div>
  );
}

export default MyApp;
