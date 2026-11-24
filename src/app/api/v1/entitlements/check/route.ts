import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { OFFICIAL_PLANS } from "@/features/catalog/plans";
import {
  evaluateEntitlementCheck,
  getOrganizationEffectiveEntitlements,
} from "@/features/entitlements/engine";
import {
  jsonError,
  requireAuthenticatedUser,
  resolveUserOrganizationAccess,
  timingSafeSecretCompare,
} from "@/lib/auth/session";
import { enqueueBillingNotification } from "@/lib/email/outbox";
import { createAdminClient, isSupabaseAdminConfigured } from "@/lib/supabase/admin";
import type { EffectiveOrganizationEntitlements } from "@/types/billing";

const checkSchema = z.object({
  organizationId: z.string().uuid().optional(),
  projectId: z.string().uuid().optional(),
  featureKey: z.string().min(1),
  requestedAmount: z.number().int().min(1).default(1),
});

export async function POST(request: NextRequest) {
  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return jsonError(400, "INVALID_JSON", "Request body must be valid JSON.");
  }

  const parsed = checkSchema.safeParse(rawBody);
  if (!parsed.success) {
    return jsonError(400, "INVALID_INPUT", "featureKey and valid parameters are required.");
  }

  const internalSecret = process.env.ASIYST_INTERNAL_SECRET?.trim();
  const providedSecret = request.headers.get("x-asiyst-internal-secret")?.trim();
  const isInternalCall =
    Boolean(internalSecret) && timingSafeSecretCompare(providedSecret, internalSecret);

  let adminClient;
  let organizationId = parsed.data.organizationId;
  let organizationName = "Organization";

  if (isInternalCall) {
    if (!isSupabaseAdminConfigured()) {
      return jsonError(503, "SUPABASE_NOT_CONFIGURED", "Supabase admin is not configured.");
    }
    adminClient = createAdminClient();
    if (!organizationId && parsed.data.projectId) {
      const { data: proj } = await adminClient
        .from("projects")
        .select("organization_id")
        .eq("id", parsed.data.projectId)
        .maybeSingle();
      if (proj?.organization_id) {
        organizationId = String(proj.organization_id);
      }
    }
    if (!organizationId) {
      return jsonError(
        400,
        "ORGANIZATION_ID_REQUIRED",
        "organizationId or projectId is required for internal entitlement checks.",
      );
    }
    const { data: orgRow } = await adminClient
      .from("organizations")
      .select("name")
      .eq("id", organizationId)
      .maybeSingle();
    if (orgRow?.name) organizationName = String(orgRow.name);
  } else {
    const auth = await requireAuthenticatedUser(request);
    if ("error" in auth) return auth.error;
    adminClient = auth.admin;

    if (!organizationId && parsed.data.projectId) {
      const { data: proj } = await adminClient
        .from("projects")
        .select("organization_id")
        .eq("id", parsed.data.projectId)
        .maybeSingle();
      if (proj?.organization_id) {
        organizationId = String(proj.organization_id);
      }
    }

    const orgAccess = await resolveUserOrganizationAccess(
      adminClient,
      auth.user.id,
      organizationId,
      false,
    );
    if ("error" in orgAccess) return orgAccess.error;
    organizationId = orgAccess.organization.id;
    organizationName = orgAccess.organization.name;
  }

  const { entitlements } = await getOrganizationEffectiveEntitlements(
    adminClient,
    organizationId,
  );

  const featureKey =
    parsed.data.featureKey as keyof EffectiveOrganizationEntitlements["features"];
  if (!(featureKey in entitlements.features)) {
    return jsonError(
      400,
      "UNKNOWN_FEATURE_KEY",
      `Unknown entitlement feature key: ${parsed.data.featureKey}`,
    );
  }

  // Measure live resource usage where applicable
  let currentUsage = 0;
  if (featureKey === "projects") {
    const { count } = await adminClient
      .from("projects")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", organizationId)
      .neq("status", "deleted");
    currentUsage = count ?? 0;
  } else if (featureKey === "organization_seats") {
    const { count } = await adminClient
      .from("organization_members")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", organizationId);
    currentUsage = count ?? 0;
  } else if (featureKey === "knowledge_files") {
    const { data: orgProjects } = await adminClient
      .from("projects")
      .select("id")
      .eq("organization_id", organizationId)
      .neq("status", "deleted");
    const projectIds = (orgProjects || []).map((p) => p.id);
    if (projectIds.length > 0) {
      const { count } = await adminClient
        .from("knowledge_files")
        .select("id", { count: "exact", head: true })
        .in("project_id", projectIds)
        .neq("status", "failed");
      currentUsage = count ?? 0;
    }
  }

  const evaluation = evaluateEntitlementCheck(entitlements, {
    featureKey,
    requestedAmount: parsed.data.requestedAmount,
    currentUsage,
  });

  // If limit was reached on a numeric quota, enqueue deduplicated limit_reached notification
  if (!evaluation.allowed && typeof evaluation.limit === "number" && evaluation.limit > 0) {
    const todayKey = new Date().toISOString().slice(0, 10);
    await enqueueBillingNotification(adminClient, {
      organizationId,
      eventType: "billing.usage.limit_reached",
      idempotencyKeyPrefix: `limit_reached:${organizationId}:${featureKey}:${evaluation.limit}:${todayKey}`,
      payload: {
        eventType: "billing.usage.limit_reached",
        organizationName,
        planName: OFFICIAL_PLANS[entitlements.plan].name,
        resourceName: featureKey,
        currentUsage,
        limitValue: evaluation.limit,
      },
    });
  } else if (
    evaluation.allowed &&
    typeof evaluation.limit === "number" &&
    evaluation.limit > 0
  ) {
    const projected = currentUsage + parsed.data.requestedAmount;
    const ratio = projected / evaluation.limit;
    if (ratio >= 0.8) {
      const thresholdTag = ratio >= 1 ? "100pct" : "80pct";
      await enqueueBillingNotification(adminClient, {
        organizationId,
        eventType: "billing.usage.limit_approaching",
        idempotencyKeyPrefix: `usage_threshold:${organizationId}:${featureKey}:${evaluation.limit}:${thresholdTag}`,
        payload: {
          eventType: "billing.usage.limit_approaching",
          organizationName,
          planName: OFFICIAL_PLANS[entitlements.plan].name,
          resourceName: featureKey,
          currentUsage: projected,
          limitValue: evaluation.limit,
        },
      });
    }
  }

  return NextResponse.json(
    {
      data: evaluation,
    },
    { status: evaluation.allowed ? 200 : 403 },
  );
}
