import { NextResponse, type NextRequest } from "next/server";
import { getOrganizationEffectiveEntitlements } from "@/features/entitlements/engine";
import {
  jsonError,
  requireAuthenticatedUser,
  resolveUserOrganizationAccess,
  timingSafeSecretCompare,
} from "@/lib/auth/session";
import { createAdminClient, isSupabaseAdminConfigured } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const internalSecret = process.env.ASIYST_INTERNAL_SECRET?.trim();
  const providedSecret = request.headers.get("x-asiyst-internal-secret")?.trim();
  const requestedOrgId = request.nextUrl.searchParams.get("organizationId");

  // Support authenticated server-to-server lookups from Asiyst-WEB
  if (internalSecret && timingSafeSecretCompare(providedSecret, internalSecret)) {
    if (!requestedOrgId) {
      return jsonError(400, "ORGANIZATION_ID_REQUIRED", "organizationId is required.");
    }
    if (!isSupabaseAdminConfigured()) {
      return jsonError(503, "SUPABASE_NOT_CONFIGURED", "Supabase admin is not configured.");
    }
    const admin = createAdminClient();
    const { entitlements, rawSubscription } =
      await getOrganizationEffectiveEntitlements(admin, requestedOrgId);

    return NextResponse.json({
      data: {
        entitlements,
        subscription: rawSubscription,
      },
    });
  }

  const auth = await requireAuthenticatedUser(request);
  if ("error" in auth) return auth.error;

  const orgAccess = await resolveUserOrganizationAccess(
    auth.admin,
    auth.user.id,
    requestedOrgId,
    false,
  );
  if ("error" in orgAccess) return orgAccess.error;

  const { entitlements, rawSubscription } =
    await getOrganizationEffectiveEntitlements(
      auth.admin,
      orgAccess.organization.id,
    );

  return NextResponse.json({
    data: {
      organization: orgAccess.organization,
      entitlements,
      subscription: rawSubscription,
    },
  });
}
