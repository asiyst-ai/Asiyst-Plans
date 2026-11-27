import { createHmac, timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import {
  enforceRateLimit,
  jsonError,
  requireAuthenticatedUser,
  resolveUserOrganizationAccess,
} from "@/lib/auth/session";
import { enqueueBillingNotification } from "@/lib/email/outbox";
import { PLAN_APP_BASE_URL } from "@/features/email-templates/templates";

const billingContactSchema = z.object({
  billingEmail: z.string().email().max(320),
  billingName: z.string().max(160).optional(),
  companyName: z.string().max(160).optional(),
  taxId: z.string().max(80).optional(),
  addressLine1: z.string().max(240).optional(),
  addressLine2: z.string().max(240).optional(),
  city: z.string().max(120).optional(),
  stateRegion: z.string().max(120).optional(),
  postalCode: z.string().max(40).optional(),
  countryCode: z.string().length(2).default("US"),
});

type Context = { params: Promise<{ id: string }> };

function getContactVerificationSecret(): string {
  return (
    process.env.BILLING_CONTACT_VERIFY_SECRET ||
    process.env.DODO_PAYMENTS_WEBHOOK_SECRET ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    "asiyst_billing_contact_verify_dev"
  ).trim();
}

export function signBillingContactVerificationToken(
  organizationId: string,
  billingEmail: string,
  expiresAtMs: number = Date.now() + 24 * 60 * 60 * 1000,
): string {
  const payload = Buffer.from(
    JSON.stringify({
      orgId: organizationId,
      email: billingEmail.trim().toLowerCase(),
      exp: expiresAtMs,
    }),
    "utf8",
  ).toString("base64url");
  const sig = createHmac("sha256", getContactVerificationSecret())
    .update(payload)
    .digest("base64url");
  return `${payload}.${sig}`;
}

export function verifyBillingContactVerificationToken(
  token: string,
): { valid: true; organizationId: string; email: string } | { valid: false; error: string } {
  const parts = token.split(".");
  if (parts.length !== 2) return { valid: false, error: "Malformed verification token." };
  const [payloadB64, sigB64] = parts;
  const expectedSig = createHmac("sha256", getContactVerificationSecret())
    .update(payloadB64)
    .digest("base64url");
  if (
    sigB64.length !== expectedSig.length ||
    !timingSafeEqual(Buffer.from(sigB64), Buffer.from(expectedSig))
  ) {
    return { valid: false, error: "Invalid verification token signature." };
  }
  try {
    const parsed = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf8")) as {
      orgId?: string;
      email?: string;
      exp?: number;
    };
    if (!parsed.orgId || !parsed.email || !parsed.exp || parsed.exp <= Date.now()) {
      return { valid: false, error: "Verification token has expired." };
    }
    return {
      valid: true,
      organizationId: parsed.orgId,
      email: parsed.email.trim().toLowerCase(),
    };
  } catch {
    return { valid: false, error: "Invalid verification token payload." };
  }
}

export async function POST(request: NextRequest, context: Context) {
  const rateLimited = enforceRateLimit(request, 10, "billing-contact-update");
  if (rateLimited) return rateLimited;

  const auth = await requireAuthenticatedUser(request);
  if ("error" in auth) return auth.error;

  const { id } = await context.params;
  const orgAccess = await resolveUserOrganizationAccess(
    auth.admin,
    auth.user.id,
    id,
    true, // Owner or Billing Admin required
  );
  if ("error" in orgAccess) return orgAccess.error;

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return jsonError(400, "INVALID_JSON", "Request body must be valid JSON.");
  }

  const parsed = billingContactSchema.safeParse(rawBody);
  if (!parsed.success) {
    return jsonError(400, "INVALID_INPUT", "Please provide a valid billing email and contact details.");
  }

  const normalizedEmail = parsed.data.billingEmail.trim().toLowerCase();
  const isSameAsVerifiedCaller =
    auth.user.emailConfirmed &&
    auth.user.email.trim().toLowerCase() === normalizedEmail;

  const { data: updatedContact, error } = await auth.admin
    .from("organization_billing_contacts")
    .upsert(
      {
        organization_id: id,
        billing_email: normalizedEmail,
        billing_name: parsed.data.billingName || null,
        company_name: parsed.data.companyName || orgAccess.organization.name,
        tax_id: parsed.data.taxId || null,
        address_line1: parsed.data.addressLine1 || null,
        address_line2: parsed.data.addressLine2 || null,
        city: parsed.data.city || null,
        state_region: parsed.data.stateRegion || null,
        postal_code: parsed.data.postalCode || null,
        country_code: parsed.data.countryCode.toUpperCase(),
        email_verified: isSameAsVerifiedCaller,
        verified_at: isSameAsVerifiedCaller ? new Date().toISOString() : null,
        updated_by: auth.user.id,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "organization_id" },
    )
    .select("*")
    .single();

  if (error) {
    return jsonError(500, "CONTACT_UPDATE_FAILED", "Unable to save billing contact.");
  }

  if (!isSameAsVerifiedCaller) {
    const verifyToken = signBillingContactVerificationToken(id, normalizedEmail);
    const verifyUrl = `${PLAN_APP_BASE_URL}/account/settings?verifyContact=${encodeURIComponent(verifyToken)}&orgId=${encodeURIComponent(id)}`;
    await enqueueBillingNotification(auth.admin, {
      organizationId: id,
      eventType: "billing.contact.verification",
      idempotencyKeyPrefix: `billing_contact_verify:${id}:${normalizedEmail}:${Date.now()}`,
      payload: {
        eventType: "billing.contact.verification",
        organizationName: orgAccess.organization.name,
        actionUrl: verifyUrl,
        actionLabel: "Verify Billing Email",
      },
      explicitRecipients: [{ email: normalizedEmail }],
    });
  }

  await enqueueBillingNotification(auth.admin, {
    organizationId: id,
    eventType: "billing.contact.changed",
    idempotencyKeyPrefix: `billing_contact:${id}:${Date.now()}`,
    payload: {
      eventType: "billing.contact.changed",
      organizationName: orgAccess.organization.name,
    },
  });

  return NextResponse.json({
    data: {
      billingContact: updatedContact,
      verificationRequired: !isSameAsVerifiedCaller,
    },
  });
}
