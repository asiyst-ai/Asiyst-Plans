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

  const isBillingAuthorized =
    orgAccess.membership.role === "owner" ||
    orgAccess.membership.can_manage_billing;

  // Ordinary members must not receive private billing notification records
  if (!isBillingAuthorized) {
    return NextResponse.json({
      data: {
        organization: orgAccess.organization,
        notifications: [],
      },
    });
  }

  const { data: outboxRecords } = await auth.admin
    .from("notification_outbox")
    .select(
      "id, event_type, subject, status, delivery_status, created_at, sent_at",
    )
    .eq("organization_id", orgAccess.organization.id)
    .order("created_at", { ascending: false })
    .limit(30);

  return NextResponse.json({
    data: {
      organization: orgAccess.organization,
      notifications: outboxRecords || [],
    },
  });
}
