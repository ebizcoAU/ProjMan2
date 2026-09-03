import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { Nav } from "@/components/Nav";
import { Footer } from "@/components/Footer";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

const siteUrl = "https://www.projman.com.au";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: "ProjMan | Project Management for Building & Construction",
    template: "%s | ProjMan",
  },
  description:
    "ProjMan is a complete construction project management platform — site diaries, checklists, scheduling, documents, drawings, defects, RFIs, submittals, permits, safety & OHS, National Construction Code compliance, and an AI assistant — built on the 18-Stage Construction Lifecycle with multi-party verified, immutable on-site evidence.",
  keywords: [
    "construction project management software",
    "site diary software",
    "construction RFI and submittal management",
    "defects management construction",
    "construction scheduling software",
    "verifiable credentials construction",
    "RPL automation",
    "construction workforce integrity",
    "trade certification platform",
    "construction compliance software",
    "National Construction Code compliance software",
    "project management for builders",
    "skilled migrant employment platform",
  ],
  openGraph: {
    title: "ProjMan | Project Management for Building & Construction",
    description:
      "The complete construction project management platform — site diaries to permits — with the industry's only immutable, multi-party verified evidence trail built in.",
    url: siteUrl,
    siteName: "ProjMan",
    locale: "en_AU",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "ProjMan | Project Management for Building & Construction",
    description:
      "Site diaries, scheduling, documents, drawings, defects, RFIs, permits, safety & OHS and NCC compliance — one platform, verified as it happens.",
  },
  icons: {
    icon: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en-AU" className={inter.variable}>
      <body className="flex min-h-screen flex-col font-sans">
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-[100] focus:rounded-md focus:bg-orange-500 focus:px-4 focus:py-2 focus:text-white"
        >
          Skip to content
        </a>
        <Nav />
        <main id="main-content" className="flex-1">
          {children}
        </main>
        <Footer />
      </body>
    </html>
  );
}
