"use client";

import * as React from "react";
import { FileText, Printer, X } from "lucide-react";
import { formatMinorCurrency } from "@/features/catalog/plans";

interface InvoiceRecord {
  id: string;
  invoiceNumber: string;
  documentType?: "payment_receipt" | "tax_invoice";
  planName?: string;
  planDescription?: string;
  quantity?: number;
  subtotalMinor?: number;
  taxAmountMinor?: number;
  discountAmountMinor?: number;
  amountMinor: number;
  refundedAmountMinor: number;
  currency: string;
  status: string;
  paidAt: string;
  periodStart?: string | null;
  periodEnd?: string | null;
  providerPaymentId: string;
  sellerDetails?: {
    name?: string;
    domain?: string;
    supportEmail?: string;
    address?: string;
    taxRegistrationId?: string;
  };
  customerDetails?: {
    organizationName?: string;
    billingName?: string;
    billingEmail?: string;
    companyName?: string;
    taxId?: string;
    addressLine1?: string;
    city?: string;
    stateRegion?: string;
    postalCode?: string;
    countryCode?: string;
  };
}

export default function AccountInvoicesPage() {
  const [invoices, setInvoices] = React.useState<InvoiceRecord[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [selectedInvoice, setSelectedInvoice] =
    React.useState<InvoiceRecord | null>(null);

  React.useEffect(() => {
    async function load() {
      try {
        const res = await fetch("/api/v1/billing/invoices", {
          cache: "no-store",
        });
        if (res.ok) {
          const body = await res.json();
          setInvoices(body.data?.invoices || []);
        }
      } finally {
        setLoading(false);
      }
    }
    void load();
  }, []);

  return (
    <div className="space-y-8">
      <div>
        <span className="text-xs font-mono font-bold uppercase tracking-widest text-[#69736C]">
          Accounting &amp; Payment Statements
        </span>
        <h1 className="text-2xl sm:text-3xl font-extrabold text-[#3F434C] mt-1">
          Invoices &amp; Official Receipts
        </h1>
        <p className="text-xs text-[#69736C] mt-1">
          View and print verified payment receipts and billing statements for your organization&apos;s Asiyst Plan subscriptions.
        </p>
      </div>

      <div className="rounded-2xl border border-[#D0CCC6] bg-[#FCFCFD] overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-xs text-[#69736C]">
            Loading billing documents...
          </div>
        ) : invoices.length === 0 ? (
          <div className="p-10 text-center space-y-2">
            <FileText className="h-8 w-8 text-[#69736C] mx-auto" />
            <p className="text-sm font-bold text-[#3F434C]">
              No billing receipts generated yet
            </p>
            <p className="text-xs text-[#69736C] max-w-md mx-auto">
              Asiyst Zero ($0) does not generate recurring charges. Verified payment receipts for Pulse, Vector, and Quantum appear here automatically once payment is confirmed.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-[#D0CCC6] bg-[#F9F9F9]">
                  <th className="py-3.5 px-5 font-bold text-[#3F434C]">
                    Document #
                  </th>
                  <th className="py-3.5 px-5 font-bold text-[#3F434C]">Type</th>
                  <th className="py-3.5 px-5 font-bold text-[#3F434C]">Plan</th>
                  <th className="py-3.5 px-5 font-bold text-[#3F434C]">Date</th>
                  <th className="py-3.5 px-5 font-bold text-[#3F434C]">
                    Payment Reference
                  </th>
                  <th className="py-3.5 px-5 font-bold text-[#3F434C]">Status</th>
                  <th className="py-3.5 px-5 font-bold text-[#3F434C] text-right">
                    Total
                  </th>
                  <th className="py-3.5 px-5 font-bold text-[#3F434C] text-right">
                    Action
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#D0CCC6]/60">
                {invoices.map((inv) => (
                  <tr key={inv.id} className="hover:bg-[#F9F9F9]/60">
                    <td className="py-3.5 px-5 font-mono font-bold text-[#3F434C]">
                      {inv.invoiceNumber}
                    </td>
                    <td className="py-3.5 px-5 text-[#69736C]">
                      {inv.documentType === "tax_invoice"
                        ? "Tax Invoice"
                        : "Payment Receipt"}
                    </td>
                    <td className="py-3.5 px-5 font-semibold text-[#3F434C]">
                      {inv.planName || "Asiyst Subscription"}
                    </td>
                    <td className="py-3.5 px-5 font-mono text-[#69736C]">
                      {new Date(inv.paidAt).toISOString().slice(0, 10)}
                    </td>
                    <td className="py-3.5 px-5 font-mono text-[#69736C]">
                      {inv.providerPaymentId}
                    </td>
                    <td className="py-3.5 px-5">
                      <span className="rounded-full bg-[#C6F36A]/40 px-2.5 py-0.5 text-[10px] font-bold uppercase text-[#171D1B]">
                        {inv.status}
                      </span>
                    </td>
                    <td className="py-3.5 px-5 text-right font-bold text-[#3F434C]">
                      {formatMinorCurrency(inv.amountMinor, inv.currency, true)}
                    </td>
                    <td className="py-3.5 px-5 text-right">
                      <button
                        type="button"
                        onClick={() => setSelectedInvoice(inv)}
                        className="inline-flex items-center gap-1 rounded-lg border border-[#3F434C] px-2.5 py-1 text-[11px] font-bold text-[#3F434C] hover:bg-[#D0CCC6]/30 transition cursor-pointer"
                      >
                        <Printer className="h-3 w-3" />
                        <span>View / Print</span>
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {selectedInvoice && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4"
        >
          <div className="w-full max-w-2xl rounded-2xl border-2 border-[#171D1B] bg-[#FCFCFD] p-6 sm:p-8 shadow-xl space-y-6 max-h-[90vh] overflow-y-auto">
            <div className="flex items-start justify-between border-b border-[#D0CCC6] pb-4">
              <div>
                <span className="text-[11px] font-mono font-bold uppercase tracking-widest text-[#69736C]">
                  {selectedInvoice.documentType === "tax_invoice"
                    ? "Official Tax Invoice"
                    : "Official Payment Receipt"}
                </span>
                <h2 className="text-xl font-extrabold text-[#171D1B] mt-0.5">
                  {selectedInvoice.invoiceNumber}
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setSelectedInvoice(null)}
                className="rounded-lg p-1.5 text-[#69736C] hover:bg-[#D0CCC6]/30 hover:text-[#171D1B]"
                aria-label="Close receipt dialog"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 text-xs">
              <div className="space-y-1">
                <p className="font-bold uppercase tracking-wider text-[#69736C] text-[10px]">
                  Issued By
                </p>
                <p className="font-bold text-[#171D1B]">
                  {selectedInvoice.sellerDetails?.name || "Asiyst"}
                </p>
                {selectedInvoice.sellerDetails?.address && (
                  <p className="text-[#69736C]">
                    {selectedInvoice.sellerDetails.address}
                  </p>
                )}
                {selectedInvoice.sellerDetails?.taxRegistrationId && (
                  <p className="font-mono text-[#69736C]">
                    Tax Reg: {selectedInvoice.sellerDetails.taxRegistrationId}
                  </p>
                )}
                <p className="text-[#69736C]">
                  {selectedInvoice.sellerDetails?.supportEmail ||
                    "support@asiyst.com"}
                </p>
              </div>

              <div className="space-y-1">
                <p className="font-bold uppercase tracking-wider text-[#69736C] text-[10px]">
                  Billed To
                </p>
                <p className="font-bold text-[#171D1B]">
                  {selectedInvoice.customerDetails?.companyName ||
                    selectedInvoice.customerDetails?.organizationName ||
                    "Verified Organization"}
                </p>
                {selectedInvoice.customerDetails?.billingEmail && (
                  <p className="text-[#69736C]">
                    {selectedInvoice.customerDetails.billingEmail}
                  </p>
                )}
                {selectedInvoice.customerDetails?.taxId && (
                  <p className="font-mono text-[#69736C]">
                    Customer Tax ID: {selectedInvoice.customerDetails.taxId}
                  </p>
                )}
              </div>
            </div>

            <div className="rounded-xl border border-[#D0CCC6] bg-[#F9F9F9] p-4 space-y-2.5 text-xs">
              <div className="flex justify-between">
                <span className="text-[#69736C]">Description</span>
                <span className="font-bold text-[#171D1B]">
                  {selectedInvoice.planDescription ||
                    `${selectedInvoice.planName || "Asiyst Plan"} (Qty: ${selectedInvoice.quantity || 1})`}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-[#69736C]">Payment Date</span>
                <span className="font-mono text-[#171D1B]">
                  {new Date(selectedInvoice.paidAt).toISOString().slice(0, 10)}
                </span>
              </div>
              {selectedInvoice.periodStart && selectedInvoice.periodEnd && (
                <div className="flex justify-between">
                  <span className="text-[#69736C]">Billing Period</span>
                  <span className="font-mono text-[#171D1B]">
                    {selectedInvoice.periodStart.slice(0, 10)} →{" "}
                    {selectedInvoice.periodEnd.slice(0, 10)}
                  </span>
                </div>
              )}
              <div className="flex justify-between">
                <span className="text-[#69736C]">Payment Reference</span>
                <span className="font-mono text-[#171D1B]">
                  {selectedInvoice.providerPaymentId}
                </span>
              </div>
              <div className="border-t border-[#D0CCC6] pt-2.5 flex justify-between">
                <span className="text-[#69736C]">Subtotal</span>
                <span className="font-semibold text-[#171D1B]">
                  {formatMinorCurrency(
                    selectedInvoice.subtotalMinor ?? selectedInvoice.amountMinor,
                    selectedInvoice.currency,
                    true,
                  )}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-[#69736C]">Tax</span>
                <span className="font-semibold text-[#171D1B]">
                  {formatMinorCurrency(
                    selectedInvoice.taxAmountMinor ?? 0,
                    selectedInvoice.currency,
                    true,
                  )}
                </span>
              </div>
              {selectedInvoice.refundedAmountMinor > 0 && (
                <div className="flex justify-between text-amber-900">
                  <span>Refunded</span>
                  <span className="font-semibold">
                    -
                    {formatMinorCurrency(
                      selectedInvoice.refundedAmountMinor,
                      selectedInvoice.currency,
                      true,
                    )}
                  </span>
                </div>
              )}
              <div className="border-t border-[#D0CCC6] pt-2.5 flex justify-between text-sm font-extrabold text-[#171D1B]">
                <span>Total Paid ({selectedInvoice.currency})</span>
                <span>
                  {formatMinorCurrency(
                    selectedInvoice.amountMinor,
                    selectedInvoice.currency,
                    true,
                  )}
                </span>
              </div>
            </div>

            <div className="flex justify-end gap-3">
              <button
                type="button"
                onClick={() => window.print()}
                className="inline-flex items-center gap-2 rounded-xl bg-[#171D1B] px-4 py-2.5 text-xs font-bold text-[#FCFCFD] hover:bg-[#2d3431] transition cursor-pointer"
              >
                <Printer className="h-3.5 w-3.5 text-[#C6F36A]" />
                <span>Print / Save as PDF</span>
              </button>
              <button
                type="button"
                onClick={() => setSelectedInvoice(null)}
                className="rounded-xl border border-[#3F434C] px-4 py-2.5 text-xs font-bold text-[#3F434C] hover:bg-[#D0CCC6]/30 transition cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
