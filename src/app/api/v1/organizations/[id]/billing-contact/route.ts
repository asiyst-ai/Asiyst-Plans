import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import {
  enforceRateLimit,
  jsonError,
  requireAuthenticatedUser,
  resolveUserOrganizationAccess,
} from "@/lib/auth/session";
import { enqueueBillingNotification } from "@/lib/email/outbox";

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
    },
  });
}
