import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import {
  enforceRateLimit,
  jsonError,
  requireAuthenticatedUser,
  resolveUserOrganizationAccess,
} from "@/lib/auth/session";
import { verifyBillingContactVerificationToken } from "../route";

const verifySchema = z.object({
  token: z.string().trim().min(10).max(1024),
});

type Context = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, context: Context) {
  const rateLimited = enforceRateLimit(request, 10, "billing-contact-verify");
  if (rateLimited) return rateLimited;

  const auth = await requireAuthenticatedUser(request);
  if ("error" in auth) return auth.error;

  const { id } = await context.params;
  const orgAccess = await resolveUserOrganizationAccess(
    auth.admin,
    auth.user.id,
    id,
    false,
  );
  if ("error" in orgAccess) return orgAccess.error;

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return jsonError(400, "INVALID_JSON", "Request body must be valid JSON.");
  }

  const parsed = verifySchema.safeParse(rawBody);
  if (!parsed.success) {
    return jsonError(400, "INVALID_TOKEN", "A valid verification token is required.");
  }

  const verified = verifyBillingContactVerificationToken(parsed.data.token);
  if (!verified.valid) {
    return jsonError(400, "INVALID_VERIFICATION_TOKEN", verified.error);
  }

  if (verified.organizationId !== id) {
    return jsonError(403, "ORGANIZATION_MISMATCH", "Verification token does not match this organization.");
  }

  const { data: updated, error } = await auth.admin
    .from("organization_billing_contacts")
    .update({
      email_verified: true,
      verified_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("organization_id", id)
    .ilike("billing_email", verified.email)
    .select("*")
    .maybeSingle();

  if (error || !updated) {
    return jsonError(
      404,
      "CONTACT_NOT_FOUND",
      "No matching billing contact record found for verification.",
    );
  }

  await auth.admin.from("audit_logs").insert({
    organization_id: id,
    user_id: auth.user.id,
    action: "organization.billing_contact_verified",
    resource_type: "organization_billing_contact",
    resource_id: updated.id,
    metadata: { billing_email: verified.email },
  });

  return NextResponse.json({
    data: {
      verified: true,
      billingContact: updated,
    },
  });
}
