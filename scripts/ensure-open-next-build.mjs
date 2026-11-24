import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

/**
 * Ensures `.open-next/worker.js` and `.open-next/assets` are freshly built
 * from the current commit before `wrangler deploy` or `wrangler dev` runs,
 * and injects public `vars` from `wrangler.jsonc` so Cloudflare Workers Builds CI
 * (which has no `.env.local`) always embeds `NEXT_PUBLIC_*` & `SUPABASE_URL`.
 */

function loadWranglerPublicVars() {
  try {
    const wranglerPath = path.join(process.cwd(), "wrangler.jsonc");
    if (!fs.existsSync(wranglerPath)) return {};
    const raw = fs.readFileSync(wranglerPath, "utf8");
    const withoutComments = raw
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    const parsed = JSON.parse(withoutComments);
    const rootVars =
      parsed && typeof parsed.vars === "object" && parsed.vars !== null
        ? parsed.vars
        : {};
    const stringVars = {};
    for (const [k, v] of Object.entries(rootVars)) {
      if (typeof v === "string") {
        stringVars[k] = v;
      }
    }
    return stringVars;
  } catch {
    return {};
  }
}

if (process.env.OPEN_NEXT_DEPLOY === "true") {
  execSync("node scripts/sanitize-open-next-env.mjs", { stdio: "inherit" });
  process.exit(0);
}

const wranglerVars = loadWranglerPublicVars();
const buildEnv = {
  ...wranglerVars,
  ...process.env,
};

console.log(
  "⚙️ Running fresh OpenNext Cloudflare build for current commit...",
);
execSync(
  "npx opennextjs-cloudflare build --openNextConfigPath open-next.config.mjs",
  { stdio: "inherit", env: buildEnv },
);
execSync("node scripts/sanitize-open-next-env.mjs", {
  stdio: "inherit",
  env: buildEnv,
});
