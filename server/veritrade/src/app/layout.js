// Root layout: fonts + globals. Same three families as Portal/Dashboard so the
// design language reads as one product family even though VeriTrade's own colour
// and copy are deliberately distinct (a separate public product, not a page inside
// Portal — veritradedesignspecification.md, header).
import { Syne, DM_Sans, JetBrains_Mono } from 'next/font/google';
import './globals.css';

const syne = Syne({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700', '800'],
  variable: '--font-syne',
  display: 'swap',
});

const dmSans = DM_Sans({
  subsets: ['latin'],
  weight: ['300', '400', '500', '600'],
  variable: '--font-dm-sans',
  display: 'swap',
});

const jetbrains = JetBrains_Mono({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-jetbrains',
  display: 'swap',
});

export const metadata = {
  title: 'VeriTrade — Verified trade professionals',
  description: "Australia's B2B network for the trade industry, built on verified evidence, not reviews.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en-AU" className={`${syne.variable} ${dmSans.variable} ${jetbrains.variable}`}>
      <body>{children}</body>
    </html>
  );
}
