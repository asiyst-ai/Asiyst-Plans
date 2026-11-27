import { createHash, randomBytes } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import {
  evaluateEntitlementCheck,
  getOrganizationEffectiveEntitlements,
} from "@/features/entitlements/engine";
import {
  enforceRateLimit,
  jsonError,
  requireAuthenticatedUser,
  resolveUserOrganizationAccess,
} from "@/lib/auth/session";
import { enqueueBillingNotification } from "@/lib/email/outbox";
import { PLAN_APP_BASE_URL } from "@/features/email-templates/templates";

const allowedRoleEnum = z.enum(["admin", "manager", "editor", "member", "viewer"]);

const inviteActionSchema = z.object({
  action: z.literal("invite").default("invite"),
  email: z.string().trim().email().max(320),
  role: allowedRoleEnum.default("admin"),
  canManageBilling: z.boolean().default(true),
});

const memberModifySchema = z.object({
  action: z.enum(["update_role", "remove"]),
  userId: z.string().uuid(),
  email: z.string().trim().email().max(320).optional(),
  role: allowedRoleEnum.optional(),
  canManageBilling: z.boolean().optional(),
});

const invitationManageSchema = z.object({
  action: z.enum(["resend", "revoke"]),
  invitationId: z.string().uuid(),
});

const requestSchema = z.union([
  inviteActionSchema,
  memberModifySchema,
  invitationManageSchema,
]);

type Context = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, context: Context) {
  const rateLimited = enforceRateLimit(request, 15, "billing-admin-invite");
  if (rateLimited) return rateLimited;

  const auth = await requireAuthenticatedUser(request);
  if ("error" in auth) return auth.error;

  const { id } = await context.params;
  if (!z.string().uuid().safeParse(id).success) {
    return jsonError(400, "INVALID_ORGANIZATION_ID", "A valid organization ID is required.");
  }

  const orgAccess = await resolveUserOrganizationAccess(
    auth.admin,
    auth.user.id,
    id,
    true, // Requires active Owner or Billing Admin
  );
  if ("error" in orgAccess) return orgAccess.error;

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return jsonError(400, "INVALID_JSON", "Request body must be valid JSON.");
  }

  const parsed = requestSchema.safeParse(rawBody);
  if (!parsed.success) {
    return jsonError(
      400,
      "INVALID_INPUT",
      "Invalid billing administration request payload.",
    );
  }

  const payload = parsed.data;

  // 1. Update role or remove billing permission on existing active member (Owner only)
  if (payload.action === "remove" || payload.action === "update_role") {
    if (orgAccess.membership.role !== "owner") {
      return jsonError(
        403,
        "OWNER_REQUIRED",
        "Only the organization owner can change or revoke billing administrator roles.",
      );
    }
    if (payload.userId === orgAccess.organization.owner_id || payload.userId === auth.user.id) {
      return jsonError(
        400,
        "CANNOT_MODIFY_OWNER",
        "The organization owner's billing authority cannot be removed or self-modified.",
      );
    }

    const { data: targetMember } = await auth.admin
      .from("organization_members")
      .select("user_id, role, status, permissions, can_manage_billing")
      .eq("organization_id", id)
      .eq("user_id", payload.userId)
      .maybeSingle();

    if (!targetMember || targetMember.status === "removed") {
      return jsonError(404, "MEMBER_NOT_FOUND", "Target organization member not found.");
    }
    if (targetMember.role === "owner") {
      return jsonError(400, "CANNOT_MODIFY_OWNER", "Cannot modify an organization owner.");
    }

    const nextRole =
      payload.action === "remove"
        ? targetMember.role
        : payload.role || targetMember.role;
    const nextBilling =
      payload.action === "remove"
        ? false
        : payload.canManageBilling ?? Boolean(targetMember.can_manage_billing);
    const prevPerms =
      targetMember.permissions && typeof targetMember.permissions === "object"
        ? (targetMember.permissions as Record<string, unknown>)
        : {};

    const { error: updError } = await auth.admin
      .from("organization_members")
      .update({
        role: nextRole,
        can_manage_billing: nextBilling,
        permissions: {
          ...prevPerms,
          "billing.manage": nextBilling,
        },
        updated_at: new Date().toISOString(),
      })
      .eq("organization_id", id)
      .eq("user_id", payload.userId);

    if (updError) {
      return jsonError(500, "MEMBER_UPDATE_FAILED", "Unable to update billing administrator.");
    }

    await auth.admin.from("audit_logs").insert({
      organization_id: id,
      user_id: auth.user.id,
      action:
        payload.action === "remove"
          ? "organization.billing_admin_revoked"
          : "organization.billing_admin_updated",
      resource_type: "organization_member",
      resource_id: payload.userId,
      metadata: { role: nextRole, can_manage_billing: nextBilling },
    });

    if (payload.email) {
      await enqueueBillingNotification(auth.admin, {
        organizationId: id,
        eventType: "billing.admin.role_changed",
        idempotencyKeyPrefix: `role_changed:${id}:${payload.userId}:${Date.now()}`,
        payload: {
          eventType: "billing.admin.role_changed",
          organizationName: orgAccess.organization.name,
          invitedRole: nextBilling
            ? "Authorized Billing Administrator"
            : "Billing permission revoked",
        },
        explicitRecipients: [{ email: payload.email, userId: payload.userId }],
      });
    }

    return NextResponse.json({
      data: {
        organizationId: id,
        userId: payload.userId,
        action: payload.action,
        role: nextRole,
        canManageBilling: nextBilling,
      },
    });
  }

  // 2. Resend or revoke a pending billing admin invitation
  if (payload.action === "resend" || payload.action === "revoke") {
    if (orgAccess.membership.role !== "owner") {
      return jsonError(
        403,
        "OWNER_REQUIRED",
        "Only the organization owner can resend or revoke billing administrator invitations.",
      );
    }

    const { data: inv } = await auth.admin
      .from("billing_admin_invitations")
      .select("id, email, role, can_manage_billing, status")
      .eq("id", payload.invitationId)
      .eq("organization_id", id)
      .maybeSingle();

    if (!inv || inv.status !== "pending") {
      return jsonError(404, "INVITATION_NOT_PENDING", "Pending invitation not found.");
    }

    if (payload.action === "revoke") {
      const { error: revErr } = await auth.admin
        .from("billing_admin_invitations")
        .update({
          status: "revoked",
          revoked_at: new Date().toISOString(),
          revoked_by: auth.user.id,
          updated_at: new Date().toISOString(),
        })
        .eq("id", inv.id)
        .eq("organization_id", id);

      if (revErr) {
        return jsonError(500, "REVOKE_FAILED", "Unable to revoke invitation.");
      }

      await auth.admin.from("audit_logs").insert({
        organization_id: id,
        user_id: auth.user.id,
        action: "organization.billing_invite_revoked",
        resource_type: "billing_admin_invitation",
        resource_id: inv.id,
        metadata: { email: inv.email },
      });

      return NextResponse.json({ data: { revoked: true, invitationId: inv.id } });
    }

    const rawToken = randomBytes(24).toString("hex");
    const tokenHash = createHash("sha256").update(rawToken, "utf8").digest("hex");
    const expiresAt = new Date(Date.now() + 7 * 86_400_000).toISOString();

    const { error: resendErr } = await auth.admin
      .from("billing_admin_invitations")
      .update({
        token_hash: tokenHash,
        expires_at: expiresAt,
        updated_at: new Date().toISOString(),
      })
      .eq("id", inv.id)
      .eq("organization_id", id);

    if (resendErr) {
      return jsonError(500, "RESEND_FAILED", "Unable to refresh invitation token.");
    }

    const invitationUrl = `${PLAN_APP_BASE_URL}/account/settings?invite=${rawToken}&orgId=${encodeURIComponent(id)}`;
    await enqueueBillingNotification(auth.admin, {
      organizationId: id,
      eventType: "billing.admin.invited",
      idempotencyKeyPrefix: `invite_resend:${inv.id}:${Date.now()}`,
      payload: {
        eventType: "billing.admin.invited",
        organizationName: orgAccess.organization.name,
        invitedRole: inv.can_manage_billing
          ? "Billing Administrator"
          : "Organization Member",
        invitationUrl,
      },
      explicitRecipients: [{ email: inv.email }],
    });

    return NextResponse.json({
      data: { resent: true, invitationId: inv.id, expiresAt },
    });
  }

  // 3. Create new invitation (Owner only to grant billing admin authority)
  if (payload.action !== "invite") {
    return jsonError(400, "INVALID_ACTION", "Unsupported invitation action.");
  }

  if (orgAccess.membership.role !== "owner") {
    return jsonError(
      403,
      "OWNER_REQUIRED",
      "Only the organization owner can invite new billing administrators.",
    );
  }

  const inviteEmail = payload.email.trim().toLowerCase();

  // Prevent inviting an existing active member
  const { data: existingProfiles } = await auth.admin
    .from("profiles")
    .select("id")
    .ilike("email", inviteEmail)
    .limit(1);

  if (existingProfiles && existingProfiles.length > 0) {
    const existingUserId = existingProfiles[0].id;
    const { data: existingMember } = await auth.admin
      .from("organization_members")
      .select("user_id, status")
      .eq("organization_id", id)
      .eq("user_id", existingUserId)
      .neq("status", "removed")
      .maybeSingle();
    if (existingMember) {
      return jsonError(
        409,
        "MEMBER_ALREADY_EXISTS",
        "This user is already a member of the organization. Update their role from the members list instead.",
      );
    }
  }

  // Prevent duplicate pending invitation for the same email
  const { data: existingPending } = await auth.admin
    .from("billing_admin_invitations")
    .select("id")
    .eq("organization_id", id)
    .ilike("email", inviteEmail)
    .eq("status", "pending")
    .maybeSingle();

  if (existingPending) {
    return jsonError(
      409,
      "INVITATION_ALREADY_PENDING",
      "A pending billing invitation already exists for this email address. Resend or revoke it instead.",
    );
  }

  // Check organization seat limit including active members + pending invitations
  const { entitlements } = await getOrganizationEffectiveEntitlements(auth.admin, id);
  const [{ count: activeSeats }, { count: pendingAdminInvites }, { count: pendingWsInvites }] =
    await Promise.all([
      auth.admin
        .from("organization_members")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", id)
        .eq("status", "active"),
      auth.admin
        .from("billing_admin_invitations")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", id)
        .eq("status", "pending"),
      auth.admin
        .from("workspace_invitations")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", id)
        .eq("status", "pending"),
    ]);

  const currentUsedAndReserved =
    (activeSeats ?? 1) + (pendingAdminInvites ?? 0) + (pendingWsInvites ?? 0);

  const seatCheck = evaluateEntitlementCheck(entitlements, {
    featureKey: "organization_seats",
    requestedAmount: 1,
    currentUsage: currentUsedAndReserved,
  });

  if (!seatCheck.allowed) {
    return jsonError(
      429,
      "ORGANIZATION_SEAT_LIMIT_REACHED",
      seatCheck.reason ||
        "Your current plan has reached its organization seat limit (including pending invitations). Upgrade to Asiyst Vector or Quantum to add billing administrators.",
      {
        currentSeats: activeSeats ?? 1,
        pendingInvitations: (pendingAdminInvites ?? 0) + (pendingWsInvites ?? 0),
        seatLimit: seatCheck.limit,
        plan: entitlements.plan,
      },
    );
  }

  const rawToken = randomBytes(24).toString("hex");
  const tokenHash = createHash("sha256").update(rawToken, "utf8").digest("hex");
  const expiresAt = new Date(Date.now() + 7 * 86_400_000).toISOString();

  const { data: invitation, error: invError } = await auth.admin
    .from("billing_admin_invitations")
    .insert({
      organization_id: id,
      email: inviteEmail,
      invited_by: auth.user.id,
      role: payload.role,
      can_manage_billing: payload.canManageBilling,
      token_hash: tokenHash,
      status: "pending",
      expires_at: expiresAt,
    })
    .select("id, email, role, can_manage_billing, status, expires_at")
    .single();

  if (invError || !invitation) {
    return jsonError(
      500,
      "INVITATION_FAILED",
      "Unable to create billing administrator invitation.",
    );
  }

  const invitationUrl = `${PLAN_APP_BASE_URL}/account/settings?invite=${rawToken}&orgId=${encodeURIComponent(id)}`;

  await enqueueBillingNotification(auth.admin, {
    organizationId: id,
    eventType: "billing.admin.invited",
    idempotencyKeyPrefix: `invite:${invitation.id}`,
    payload: {
      eventType: "billing.admin.invited",
      organizationName: orgAccess.organization.name,
      invitedRole: payload.canManageBilling
        ? "Billing Administrator"
        : "Organization Member",
      invitationUrl,
    },
    explicitRecipients: [{ email: inviteEmail }],
  });

  await auth.admin.from("audit_logs").insert({
    organization_id: id,
    user_id: auth.user.id,
    action: "organization.billing_invite_created",
    resource_type: "billing_admin_invitation",
    resource_id: invitation.id,
    metadata: {
      email: inviteEmail,
      role: payload.role,
      can_manage_billing: payload.canManageBilling,
    },
  });

  return NextResponse.json(
    {
      data: {
        invitation,
      },
    },
    { status: 201 },
  );
}
