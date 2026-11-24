"use client";

import * as React from "react";
import { FileText } from "lucide-react";
import { formatMinorCurrency } from "@/features/catalog/plans";

interface InvoiceRecord {
  id: string;
  invoiceNumber: string;
  providerPaymentId: string;
  amountMinor: number;
  refundedAmountMinor: number;
  currency: string;
  status: string;
  paidAt: string;
}

export default function AccountInvoicesPage() {
  const [invoices, setInvoices] = React.useState<InvoiceRecord[]>([]);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    async function load() {
      try {
        const res = await fetch("/api/v1/billing/invoices");
        if (res.ok) {
          const body = await res.json();
          setInvoices(body.data?.invoices || []);
        }
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  return (
    <div className="space-y-8">
      <div>
        <span className="text-xs font-mono font-bold uppercase tracking-widest text-[#69736C]">
          Tax &amp; Accounting Records
        </span>
        <h1 className="text-2xl sm:text-3xl font-extrabold text-[#3F434C] mt-1">
          Invoices &amp; Official Receipts
        </h1>
        <p className="text-xs text-[#69736C] mt-1">
          Access verified billing statements and receipts for your organization&apos;s Asiyst Plan subscriptions.
        </p>
      </div>

      <div className="rounded-2xl border border-[#D0CCC6] bg-[#FCFCFD] overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-xs text-[#69736C]">
            Loading invoices...
          </div>
        ) : invoices.length === 0 ? (
          <div className="p-10 text-center space-y-2">
            <FileText className="h-8 w-8 text-[#69736C] mx-auto" />
            <p className="text-sm font-bold text-[#3F434C]">
              No invoices generated yet
            </p>
            <p className="text-xs text-[#69736C] max-w-md mx-auto">
              Asiyst Zero ($0) does not generate recurring invoices. Invoices and receipts for Pulse, Vector, and Quantum appear here automatically upon verified payment.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-[#D0CCC6] bg-[#F9F9F9]">
                  <th className="py-3.5 px-5 font-bold text-[#3F434C]">
                    Invoice #
                  </th>
                  <th className="py-3.5 px-5 font-bold text-[#3F434C]">Date</th>
                  <th className="py-3.5 px-5 font-bold text-[#3F434C]">
                    Provider Reference
                  </th>
                  <th className="py-3.5 px-5 font-bold text-[#3F434C]">Status</th>
                  <th className="py-3.5 px-5 font-bold text-[#3F434C] text-right">
                    Amount
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#D0CCC6]/60">
                {invoices.map((inv) => (
                  <tr key={inv.id} className="hover:bg-[#F9F9F9]/60">
                    <td className="py-3.5 px-5 font-mono font-bold text-[#3F434C]">
                      {inv.invoiceNumber}
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
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
