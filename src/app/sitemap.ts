import type { MetadataRoute } from "next";

const SITE = "https://plan.asiyst.com";
const LAST_MODIFIED = new Date("2026-11-27T00:00:00.000Z");

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    {
      url: SITE,
      lastModified: LAST_MODIFIED,
      changeFrequency: "weekly",
      priority: 1.0,
    },
    {
      url: `${SITE}/plans`,
      lastModified: LAST_MODIFIED,
      changeFrequency: "weekly",
      priority: 0.95,
    },
    {
      url: `${SITE}/offers`,
      lastModified: LAST_MODIFIED,
      changeFrequency: "weekly",
      priority: 0.9,
    },
    {
      url: `${SITE}/products`,
      lastModified: LAST_MODIFIED,
      changeFrequency: "monthly",
      priority: 0.85,
    },
    {
      url: `${SITE}/products/asiyst-ai`,
      lastModified: LAST_MODIFIED,
      changeFrequency: "monthly",
      priority: 0.9,
    },
    {
      url: `${SITE}/products/asiyst-ai/plans`,
      lastModified: LAST_MODIFIED,
      changeFrequency: "weekly",
      priority: 0.9,
    },
  ];
}
