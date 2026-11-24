import { NextResponse, type NextRequest } from "next/server";
import { getOrganizationEffectiveEntitlements } from "@/features/entitlements/engine";
import {
  requireAuthenticatedUser,
  resolveUserOrganizationAccess,
} from "@/lib/auth/session";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, context: Context) {
  const auth = await requireAuthenticatedUser(request);
  if ("error" in auth) return auth.error;

  const { id } = await context.params;
  const orgAccess = await resolveUserOrganizationAccess(
    auth.admin,
    auth.user.id,
    id,
    true, // Only owner or billing administrator may access organization billing management
  );
  if ("error" in orgAccess) return orgAccess.error;

  const [
    { entitlements, rawSubscription },
    contactRes,
    membersRes,
    invitationsRes,
  ] = await Promise.all([
    getOrganizationEffectiveEntitlements(auth.admin, id),
    auth.admin
      .from("organization_billing_contacts")
      .select("*")
      .eq("organization_id", id)
      .maybeSingle(),
    auth.admin
      .from("organization_members")
      .select("id, user_id, role, can_manage_billing, created_at")
      .eq("organization_id", id)
      .order("created_at", { ascending: true }),
    auth.admin
      .from("billing_admin_invitations")
      .select("id, email, role, can_manage_billing, status, expires_at, created_at")
      .eq("organization_id", id)
      .order("created_at", { ascending: false }),
  ]);

  const userIds = (membersRes.data || []).map((m) => m.user_id);
  const { data: profiles } =
    userIds.length > 0
      ? await auth.admin
          .from("profiles")
          .select("id, email, full_name")
          .in("id", userIds)
      : { data: [] };

  const profileMap = new Map(
    (profiles || []).map((p) => [String(p.id), p]),
  );

  const billingMembers = (membersRes.data || []).map((m) => {
    const profile = profileMap.get(String(m.user_id));
    return {
      membershipId: m.id,
      userId: m.user_id,
      email: profile?.email || "",
      fullName: profile?.full_name || "",
      role: m.role,
      canManageBilling: m.role === "owner" || Boolean(m.can_manage_billing),
      createdAt: m.created_at,
    };
  });

  return NextResponse.json({
    data: {
      organization: orgAccess.organization,
      billingContact: contactRes.data || null,
      subscription: rawSubscription,
      entitlements,
      members: billingMembers,
      invitations: invitationsRes.data || [],
    },
  });
}
