import type { MetadataRoute } from "next";

const BASE_URL = "https://plan.asiyst.com";

const AI_BOTS = [
  "GPTBot",
  "OAI-SearchBot",
  "ChatGPT-User",
  "ClaudeBot",
  "Claude-User",
  "Claude-SearchBot",
  "anthropic-ai",
  "Googlebot",
  "Google-Extended",
  "Bingbot",
  "PerplexityBot",
  "Perplexity-User",
  "Applebot",
  "Meta-ExternalAgent",
  "cohere-ai",
];

const DISALLOWED_PATHS = [
  "/api/",
  "/api$",
  "/account/",
  "/account$",
  "/checkout/",
  "/checkout$",
];

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: DISALLOWED_PATHS,
      },
      {
        userAgent: AI_BOTS,
        allow: "/",
        disallow: DISALLOWED_PATHS,
      },
    ],
    sitemap: `${BASE_URL}/sitemap.xml`,
  };
}
