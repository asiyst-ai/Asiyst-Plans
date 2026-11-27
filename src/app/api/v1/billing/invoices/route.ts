import { NextResponse, type NextRequest } from "next/server";
import {
  requireAuthenticatedUser,
  resolveUserOrganizationAccess,
} from "@/lib/auth/session";
import { buildInvoiceNumber } from "@/lib/payments/state-machine";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const auth = await requireAuthenticatedUser(request);
  if ("error" in auth) return auth.error;

  const requestedOrgId =
    request.nextUrl.searchParams.get("organizationId") ||
    auth.organizationId ||
    null;
  const orgAccess = await resolveUserOrganizationAccess(
    auth.admin,
    auth.user.id,
    requestedOrgId,
    true,
  );
  if ("error" in orgAccess) return orgAccess.error;

  const organizationId = orgAccess.organization.id;

  // Prefer structured `billing_invoices` table (Phase 8), with fallback to `billing_payments` for older records
  const [{ data: structuredInvoices }, { data: payments }] = await Promise.all([
    auth.admin
      .from("billing_invoices")
      .select("*")
      .eq("organization_id", organizationId)
      .order("issued_at", { ascending: false })
      .limit(50),
    auth.admin
      .from("billing_payments")
      .select("*")
      .eq("organization_id", organizationId)
      .in("status", ["succeeded", "refunded", "partially_refunded", "disputed"])
      .order("paid_at", { ascending: false })
      .limit(50),
  ]);

  if (structuredInvoices && structuredInvoices.length > 0) {
    const coveredPaymentIds = new Set(
      structuredInvoices
        .map((inv) => (inv.payment_id ? String(inv.payment_id) : ""))
        .filter(Boolean),
    );

    const mappedStructured = structuredInvoices.map((inv) => ({
      id: inv.id,
      invoiceNumber: inv.invoice_number,
      documentType: inv.document_type || "payment_receipt",
      organizationId: inv.organization_id,
      subscriptionId: inv.subscription_id,
      orderId: inv.order_id,
      paymentId: inv.payment_id,
      providerPaymentId: inv.provider_payment_id,
      planSlug: inv.plan_slug,
      planName: inv.plan_name,
      planDescription: inv.plan_description,
      quantity: inv.quantity || 1,
      subtotalMinor: Number(inv.subtotal_minor),
      taxAmountMinor: Number(inv.tax_amount_minor || 0),
      discountAmountMinor: Number(inv.discount_amount_minor || 0),
      amountMinor: Number(inv.total_amount_minor),
      refundedAmountMinor: Number(inv.refunded_amount_minor || 0),
      currency: inv.currency || "USD",
      status: inv.status,
      sellerDetails: inv.seller_details || {
        name: "Asiyst",
        domain: "https://plan.asiyst.com",
        supportEmail: "support@asiyst.com",
      },
      customerDetails: inv.customer_details || {
        organizationName: orgAccess.organization.name,
      },
      issuedAt: inv.issued_at,
      paidAt: inv.paid_at,
      periodStart: inv.period_start,
      periodEnd: inv.period_end,
    }));

    const legacyUnmapped = (payments || [])
      .filter((p) => !coveredPaymentIds.has(String(p.id)))
      .map((payment) => ({
        id: payment.id,
        invoiceNumber:
          payment.invoice_number ||
          buildInvoiceNumber(
            payment.paid_at || payment.created_at,
            String(payment.provider_payment_id || payment.id),
          ),
        documentType: "payment_receipt" as const,
        organizationId: payment.organization_id,
        subscriptionId: payment.subscription_id,
        orderId: payment.order_id,
        paymentId: payment.id,
        providerPaymentId: payment.provider_payment_id,
        planSlug: "pulse",
        planName: "Asiyst Subscription",
        planDescription: "Monthly Organization Subscription (Asiyst AI)",
        quantity: 1,
        subtotalMinor: Number(payment.amount_minor),
        taxAmountMinor: 0,
        discountAmountMinor: 0,
        amountMinor: Number(payment.amount_minor),
        refundedAmountMinor: Number(payment.refunded_amount_minor || 0),
        currency: payment.currency || "USD",
        status: payment.status === "succeeded" ? "paid" : payment.status,
        sellerDetails: {
          name: "Asiyst",
          domain: "https://plan.asiyst.com",
          supportEmail: "support@asiyst.com",
        },
        customerDetails: {
          organizationName: orgAccess.organization.name,
        },
        issuedAt: payment.paid_at || payment.created_at,
        paidAt: payment.paid_at || payment.created_at,
        periodStart: null,
        periodEnd: null,
      }));

    return NextResponse.json({
      data: {
        organization: orgAccess.organization,
        invoices: [...mappedStructured, ...legacyUnmapped],
      },
    });
  }

  const fallbackInvoices = (payments || []).map((payment) => ({
    id: payment.id,
    invoiceNumber:
      payment.invoice_number ||
      buildInvoiceNumber(
        payment.paid_at || payment.created_at,
        String(payment.provider_payment_id || payment.id),
      ),
    documentType: "payment_receipt",
    organizationId: payment.organization_id,
    subscriptionId: payment.subscription_id,
    orderId: payment.order_id,
    paymentId: payment.id,
    providerPaymentId: payment.provider_payment_id,
    planSlug: "pulse",
    planName: "Asiyst Subscription",
    planDescription: "Monthly Organization Subscription (Asiyst AI)",
    quantity: 1,
    subtotalMinor: Number(payment.amount_minor),
    taxAmountMinor: 0,
    discountAmountMinor: 0,
    amountMinor: Number(payment.amount_minor),
    refundedAmountMinor: Number(payment.refunded_amount_minor || 0),
    currency: payment.currency || "USD",
    status: payment.status === "succeeded" ? "paid" : payment.status,
    sellerDetails: {
      name: "Asiyst",
      domain: "https://plan.asiyst.com",
      supportEmail: "support@asiyst.com",
    },
    customerDetails: {
      organizationName: orgAccess.organization.name,
    },
    issuedAt: payment.paid_at || payment.created_at,
    paidAt: payment.paid_at || payment.created_at,
    periodStart: null,
    periodEnd: null,
  }));

  return NextResponse.json({
    data: {
      organization: orgAccess.organization,
      invoices: fallbackInvoices,
    },
  });
}
