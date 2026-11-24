import { PlanNavbar, PlanFooter } from "@/components/navigation";
import {
  PlanCardsGrid,
  DynamicComparisonTable,
  CommercialRulesCallout,
} from "@/components/plan-catalog-ui";

export default function AsiystAiPlansComparisonPage() {
  return (
    <div className="min-h-screen flex flex-col bg-[#F9F9F9] text-[#3F434C]">
      <PlanNavbar />

      <main className="flex-1 mx-auto w-full max-w-7xl px-4 py-12 sm:px-6 lg:px-8 space-y-12">
        <div className="space-y-2">
          <span className="text-xs font-mono font-bold uppercase tracking-widest text-[#69736C]">
            Asiyst AI · Official Commercial Plans
          </span>
          <h1 className="text-3xl font-extrabold tracking-tight text-[#3F434C]">
            Compare Asiyst Zero, Pulse, Vector &amp; Quantum
          </h1>
          <p className="text-sm text-[#69736C] max-w-2xl">
            Every organization subscription covers all eligible projects in your workspace. Paid benefits activate in Asiyst-WEB immediately after payment verification.
          </p>
        </div>

        <PlanCardsGrid />

        <div className="space-y-4">
          <h2 className="text-xl font-extrabold text-[#3F434C]">
            Side-by-Side Feature &amp; Limit Matrix
          </h2>
          <DynamicComparisonTable />
        </div>

        <CommercialRulesCallout />
      </main>

      <PlanFooter />
    </div>
  );
}
