/**
 * Cloudflare Worker Entry Point for Asiyst Plan (plan.asiyst.com)
 *
 * Wraps the OpenNext Cloudflare generated worker (`.open-next/worker.js`)
 * and adds the Cloudflare Cron Trigger `scheduled` handler to invoke the
 * protected email outbox and subscription reminder worker every 5 minutes.
 */

import openNextWorker from "./.open-next/worker.js";
export {
  DOQueueHandler,
  DOShardedTagCache,
  BucketCachePurge,
} from "./.open-next/worker.js";

const worker = {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.protocol === "http:" && url.hostname === "plan.asiyst.com") {
      url.protocol = "https:";
      return Response.redirect(url.toString(), 308);
    }
    return openNextWorker.fetch(request, env, ctx);
  },

  async scheduled(controller, env, ctx) {
    const authSecret = (
      env.CRON_SECRET ||
      env.ASIYST_EMAIL_INTERNAL_SECRET ||
      env.ADMIN_SECRET_KEY ||
      process.env.CRON_SECRET ||
      process.env.ASIYST_EMAIL_INTERNAL_SECRET ||
      process.env.ADMIN_SECRET_KEY ||
      ""
    ).trim();

    if (!authSecret) {
      console.error(
        "[asiyst-plan:cron] Skipping scheduled email outbox execution: CRON_SECRET or ASIYST_EMAIL_INTERNAL_SECRET is not configured.",
      );
      return;
    }

    const baseUrl = (
      env.NEXT_PUBLIC_APP_URL ||
      process.env.NEXT_PUBLIC_APP_URL ||
      "https://plan.asiyst.com"
    )
      .trim()
      .replace(/\/$/, "");

    const cronRequest = new Request(`${baseUrl}/api/v1/worker/email-outbox`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${authSecret}`,
        "x-asiyst-internal-secret": authSecret,
        "Content-Type": "application/json",
        "User-Agent": "Cloudflare-Workers-Cron/asiyst-plan",
      },
      body: JSON.stringify({
        source: "cloudflare_cron",
        cron: controller.cron,
        scheduledTime: controller.scheduledTime,
      }),
    });

    const task = (async () => {
      try {
        const response = await openNextWorker.fetch(cronRequest, env, ctx);
        if (!response.ok) {
          const errorText = await response.text().catch(() => "");
          console.error(
            `[asiyst-plan:cron] Email outbox worker returned HTTP ${response.status}: ${errorText.slice(0, 300)}`,
          );
        }
      } catch (err) {
        console.error(
          "[asiyst-plan:cron] Email outbox worker execution error:",
          err instanceof Error ? err.message : String(err),
        );
      }
    })();

    ctx.waitUntil(task);
    await task;
  },
};

export default worker;
