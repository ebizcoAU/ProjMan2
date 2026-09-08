import type { MetadataRoute } from "next";

const siteUrl = "https://projman.ebizco.com.au";

const routes = [
  "",
  "/features",
  "/solutions",
  "/how-it-works",
  "/veritrade",
  "/pricing",
  "/about",
  "/resources",
  "/contact",
  "/legal/privacy",
  "/legal/terms",
  "/legal/security",
];

export default function sitemap(): MetadataRoute.Sitemap {
  return routes.map((route) => ({
    url: `${siteUrl}${route}`,
    lastModified: new Date(),
    changeFrequency: route === "" ? "weekly" : "monthly",
    priority: route === "" ? 1 : 0.7,
  }));
}
