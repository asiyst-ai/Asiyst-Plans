import fs from "node:fs";
import path from "node:path";

/**
 * Post-build sanitizer & static assets cache populator for OpenNext Cloudflare
 * (`scripts/sanitize-open-next-env.mjs`).
 *
 * 1. Strips non-`NEXT_PUBLIC_*` server secrets from `.open-next/cloudflare/next-env.mjs`
 *    so that server secrets are read strictly from Cloudflare Worker runtime bindings.
 * 2. Copies `.open-next/cache` into `.open-next/assets/cdn-cgi/_next_cache` so that
 *    `StaticAssetsIncrementalCache` works even when Cloudflare Workers Builds runs
 *    `npx wrangler deploy` directly after `npm run build`.
 */

const nextEnvPath = path.join(
  process.cwd(),
  ".open-next",
  "cloudflare",
  "next-env.mjs",
);

const ALLOWED_NON_SECRET_KEYS = new Set([
  "ASIYST_ENVIRONMENT",
  "ASIIYST_API_BASE_URL",
  "SUPABASE_URL",
  "SUPABASE_ANON_KEY",
  "EMAIL_PROVIDER",
  "RESEND_FROM_EMAIL",
  "RESEND_REPLY_TO",
]);

function isAllowedBuildKey(key) {
  return key.startsWith("NEXT_PUBLIC_") || ALLOWED_NON_SECRET_KEYS.has(key);
}

if (fs.existsSync(nextEnvPath)) {
  const raw = fs.readFileSync(nextEnvPath, "utf8");
  const sanitized = raw.replace(
    /export const (production|development|test) = (\{.*?\});/g,
    (_full, mode, jsonStr) => {
      try {
        const parsed = JSON.parse(jsonStr);
        const filtered = {};
        for (const [k, v] of Object.entries(parsed)) {
          if (isAllowedBuildKey(k)) {
            filtered[k] = v;
          }
        }
        return `export const ${mode} = ${JSON.stringify(filtered)};`;
      } catch {
        return `export const ${mode} = {};`;
      }
    },
  );
  fs.writeFileSync(nextEnvPath, sanitized, "utf8");
  console.log(
    "🔒 Sanitized .open-next/cloudflare/next-env.mjs (server secrets stripped; runtime bindings enforced).",
  );
}

const cacheSourceDir = path.join(process.cwd(), ".open-next", "cache");
const cacheTargetDir = path.join(
  process.cwd(),
  ".open-next",
  "assets",
  "cdn-cgi",
  "_next_cache",
);

if (fs.existsSync(cacheSourceDir)) {
  fs.cpSync(cacheSourceDir, cacheTargetDir, { recursive: true });
  console.log(
    "📦 Populated .open-next/assets/cdn-cgi/_next_cache for StaticAssetsIncrementalCache.",
  );
}

