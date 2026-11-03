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

const siteUrl = "https://projman.ebizco.com.au";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: "ProjMan | Project Management for Building & Construction",
    template: "%s | ProjMan",
  },
  description:
    "ProjMan is project management for building and construction, built on the 18-Stage Construction Lifecycle: site diaries, checklists, hold points and NCC checkpoints, documents, defects and inspections, with tamper-evident site records verified by more than one party.",
  keywords: [
    "construction project management software",
    "site diary software",
    "defects management construction",
    "construction scheduling software",
    "verifiable credentials construction",
    "construction workforce integrity",
    "project management for builders",
  ],
  openGraph: {
    title: "ProjMan | Project Management for Building & Construction",
    description:
      "Construction project management on the 18-Stage Lifecycle, with tamper-evident site records verified by more than one party.",
    url: siteUrl,
    siteName: "ProjMan",
    locale: "en_AU",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "ProjMan | Project Management for Building & Construction",
    description:
      "Site diaries, checklists, hold points, documents and defects: one platform, verified as it happens.",
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
