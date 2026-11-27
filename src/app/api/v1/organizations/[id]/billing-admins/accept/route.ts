import { createHash } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import {
  enforceRateLimit,
  jsonError,
  requireAuthenticatedUser,
} from "@/lib/auth/session";
import { createAdminClient, isSupabaseAdminConfigured } from "@/lib/supabase/admin";

const acceptSchema = z.object({
  token: z.string().trim().min(16).max(256),
});

type Context = { params: Promise<{ id: string }> };

/**
 * Safe read-only invitation preview by token (does not mutate or grant access).
 */
export async function GET(request: NextRequest, context: Context) {
  const { id } = await context.params;
  if (!z.string().uuid().safeParse(id).success) {
    return jsonError(400, "INVALID_ORGANIZATION_ID", "A valid organization ID is required.");
  }

  const token = request.nextUrl.searchParams.get("token")?.trim() || "";
  if (!token || token.length < 16) {
    return jsonError(400, "INVALID_TOKEN", "A valid invitation token is required.");
  }

  if (!isSupabaseAdminConfigured()) {
    return jsonError(503, "SERVICE_UNAVAILABLE", "Database configuration is incomplete.");
  }

  const admin = createAdminClient();
  const tokenHash = createHash("sha256").update(token, "utf8").digest("hex");

  const { data: inv } = await admin
    .from("billing_admin_invitations")
    .select("id, organization_id, email, role, can_manage_billing, status, expires_at, created_at")
    .eq("organization_id", id)
    .eq("token_hash", tokenHash)
    .maybeSingle();

  if (!inv) {
    return jsonError(404, "INVITATION_NOT_FOUND", "Invitation not found or invalid.");
  }

  const { data: org } = await admin
    .from("organizations")
    .select("id, name")
    .eq("id", id)
    .maybeSingle();

  const expired =
    inv.status === "expired" ||
    (inv.expires_at ? new Date(inv.expires_at).getTime() <= Date.now() : false);

  return NextResponse.json({
    data: {
      invitation: {
        id: inv.id,
        organizationId: inv.organization_id,
        organizationName: org?.name || "Organization",
        email: inv.email,
        role: inv.role,
        canManageBilling: Boolean(inv.can_manage_billing),
        status: expired && inv.status === "pending" ? "expired" : inv.status,
        expiresAt: inv.expires_at,
      },
    },
  });
}

/**
 * Atomic, email-bound billing administrator invitation acceptance.
 */
export async function POST(request: NextRequest, context: Context) {
  const rateLimited = enforceRateLimit(request, 10, "billing-admin-accept");
  if (rateLimited) return rateLimited;

  const auth = await requireAuthenticatedUser(request);
  if ("error" in auth) return auth.error;

  const { id } = await context.params;
  if (!z.string().uuid().safeParse(id).success) {
    return jsonError(400, "INVALID_ORGANIZATION_ID", "A valid organization ID is required.");
  }

  if (!auth.user.email || !auth.user.emailConfirmed) {
    return jsonError(
      403,
      "EMAIL_VERIFICATION_REQUIRED",
      "A verified account email address is required to accept an organization invitation.",
    );
  }

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return jsonError(400, "INVALID_JSON", "Request body must be valid JSON.");
  }

  const parsed = acceptSchema.safeParse(rawBody);
  if (!parsed.success) {
    return jsonError(400, "INVALID_TOKEN", "A valid invitation token is required.");
  }

  const tokenHash = createHash("sha256")
    .update(parsed.data.token, "utf8")
    .digest("hex");

  const { data: rpcResult, error: rpcError } = await auth.admin.rpc(
    "accept_billing_admin_invitation",
    {
      p_token_hash: tokenHash,
      p_user_id: auth.user.id,
      p_user_email: auth.user.email,
    },
  );

  if (rpcError) {
    const msg = String(rpcError.message || "");
    if (
      rpcError.code === "23505" ||
      rpcError.code === "P0001" ||
      msg.includes("ORGANIZATION_SEAT_LIMIT_REACHED")
    ) {
      return jsonError(
        429,
        "ORGANIZATION_SEAT_LIMIT_REACHED",
        "This organization has reached its maximum seat limit. Ask the organization owner to upgrade.",
      );
    }
    return jsonError(500, "INVITATION_ACCEPT_FAILED", "Unable to accept invitation.");
  }

  const result = (rpcResult || {}) as {
    ok?: boolean;
    error?: string;
    organization_id?: string;
    role?: string;
    can_manage_billing?: boolean;
  };

  if (!result.ok) {
    const code = result.error || "INVITATION_INVALID";
    const statusMap: Record<string, number> = {
      INVITATION_NOT_FOUND: 404,
      INVITATION_NOT_PENDING: 409,
      INVITATION_EXPIRED: 410,
      EMAIL_MISMATCH: 403,
      MEMBER_SUSPENDED: 403,
    };
    return jsonError(
      statusMap[code] || 400,
      code,
      code === "EMAIL_MISMATCH"
        ? "This invitation was issued for a different email address."
        : code === "INVITATION_EXPIRED"
          ? "This invitation has expired. Ask the organization owner for a new invitation."
          : "This invitation is no longer valid.",
    );
  }

  if (result.organization_id && result.organization_id !== id) {
    return jsonError(403, "ORGANIZATION_MISMATCH", "Invitation does not belong to this organization.");
  }

  return NextResponse.json({
    data: {
      accepted: true,
      organizationId: result.organization_id || id,
      role: result.role || "admin",
      canManageBilling: Boolean(result.can_manage_billing ?? true),
    },
  });
}
