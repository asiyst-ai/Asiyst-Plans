import Link from "next/link";
import { ArrowRight, Sparkles } from "lucide-react";
import { PlanNavbar, PlanFooter } from "@/components/navigation";
import { OFFICIAL_PLAN_LIST, formatMinorCurrency } from "@/features/catalog/plans";

export default function ProductsCatalogPage() {
  return (
    <div className="min-h-screen flex flex-col bg-[#F9F9F9] text-[#3F434C]">
      <PlanNavbar />

      <main className="flex-1 mx-auto w-full max-w-7xl px-4 py-12 sm:px-6 lg:px-8 space-y-12">
        <div className="space-y-3">
          <span className="text-xs font-mono font-bold uppercase tracking-widest text-[#69736C]">
            Asiyst Product Directory
          </span>
          <h1 className="text-3xl font-extrabold tracking-tight text-[#3F434C]">
            Asiyst Products &amp; Subscription Suites
          </h1>
          <p className="text-sm text-[#69736C] max-w-2xl">
            Manage subscriptions across the Asiyst product ecosystem. Select a product below to inspect its plans, organization quotas, and feature tiers.
          </p>
        </div>

        <div className="rounded-3xl border-2 border-[#3F434C] bg-[#FCFCFD] p-8 shadow-sm space-y-8">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 border-b border-[#D0CCC6] pb-6">
            <div className="flex items-start gap-4">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-[#3F434C] text-[#C6F36A]">
                <Sparkles className="h-6 w-6" />
              </div>
              <div className="space-y-1">
                <div className="flex items-center gap-2.5">
                  <h2 className="text-2xl font-extrabold text-[#3F434C]">
                    Asiyst AI
                  </h2>
                  <span className="rounded-full bg-[#C6F36A] px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-[#171D1B]">
                    Flagship Product
                  </span>
                </div>
                <p className="text-xs text-[#69736C] max-w-2xl leading-relaxed">
                  Interactive 3D AI Website Assistant, Knowledge Indexing Engine, Avatar Studio, and Website Intelligence Platform for modern web applications, WordPress, and Shopify.
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <Link
                href="/products/asiyst-ai"
                className="inline-flex items-center gap-2 rounded-xl border border-[#3F434C] bg-[#F9F9F9] px-4 py-2.5 text-xs font-bold text-[#3F434C] hover:bg-[#D0CCC6]/30 transition"
              >
                <span>Product Details</span>
              </Link>
              <Link
                href="/products/asiyst-ai/plans"
                className="inline-flex items-center gap-2 rounded-xl bg-[#3F434C] px-5 py-2.5 text-xs font-bold text-[#FCFCFD] hover:bg-[#2a2d33] transition"
              >
                <span>View Asiyst AI Plans</span>
                <ArrowRight className="h-3.5 w-3.5 text-[#C6F36A]" />
              </Link>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {OFFICIAL_PLAN_LIST.map((plan) => (
              <div
                key={plan.slug}
                className="rounded-2xl border border-[#D0CCC6] bg-[#F9F9F9] p-5 flex flex-col justify-between space-y-4"
              >
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-bold text-[#3F434C]">
                      {plan.name}
                    </span>
                    <span className="text-sm font-extrabold text-[#3F434C]">
                      {formatMinorCurrency(plan.priceMinor)}
                      {plan.billingInterval === "month" ? "/mo" : ""}
                    </span>
                  </div>
                  <p className="text-[11px] text-[#69736C]">{plan.subtitle}</p>
                </div>

                <Link
                  href={`/checkout?plan=${plan.slug}`}
                  className="inline-flex items-center justify-between rounded-xl border border-[#D0CCC6] bg-[#FCFCFD] px-3.5 py-2 text-xs font-bold text-[#3F434C] hover:border-[#3F434C] transition"
                >
                  <span>
                    {plan.slug === "zero"
                      ? "Get started"
                      : `Choose ${plan.name.replace("Asiyst ", "")}`}
                  </span>
                  <ArrowRight className="h-3.5 w-3.5" />
                </Link>
              </div>
            ))}
          </div>
        </div>
      </main>

      <PlanFooter />
    </div>
  );
}
