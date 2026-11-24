import { execSync } from "node:child_process";

/**
 * Ensures `.open-next/worker.js` and `.open-next/assets` are freshly built
 * from the current commit before `wrangler deploy` or `wrangler dev` runs.
 *
 * - When invoked via `opennextjs-cloudflare deploy` (`OPEN_NEXT_DEPLOY === "true"`),
 *   `npm run build:cf` has just completed in the same command chain, so we only
 *   ensure `next-env.mjs` sanitization and static cache population.
 * - When invoked directly via `npx wrangler deploy` (such as Cloudflare Workers Builds CI,
 *   which may restore stale `.open-next` artifacts from its build output cache), we ALWAYS
 *   run a clean `opennextjs-cloudflare build` so stale cached artifacts can never overwrite
 *   the current production Worker.
 */

if (process.env.OPEN_NEXT_DEPLOY === "true") {
  execSync("node scripts/sanitize-open-next-env.mjs", { stdio: "inherit" });
  process.exit(0);
}

console.log(
  "⚙️ Running fresh OpenNext Cloudflare build for current commit...",
);
execSync(
  "npx opennextjs-cloudflare build --openNextConfigPath open-next.config.mjs",
  { stdio: "inherit" },
);
execSync("node scripts/sanitize-open-next-env.mjs", { stdio: "inherit" });
