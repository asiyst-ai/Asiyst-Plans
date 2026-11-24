import { NextResponse, type NextRequest } from "next/server";
import {
  requireAuthenticatedUser,
  resolveUserOrganizationAccess,
} from "@/lib/auth/session";

export const dynamic = "force-dynamic";

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

  const { data: payments } = await auth.admin
    .from("billing_payments")
    .select("*")
    .eq("organization_id", orgAccess.organization.id)
    .order("created_at", { ascending: false })
    .limit(50);

  return NextResponse.json({
    data: {
      organization: orgAccess.organization,
      payments: payments || [],
    },
  });
}
