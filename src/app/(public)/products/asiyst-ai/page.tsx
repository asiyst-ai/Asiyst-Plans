import Link from "next/link";
import { ArrowRight, Sparkles } from "lucide-react";
import { PlanNavbar, PlanFooter } from "@/components/navigation";
import {
  PlanCardsGrid,
  CommercialRulesCallout,
} from "@/components/plan-catalog-ui";

export default function AsiystAiProductPage() {
  return (
    <div className="min-h-screen flex flex-col bg-[#F9F9F9] text-[#3F434C]">
      <PlanNavbar />

      <main className="flex-1 mx-auto w-full max-w-7xl px-4 py-12 sm:px-6 lg:px-8 space-y-12">
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 border-b border-[#D0CCC6] pb-8">
          <div className="space-y-3">
            <div className="inline-flex items-center gap-2 rounded-full border border-[#D0CCC6] bg-[#FCFCFD] px-3 py-1 text-xs font-semibold text-[#3F434C]">
              <Sparkles className="h-3.5 w-3.5 text-[#3F434C]" />
              <span>Product · Asiyst AI</span>
            </div>
            <h1 className="text-3xl font-extrabold tracking-tight text-[#3F434C] sm:text-4xl">
              Asiyst AI Subscription Plans
            </h1>
            <p className="text-sm text-[#69736C] max-w-2xl leading-relaxed">
              Power your websites with interactive 3D AI assistants, automated website crawling and indexing, and Avatar Studio. Select a monthly subscription for your organization below.
            </p>
          </div>

          <Link
            href="/products/asiyst-ai/plans"
            className="inline-flex items-center gap-2 rounded-xl border border-[#3F434C] bg-[#FCFCFD] px-4 py-2.5 text-xs font-bold text-[#3F434C] hover:bg-[#D0CCC6]/30 transition"
          >
            <span>Compare All Plan Limits</span>
            <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>

        <PlanCardsGrid />

        <CommercialRulesCallout />
      </main>

      <PlanFooter />
    </div>
  );
}
