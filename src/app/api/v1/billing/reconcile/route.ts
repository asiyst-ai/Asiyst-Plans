import { NextResponse, type NextRequest } from "next/server";
import {
  jsonError,
  requireAuthenticatedUser,
  resolveUserOrganizationAccess,
  timingSafeSecretCompare,
} from "@/lib/auth/session";
import { reconcileSubscriptionsWithProvider } from "@/lib/payments/reconcile";
import { createAdminClient, isSupabaseAdminConfigured } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const cronSecret =
    process.env.CRON_SECRET?.trim() || process.env.ASIYST_INTERNAL_SECRET?.trim();
  const providedSecret =
    request.headers.get("x-asiyst-internal-secret")?.trim() ||
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim();

  if (cronSecret && timingSafeSecretCompare(providedSecret, cronSecret)) {
    if (!isSupabaseAdminConfigured()) {
      return jsonError(503, "SUPABASE_NOT_CONFIGURED", "Supabase admin is not configured.");
    }
    const admin = createAdminClient();
    const orgId = request.nextUrl.searchParams.get("organizationId");
    const report = await reconcileSubscriptionsWithProvider({
      admin,
      organizationId: orgId,
    });
    return NextResponse.json({ data: report });
  }

  const auth = await requireAuthenticatedUser(request);
  if ("error" in auth) return auth.error;

  const requestedOrgId = request.nextUrl.searchParams.get("organizationId");
  const orgAccess = await resolveUserOrganizationAccess(
    auth.admin,
    auth.user.id,
    requestedOrgId,
    true,
  );
  if ("error" in orgAccess) return orgAccess.error;

  const report = await reconcileSubscriptionsWithProvider({
    admin: auth.admin,
    organizationId: orgAccess.organization.id,
  });

  return NextResponse.json({ data: report });
}
