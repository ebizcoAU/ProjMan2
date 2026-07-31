// dashboard/src/app/layout.js — root layout: fonts + globals.
// Same three families as the Nexus portal so the ported components keep their look.
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
  title: 'ProjMan — Portal',
  description: 'ProjMan Portal — the app’s desktop companion: projects, cost plans, claims, invitations',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en-AU" className={`${syne.variable} ${dmSans.variable} ${jetbrains.variable}`}>
      <body>{children}</body>
    </html>
  );
}
