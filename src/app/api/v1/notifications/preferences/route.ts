import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import {
  jsonError,
  requireAuthenticatedUser,
  resolveUserOrganizationAccess,
} from "@/lib/auth/session";

export const dynamic = "force-dynamic";

const prefSchema = z.object({
  organizationId: z.string().uuid().optional(),
  usageAlerts: z.boolean().optional(),
  productUpdates: z.boolean().optional(),
  marketing: z.boolean().optional(),
});

export async function GET(request: NextRequest) {
  const auth = await requireAuthenticatedUser(request);
  if ("error" in auth) return auth.error;

  const requestedOrgId = request.nextUrl.searchParams.get("organizationId");
  const orgAccess = await resolveUserOrganizationAccess(
    auth.admin,
    auth.user.id,
    requestedOrgId,
    false,
  );
  if ("error" in orgAccess) return orgAccess.error;

  const { data: rows } = await auth.admin
    .from("notification_preferences")
    .select("notification_category, enabled")
    .eq("organization_id", orgAccess.organization.id)
    .eq("user_id", auth.user.id);

  const prefMap: Record<string, boolean> = {
    billing_essential: true, // Always true (essential transactional notifications)
    usage_alerts: true,
    product_updates: true,
    marketing: false,
  };

  for (const r of rows || []) {
    if (r.notification_category !== "billing_essential") {
      prefMap[String(r.notification_category)] = Boolean(r.enabled);
    }
  }

  return NextResponse.json({
    data: {
      organizationId: orgAccess.organization.id,
      preferences: prefMap,
    },
  });
}

export async function POST(request: NextRequest) {
  const auth = await requireAuthenticatedUser(request);
  if ("error" in auth) return auth.error;

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return jsonError(400, "INVALID_JSON", "Request body must be valid JSON.");
  }

  const parsed = prefSchema.safeParse(rawBody);
  if (!parsed.success) {
    return jsonError(400, "INVALID_INPUT", "Invalid notification preferences payload.");
  }

  const orgAccess = await resolveUserOrganizationAccess(
    auth.admin,
    auth.user.id,
    parsed.data.organizationId,
    false,
  );
  if ("error" in orgAccess) return orgAccess.error;

  const updates: Array<{
    organization_id: string;
    user_id: string;
    notification_category: string;
    enabled: boolean;
    updated_at: string;
  }> = [];

  const nowIso = new Date().toISOString();
  if (parsed.data.usageAlerts !== undefined) {
    updates.push({
      organization_id: orgAccess.organization.id,
      user_id: auth.user.id,
      notification_category: "usage_alerts",
      enabled: parsed.data.usageAlerts,
      updated_at: nowIso,
    });
  }
  if (parsed.data.productUpdates !== undefined) {
    updates.push({
      organization_id: orgAccess.organization.id,
      user_id: auth.user.id,
      notification_category: "product_updates",
      enabled: parsed.data.productUpdates,
      updated_at: nowIso,
    });
  }
  if (parsed.data.marketing !== undefined) {
    updates.push({
      organization_id: orgAccess.organization.id,
      user_id: auth.user.id,
      notification_category: "marketing",
      enabled: parsed.data.marketing,
      updated_at: nowIso,
    });
  }

  if (updates.length > 0) {
    await auth.admin
      .from("notification_preferences")
      .upsert(updates, {
        onConflict: "organization_id,user_id,notification_category",
      });
  }

  return NextResponse.json({
    data: {
      organizationId: orgAccess.organization.id,
      updated: updates.length,
      billingEssentialLocked: true,
    },
  });
}
