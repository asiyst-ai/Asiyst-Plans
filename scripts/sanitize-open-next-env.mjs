import fs from "node:fs";
import path from "node:path";

/**
 * Post-build sanitizer for OpenNext Cloudflare (`scripts/sanitize-open-next-env.mjs`).
 *
 * `@opennextjs/cloudflare` compiles `.env.local` into `.open-next/cloudflare/next-env.mjs`
 * during `opennextjs-cloudflare build`. To guarantee that local `.env.local` server secrets
 * are never embedded in the generated Worker bundle (`.open-next/cloudflare/next-env.mjs`),
 * and that the Worker strictly reads server secrets from Cloudflare Worker runtime bindings
 * (`env` -> `process.env`), this script strips all non-`NEXT_PUBLIC_*` keys from `next-env.mjs`.
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
