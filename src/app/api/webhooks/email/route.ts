import { createHmac, timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { jsonError } from "@/lib/auth/session";
import {
  createAdminClient,
  isSupabaseAdminConfigured,
} from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const secret = process.env.EMAIL_WEBHOOK_SECRET?.trim() || "";
  if (!secret) {
    return jsonError(
      503,
      "EMAIL_WEBHOOK_NOT_CONFIGURED",
      "EMAIL_WEBHOOK_SECRET is not configured.",
    );
  }

  let rawBody: string;
  try {
    rawBody = await request.text();
  } catch {
    return jsonError(400, "INVALID_PAYLOAD", "Unable to read webhook payload.");
  }

  const svixId =
    request.headers.get("svix-id") || request.headers.get("webhook-id") || "";
  const svixTimestamp =
    request.headers.get("svix-timestamp") ||
    request.headers.get("webhook-timestamp") ||
    "";
  const svixSignature =
    request.headers.get("svix-signature") ||
    request.headers.get("webhook-signature") ||
    "";

  if (!svixId || !svixTimestamp || !svixSignature) {
    return jsonError(401, "MISSING_SIGNATURE_HEADERS", "Missing email webhook signature headers.");
  }

  let secretBuffer: Buffer;
  if (secret.startsWith("whsec_")) {
    try {
      secretBuffer = Buffer.from(secret.slice(6), "base64");
    } catch {
      secretBuffer = Buffer.from(secret, "utf8");
    }
  } else {
    secretBuffer = Buffer.from(secret, "utf8");
  }

  const signedContent = `${svixId}.${svixTimestamp}.${rawBody}`;
  const expectedBase64 = createHmac("sha256", secretBuffer)
    .update(signedContent)
    .digest("base64");

  const candidates = svixSignature.split(" ").map((s) => {
    const idx = s.indexOf(",");
    return idx >= 0 ? s.slice(idx + 1) : s;
  });

  const isValid = candidates.some(
    (c) =>
      c.length === expectedBase64.length &&
      timingSafeEqual(Buffer.from(c), Buffer.from(expectedBase64)),
  );

  if (!isValid) {
    return jsonError(401, "INVALID_EMAIL_WEBHOOK_SIGNATURE", "Invalid email delivery webhook signature.");
  }

  if (!isSupabaseAdminConfigured()) {
    return jsonError(503, "SUPABASE_NOT_CONFIGURED", "Supabase admin is not configured.");
  }

  const admin = createAdminClient();
  const payload = JSON.parse(rawBody) as Record<string, unknown>;
  const rawType = String(payload.type || "").toLowerCase();
  const data =
    payload.data && typeof payload.data === "object"
      ? (payload.data as Record<string, unknown>)
      : {};
  const emailId = String(data.email_id || data.id || "").trim();

  const statusMap: Record<
    string,
    "accepted" | "delivered" | "bounced" | "complained" | "rejected"
  > = {
    "email.sent": "accepted",
    "email.delivered": "delivered",
    "email.bounced": "bounced",
    "email.complained": "complained",
    "email.failed": "rejected",
  };

  const mappedStatus = statusMap[rawType];
  if (!mappedStatus || !emailId) {
    return NextResponse.json({ received: true, ignored: true });
  }

  const { data: outboxRow } = await admin
    .from("notification_outbox")
    .select("id")
    .eq("provider_message_id", emailId)
    .maybeSingle();

  await admin.from("email_delivery_events").upsert(
    {
      outbox_id: outboxRow?.id || null,
      provider: "resend",
      provider_event_id: svixId,
      provider_message_id: emailId,
      event_type: mappedStatus,
      payload,
      occurred_at: new Date().toISOString(),
    },
    { onConflict: "provider_event_id" },
  );

  if (outboxRow?.id) {
    await admin
      .from("notification_outbox")
      .update({
        delivery_status: mappedStatus,
        updated_at: new Date().toISOString(),
      })
      .eq("id", outboxRow.id);
  }

  return NextResponse.json({
    received: true,
    providerMessageId: emailId,
    deliveryStatus: mappedStatus,
  });
}
