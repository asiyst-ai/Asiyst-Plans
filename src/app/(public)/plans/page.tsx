import { PlanNavbar, PlanFooter } from "@/components/navigation";
import {
  PlanCardsGrid,
  DynamicComparisonTable,
  CommercialRulesCallout,
} from "@/components/plan-catalog-ui";

export default function PlansPage() {
  return (
    <div className="min-h-screen flex flex-col bg-[#F9F9F9] text-[#3F434C]">
      <PlanNavbar />

      <main className="flex-1 mx-auto w-full max-w-7xl px-4 py-12 sm:px-6 lg:px-8 space-y-12">
        <div className="text-center max-w-3xl mx-auto space-y-3">
          <span className="text-xs font-mono font-bold uppercase tracking-widest text-[#69736C]">
            Official Subscription Plans
          </span>
          <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-[#3F434C]">
            Transparent Monthly Plans for Every Organization
          </h1>
          <p className="text-sm text-[#69736C]">
            Choose Asiyst Zero ($0), Pulse ($24/month), Vector ($54/month), or Quantum ($154/month). Upgrade, downgrade, or cancel anytime.
          </p>
        </div>

        <PlanCardsGrid />

        <DynamicComparisonTable />

        <CommercialRulesCallout />
      </main>

      <PlanFooter />
    </div>
  );
}
