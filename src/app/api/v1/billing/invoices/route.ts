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

  const { data: payments } = await auth.admin
    .from("billing_payments")
    .select("*")
    .eq("organization_id", orgAccess.organization.id)
    .in("status", ["succeeded", "refunded", "partially_refunded"])
    .order("paid_at", { ascending: false })
    .limit(50);

  const invoices = (payments || []).map((payment, index) => ({
    id: payment.id,
    invoiceNumber:
      payment.invoice_number ||
      `INV-${new Date(payment.created_at).getUTCFullYear()}-${String(index + 1).padStart(4, "0")}`,
    organizationId: payment.organization_id,
    subscriptionId: payment.subscription_id,
    providerPaymentId: payment.provider_payment_id,
    amountMinor: payment.amount_minor,
    refundedAmountMinor: payment.refunded_amount_minor || 0,
    currency: payment.currency || "USD",
    status: payment.status,
    paidAt: payment.paid_at || payment.created_at,
    receiptUrl: payment.receipt_url || `/account/invoices?paymentId=${payment.id}`,
  }));

  return NextResponse.json({
    data: {
      organization: orgAccess.organization,
      invoices,
    },
  });
}
