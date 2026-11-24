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

const inviteSchema = z.object({
  email: z.string().email().max(320),
  role: z.enum(["admin", "member"]).default("admin"),
  canManageBilling: z.boolean().default(true),
  action: z.enum(["invite", "update_role", "remove"]).default("invite"),
  userId: z.string().uuid().optional(),
});

type Context = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, context: Context) {
  const rateLimited = enforceRateLimit(request, 10, "billing-admin-invite");
  if (rateLimited) return rateLimited;

  const auth = await requireAuthenticatedUser(request);
  if ("error" in auth) return auth.error;

  const { id } = await context.params;
  const orgAccess = await resolveUserOrganizationAccess(
    auth.admin,
    auth.user.id,
    id,
    true, // Requires Owner or Billing Admin
  );
  if ("error" in orgAccess) return orgAccess.error;

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return jsonError(400, "INVALID_JSON", "Request body must be valid JSON.");
  }

  const parsed = inviteSchema.safeParse(rawBody);
  if (!parsed.success) {
    return jsonError(400, "INVALID_INPUT", "A valid email address and role configuration are required.");
  }

  // Handle role updates or removal of existing billing administrator
  if (parsed.data.action === "remove" || parsed.data.action === "update_role") {
    if (orgAccess.membership.role !== "owner") {
      return jsonError(
        403,
        "OWNER_REQUIRED",
        "Only the organization owner can change or revoke billing administrator roles.",
      );
    }
    if (!parsed.data.userId) {
      return jsonError(400, "USER_ID_REQUIRED", "userId is required to update or remove a member.");
    }
    if (parsed.data.userId === orgAccess.organization.owner_id) {
      return jsonError(400, "CANNOT_MODIFY_OWNER", "The organization owner's billing authority cannot be removed.");
    }

    if (parsed.data.action === "remove") {
      await auth.admin
        .from("organization_members")
        .update({ can_manage_billing: false })
        .eq("organization_id", id)
        .eq("user_id", parsed.data.userId);
    } else {
      await auth.admin
        .from("organization_members")
        .update({
          role: parsed.data.role,
          can_manage_billing: parsed.data.canManageBilling,
        })
        .eq("organization_id", id)
        .eq("user_id", parsed.data.userId);
    }

    await enqueueBillingNotification(auth.admin, {
      organizationId: id,
      eventType: "billing.admin.role_changed",
      idempotencyKeyPrefix: `role_changed:${id}:${parsed.data.userId}:${Date.now()}`,
      payload: {
        eventType: "billing.admin.role_changed",
        organizationName: orgAccess.organization.name,
        invitedRole:
          parsed.data.action === "remove"
            ? "Billing permission revoked"
            : parsed.data.canManageBilling
              ? "Authorized Billing Administrator"
              : "Standard Member",
      },
      explicitRecipients: [{ email: parsed.data.email, userId: parsed.data.userId }],
    });

    return NextResponse.json({
      data: {
        organizationId: id,
        userId: parsed.data.userId,
        action: parsed.data.action,
        canManageBilling:
          parsed.data.action === "remove" ? false : parsed.data.canManageBilling,
      },
    });
  }

  // Check organization seat limit before inviting a new billing administrator
  const { entitlements } = await getOrganizationEffectiveEntitlements(
    auth.admin,
    id,
  );
  const { count: currentSeats } = await auth.admin
    .from("organization_members")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", id);

  const seatCheck = evaluateEntitlementCheck(entitlements, {
    featureKey: "organization_seats",
    requestedAmount: 1,
    currentUsage: currentSeats ?? 1,
  });

  if (!seatCheck.allowed) {
    return jsonError(
      403,
      "ORGANIZATION_SEAT_LIMIT_REACHED",
      seatCheck.reason ||
        "Your current plan has reached its organization seat limit. Upgrade to Asiyst Vector or Quantum to add billing administrators.",
      {
        currentSeats: currentSeats ?? 1,
        seatLimit: seatCheck.limit,
        plan: entitlements.plan,
      },
    );
  }

  const rawToken = randomBytes(24).toString("hex");
  const tokenHash = createHash("sha256").update(rawToken, "utf8").digest("hex");
  const inviteEmail = parsed.data.email.trim().toLowerCase();

  const { data: invitation, error: invError } = await auth.admin
    .from("billing_admin_invitations")
    .insert({
      organization_id: id,
      email: inviteEmail,
      invited_by: auth.user.id,
      role: parsed.data.role,
      can_manage_billing: parsed.data.canManageBilling,
      token_hash: tokenHash,
      status: "pending",
    })
    .select("id, email, role, can_manage_billing, status, expires_at")
    .single();

  if (invError) {
    return jsonError(500, "INVITATION_FAILED", "Unable to create billing administrator invitation.");
  }

  const invitationUrl = `${PLAN_APP_BASE_URL}/account/settings?invite=${rawToken}`;

  await enqueueBillingNotification(auth.admin, {
    organizationId: id,
    eventType: "billing.admin.invited",
    idempotencyKeyPrefix: `invite:${invitation.id}`,
    payload: {
      eventType: "billing.admin.invited",
      organizationName: orgAccess.organization.name,
      invitedRole: parsed.data.canManageBilling
        ? "Billing Administrator"
        : "Organization Member",
      invitationUrl,
    },
    explicitRecipients: [{ email: inviteEmail }],
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
