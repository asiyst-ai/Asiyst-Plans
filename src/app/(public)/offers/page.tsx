import Link from "next/link";
import { ArrowRight, CheckCircle2, ShieldCheck } from "lucide-react";
import { PlanNavbar, PlanFooter } from "@/components/navigation";
import {
  DynamicComparisonTable,
  CommercialRulesCallout,
} from "@/components/plan-catalog-ui";

export default function OffersAndBenefitsPage() {
  return (
    <div className="min-h-screen flex flex-col bg-[#F9F9F9] text-[#3F434C]">
      <PlanNavbar />

      <main className="flex-1 mx-auto w-full max-w-7xl px-4 py-12 sm:px-6 lg:px-8 space-y-12">
        <div className="rounded-3xl border border-[#D0CCC6] bg-[#FCFCFD] p-8 space-y-6">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
            <div className="space-y-2 max-w-2xl">
              <span className="text-xs font-mono font-bold uppercase tracking-widest text-[#69736C]">
                Entitlement Guarantee
              </span>
              <h1 className="text-2xl sm:text-3xl font-extrabold text-[#3F434C]">
                Verified Organization Entitlements &amp; Plan Benefits
              </h1>
              <p className="text-xs sm:text-sm text-[#69736C] leading-relaxed">
                Every Asiyst Plan subscription is backed by our central database entitlement engine. When your organization subscribes or upgrades, your purchased benefits activate in Asiyst-WEB immediately after your payment is confirmed.
              </p>
            </div>

            <Link
              href="/checkout?plan=vector"
              className="inline-flex items-center gap-2 rounded-xl bg-[#3F434C] px-5 py-3 text-xs font-bold text-[#FCFCFD] hover:bg-[#2a2d33] transition shrink-0"
            >
              <span>Choose Asiyst Vector ($54/mo)</span>
              <ArrowRight className="h-4 w-4 text-[#C6F36A]" />
            </Link>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3 pt-4 border-t border-[#D0CCC6]">
            <div className="flex items-start gap-2.5 text-xs">
              <CheckCircle2 className="h-4 w-4 text-[#3F434C] shrink-0 mt-0.5" />
              <span>
                <strong>Instant Zero Activation:</strong> Asiyst Zero ($0) activates immediately without payment checkout.
              </span>
            </div>
            <div className="flex items-start gap-2.5 text-xs">
              <ShieldCheck className="h-4 w-4 text-[#3F434C] shrink-0 mt-0.5" />
              <span>
                <strong>Backend-Verified Paid Quotas:</strong> Paid benefits unlock only after cryptographic webhook verification.
              </span>
            </div>
            <div className="flex items-start gap-2.5 text-xs">
              <CheckCircle2 className="h-4 w-4 text-[#3F434C] shrink-0 mt-0.5" />
              <span>
                <strong>Zero Data Loss on Downgrade:</strong> Existing projects, files, and avatars are never automatically deleted.
              </span>
            </div>
          </div>
        </div>

        <DynamicComparisonTable />

        <CommercialRulesCallout />
      </main>

      <PlanFooter />
    </div>
  );
}
