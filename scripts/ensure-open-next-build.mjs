import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

/**
 * Ensures `.open-next/worker.js` and `.open-next/assets` exist before `wrangler deploy`
 * or `wrangler dev` runs.
 *
 * When Cloudflare Workers Builds (CI) executes `npx wrangler deploy`:
 * - If `opennextjs-cloudflare build` already ran in the CI Build step (or via `opennextjs-cloudflare deploy`),
 *   `.open-next/worker.js` and `.open-next/assets` already exist -> this script skips rebuilding.
 * - If Cloudflare Workers Builds ran `next build` or skipped the OpenNext build step and went straight to
 *   `npx wrangler deploy`, this script automatically runs `npx opennextjs-cloudflare build` and
 *   `node scripts/sanitize-open-next-env.mjs` so `.open-next/assets` and `.open-next/worker.js` are present.
 */

const rootDir = process.cwd();
const workerJsPath = path.join(rootDir, ".open-next", "worker.js");
const assetsDirPath = path.join(rootDir, ".open-next", "assets");

if (
  process.env.OPEN_NEXT_DEPLOY === "true" ||
  (fs.existsSync(workerJsPath) && fs.existsSync(assetsDirPath))
) {
  // Ensure static assets cache is populated and next-env.mjs is sanitized
  execSync("node scripts/sanitize-open-next-env.mjs", { stdio: "inherit" });
  process.exit(0);
}

console.log(
  "⚙️ .open-next build output not found; running OpenNext Cloudflare build...",
);
execSync("npx opennextjs-cloudflare build", { stdio: "inherit" });
execSync("node scripts/sanitize-open-next-env.mjs", { stdio: "inherit" });
