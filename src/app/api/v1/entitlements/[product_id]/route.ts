import { NextResponse, type NextRequest } from "next/server";
import { getOrganizationEffectiveEntitlements } from "@/features/entitlements/engine";
import {
  jsonError,
  requireAuthenticatedUser,
  resolveUserOrganizationAccess,
} from "@/lib/auth/session";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ product_id: string }> };

export async function GET(request: NextRequest, context: Context) {
  const { product_id } = await context.params;
  if (product_id !== "asiyst-ai" && product_id !== "prod_asiyst_ai") {
    return jsonError(404, "PRODUCT_NOT_FOUND", `Product '${product_id}' was not found.`);
  }

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

  const { entitlements } = await getOrganizationEffectiveEntitlements(
    auth.admin,
    orgAccess.organization.id,
  );

  return NextResponse.json({
    data: {
      product: "asiyst-ai",
      organizationId: orgAccess.organization.id,
      entitlements,
    },
  });
}
