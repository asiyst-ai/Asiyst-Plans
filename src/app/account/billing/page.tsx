"use client";

import * as React from "react";
import Link from "next/link";
import { CreditCard, FileText, ShieldCheck } from "lucide-react";
import { formatMinorCurrency } from "@/features/catalog/plans";
import { PLANS_ORG_CHANGE_EVENT, PLANS_ORG_STORAGE_KEY } from "../layout";

interface PaymentRecord {
  id: string;
  provider: string;
  provider_payment_id: string;
  amount_minor: number;
  refunded_amount_minor: number;
  currency: string;
  status: string;
  payment_type: string;
  paid_at: string | null;
  created_at: string;
}

export default function AccountBillingPage() {
  const [payments, setPayments] = React.useState<PaymentRecord[]>([]);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    async function load(explicitOrgId?: string | null) {
      const orgId =
        explicitOrgId ??
        (typeof window !== "undefined"
          ? window.localStorage.getItem(PLANS_ORG_STORAGE_KEY)
          : null);
      const qs = orgId ? `?organizationId=${encodeURIComponent(orgId)}` : "";
      try {
        const res = await fetch(`/api/v1/billing/payments${qs}`, { cache: "no-store" });
        if (res.ok) {
          const body = await res.json();
          setPayments(body.data?.payments || []);
        }
      } finally {
        setLoading(false);
      }
    }
    void load();
    const onOrgChange = (e: Event) => void load((e as CustomEvent<string>).detail);
    window.addEventListener(PLANS_ORG_CHANGE_EVENT, onOrgChange);
    return () => window.removeEventListener(PLANS_ORG_CHANGE_EVENT, onOrgChange);
  }, []);

  return (
    <div className="space-y-8">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <span className="text-xs font-mono font-bold uppercase tracking-widest text-[#69736C]">
            Organization Billing Ledger
          </span>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-[#3F434C] mt-1">
            Payment History &amp; Transactions
          </h1>
          <p className="text-xs text-[#69736C] mt-1">
            Verified subscription payments, transaction references, and refund records.
          </p>
        </div>

        <Link
          href="/account/invoices"
          className="inline-flex items-center gap-2 rounded-xl border border-[#3F434C] bg-[#FCFCFD] px-4 py-2.5 text-xs font-bold text-[#3F434C] hover:bg-[#D0CCC6]/30 transition"
        >
          <FileText className="h-3.5 w-3.5" />
          <span>View Invoices &amp; Receipts</span>
        </Link>
      </div>

      <div className="rounded-2xl border border-[#D0CCC6] bg-[#FCFCFD] overflow-hidden">
        <div className="border-b border-[#D0CCC6] bg-[#F9F9F9] px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CreditCard className="h-4 w-4 text-[#3F434C]" />
            <h2 className="text-sm font-bold text-[#3F434C]">
              Verified Transactions
            </h2>
          </div>
          <span className="text-xs font-mono text-[#69736C]">
            Currency: USD
          </span>
        </div>

        {loading ? (
          <div className="p-8 text-center text-xs text-[#69736C]">
            Loading payment history...
          </div>
        ) : payments.length === 0 ? (
          <div className="p-10 text-center space-y-2">
            <p className="text-sm font-bold text-[#3F434C]">
              No subscription payment transactions recorded yet
            </p>
            <p className="text-xs text-[#69736C] max-w-md mx-auto">
              When your organization completes a paid subscription checkout or renewal, verified transactions appear here automatically.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-[#D0CCC6] bg-[#F9F9F9]">
                  <th className="py-3.5 px-5 font-bold text-[#3F434C]">Date</th>
                  <th className="py-3.5 px-5 font-bold text-[#3F434C]">
                    Transaction Reference
                  </th>
                  <th className="py-3.5 px-5 font-bold text-[#3F434C]">Type</th>
                  <th className="py-3.5 px-5 font-bold text-[#3F434C]">Status</th>
                  <th className="py-3.5 px-5 font-bold text-[#3F434C] text-right">
                    Amount
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#D0CCC6]/60">
                {payments.map((payment) => (
                  <tr key={payment.id} className="hover:bg-[#F9F9F9]/60">
                    <td className="py-3.5 px-5 font-mono text-[#69736C]">
                      {new Date(payment.paid_at || payment.created_at)
                        .toISOString()
                        .slice(0, 10)}
                    </td>
                    <td className="py-3.5 px-5 font-mono text-[#3F434C]">
                      {payment.provider_payment_id}
                    </td>
                    <td className="py-3.5 px-5 text-[#3F434C]">
                      {payment.payment_type}
                    </td>
                    <td className="py-3.5 px-5">
                      <span className="rounded-full bg-[#C6F36A]/35 px-2.5 py-0.5 text-[10px] font-bold uppercase text-[#171D1B]">
                        {payment.status}
                      </span>
                    </td>
                    <td className="py-3.5 px-5 text-right font-bold text-[#3F434C]">
                      {formatMinorCurrency(
                        payment.amount_minor,
                        payment.currency,
                        true,
                      )}
                      {payment.refunded_amount_minor > 0 && (
                        <span className="block text-[10px] text-amber-800">
                          Refunded:{" "}
                          {formatMinorCurrency(
                            payment.refunded_amount_minor,
                            payment.currency,
                            true,
                          )}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="rounded-2xl border border-[#D0CCC6] bg-[#FCFCFD] p-5 flex items-start gap-3">
        <ShieldCheck className="h-5 w-5 text-[#3F434C] shrink-0 mt-0.5" />
        <p className="text-xs text-[#69736C] leading-relaxed">
          All monetary figures are stored and processed in integer USD minor units (cents). Complete card numbers and sensitive payment credentials are never stored on Asiyst servers.
        </p>
      </div>
    </div>
  );
}
