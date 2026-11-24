import { NextResponse, type NextRequest } from "next/server";
import { OFFICIAL_PLANS } from "@/features/catalog/plans";
import { getOrganizationEffectiveEntitlements } from "@/features/entitlements/engine";
import {
  requireAuthenticatedUser,
  resolveUserOrganizationAccess,
} from "@/lib/auth/session";
import { getDodoConfigurationStatus } from "@/lib/payments/dodo";

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

  const organizationId = orgAccess.organization.id;

  const [
    { entitlements, rawSubscription },
    projectsCount,
    membersCount,
    paymentsRes,
    contactRes,
    orgProjectsRes,
  ] = await Promise.all([
    getOrganizationEffectiveEntitlements(auth.admin, organizationId),
    auth.admin
      .from("projects")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", organizationId)
      .neq("status", "deleted"),
    auth.admin
      .from("organization_members")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", organizationId),
    auth.admin
      .from("billing_payments")
      .select("*")
      .eq("organization_id", organizationId)
      .order("created_at", { ascending: false })
      .limit(10),
    auth.admin
      .from("organization_billing_contacts")
      .select("*")
      .eq("organization_id", organizationId)
      .maybeSingle(),
    auth.admin
      .from("projects")
      .select("id")
      .eq("organization_id", organizationId)
      .neq("status", "deleted"),
  ]);

  let knowledgeFilesCount = 0;
  const projectIds = (orgProjectsRes.data || []).map((p) => p.id);
  if (projectIds.length > 0) {
    const { count } = await auth.admin
      .from("knowledge_files")
      .select("id", { count: "exact", head: true })
      .in("project_id", projectIds)
      .neq("status", "failed");
    knowledgeFilesCount = count ?? 0;
  }

  const planDef = OFFICIAL_PLANS[entitlements.plan];
  const dodoConfig = getDodoConfigurationStatus();

  return NextResponse.json({
    data: {
      organization: orgAccess.organization,
      membership: orgAccess.membership,
      plan: planDef,
      subscription: rawSubscription,
      entitlements,
      usage: {
        projects: {
          used: projectsCount.count ?? 0,
          limit: entitlements.features.projects.limit,
          unlimited: entitlements.features.projects.unlimited,
        },
        organizationSeats: {
          used: membersCount.count ?? 0,
          limit: entitlements.features.organization_seats.limit,
          unlimited: entitlements.features.organization_seats.unlimited,
        },
        knowledgeFiles: {
          used: knowledgeFilesCount,
          limit: entitlements.features.knowledge_files.limit,
          unlimited: entitlements.features.knowledge_files.unlimited,
        },
      },
      billingContact: contactRes.data || {
        billing_email: auth.user.email,
        email_verified: auth.user.emailConfirmed,
      },
      recentPayments: paymentsRes.data || [],
      gatewayStatus: {
        environment: dodoConfig.environment,
        isFullyConfigured: dodoConfig.isFullyConfigured,
      },
    },
  });
}
