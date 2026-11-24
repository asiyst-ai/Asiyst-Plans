import Link from "next/link";
import {
  ArrowRight,
  CheckCircle2,
  ShieldCheck,
  Sparkles,
  CreditCard,
} from "lucide-react";
import { PlanNavbar, PlanFooter } from "@/components/navigation";
import {
  PlanCardsGrid,
  DynamicComparisonTable,
  CommercialRulesCallout,
} from "@/components/plan-catalog-ui";

const FAQ_ITEMS = [
  {
    q: "When do my purchased plan benefits activate in Asiyst-WEB?",
    a: "Paid plan benefits activate automatically as soon as your payment is confirmed through our verified backend webhook. Simply returning to a success URL or creating a pending checkout never unlocks paid quotas prematurely.",
  },
  {
    q: "Does my subscription belong to a single project or my whole organization?",
    a: "Your organization owns the subscription. All projects belonging to your organization inherit your active plan entitlements—up to 1 project on Zero and Pulse, up to 3 projects on Vector, and up to 10 projects on Quantum.",
  },
  {
    q: "Are AI Credits or AI token balances included in Pulse, Vector, or Quantum?",
    a: "No. No subscription plan includes AI Credits, token balances, or guaranteed model inference messages. You can connect your own AI provider keys (BYOK) at zero markup or purchase AI Credits separately in Asiyst-WEB.",
  },
  {
    q: "What happens to my projects and files if I downgrade or cancel?",
    a: "When you downgrade or cancel, you retain full paid access until the end of your current monthly billing period. When the lower tier becomes effective, existing projects, knowledge files, and avatars are never automatically deleted—new operations are simply governed by your new tier's limits.",
  },
  {
    q: "Do I need an Asiyst account before purchasing a subscription?",
    a: "Yes. You can browse and compare all plans freely, and before completing payment or activating a plan, you must sign in with your Asiyst account so the subscription attaches to your organization.",
  },
];

export default function HomePage() {
  return (
    <div className="min-h-screen flex flex-col bg-[#F9F9F9] text-[#3F434C]">
      <PlanNavbar />

      <main className="flex-1">
        {/* Hero Section */}
        <section className="relative overflow-hidden border-b border-[#D0CCC6] bg-[#FCFCFD] py-16 sm:py-24">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <div className="mx-auto max-w-3xl text-center space-y-6">
              <div className="inline-flex items-center gap-2 rounded-full border border-[#D0CCC6] bg-[#F9F9F9] px-3.5 py-1.5 text-xs font-semibold text-[#3F434C]">
                <span className="h-2 w-2 rounded-full bg-[#C6F36A] ring-2 ring-[#3F434C]" />
                <span>Central Asiyst Subscription &amp; Entitlement Platform</span>
              </div>

              <h1 className="text-4xl font-extrabold tracking-tight text-[#3F434C] sm:text-5xl lg:text-6xl leading-tight">
                Your Asiyst subscriptions, all in one place.
              </h1>

              <p className="text-base sm:text-lg text-[#69736C] leading-relaxed">
                Explore Asiyst plans, unlock the capabilities you need, and manage your subscriptions from one account.
              </p>

              <div className="flex flex-wrap items-center justify-center gap-4 pt-2">
                <a
                  href="#official-plans"
                  className="inline-flex items-center gap-2 rounded-xl bg-[#3F434C] px-6 py-3 text-sm font-bold text-[#FCFCFD] hover:bg-[#2b2e35] transition shadow-sm"
                >
                  <span>Explore plans</span>
                  <ArrowRight className="h-4 w-4 text-[#C6F36A]" />
                </a>
                <Link
                  href="/account/subscriptions"
                  className="inline-flex items-center gap-2 rounded-xl border border-[#3F434C] bg-[#F9F9F9] px-6 py-3 text-sm font-bold text-[#3F434C] hover:bg-[#D0CCC6]/30 transition"
                >
                  <span>Manage subscriptions</span>
                </Link>
              </div>
            </div>
          </div>
        </section>

        {/* Product Overview Bar */}
        <section className="border-b border-[#D0CCC6] bg-[#F9F9F9] py-8">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <div className="grid grid-cols-1 gap-6 sm:grid-cols-3">
              <div className="flex items-center gap-3.5 rounded-xl border border-[#D0CCC6] bg-[#FCFCFD] p-4">
                <Sparkles className="h-5 w-5 text-[#3F434C] shrink-0" />
                <div>
                  <div className="text-xs font-bold text-[#3F434C]">
                    Asiyst AI Platform
                  </div>
                  <div className="text-[11px] text-[#69736C]">
                    3D Website Assistant, Knowledge Engine &amp; Avatar Studio
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-3.5 rounded-xl border border-[#D0CCC6] bg-[#FCFCFD] p-4">
                <ShieldCheck className="h-5 w-5 text-[#3F434C] shrink-0" />
                <div>
                  <div className="text-xs font-bold text-[#3F434C]">
                    Verified Entitlement Activation
                  </div>
                  <div className="text-[11px] text-[#69736C]">
                    Synchronized directly with Asiyst-WEB after payment verification
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-3.5 rounded-xl border border-[#D0CCC6] bg-[#FCFCFD] p-4">
                <CreditCard className="h-5 w-5 text-[#3F434C] shrink-0" />
                <div>
                  <div className="text-xs font-bold text-[#3F434C]">
                    Transparent Monthly Billing
                  </div>
                  <div className="text-[11px] text-[#69736C]">
                    Upgrade, downgrade, cancel, or reactivate anytime
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Official 4 Plans Section */}
        <section id="official-plans" className="py-16">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 space-y-10">
            <div className="text-center max-w-2xl mx-auto space-y-2">
              <span className="text-xs font-mono font-bold uppercase tracking-widest text-[#69736C]">
                Official Commercial Catalog
              </span>
              <h2 className="text-3xl font-extrabold tracking-tight text-[#3F434C]">
                Choose the right Asiyst AI plan for your organization
              </h2>
              <p className="text-sm text-[#69736C]">
                Start free with Asiyst Zero or unlock higher project capacity, knowledge files, scheduled recrawling, and Avatar Studio.
              </p>
            </div>

            <PlanCardsGrid />

            <CommercialRulesCallout />
          </div>
        </section>

        {/* Feature Comparison Table */}
        <section className="border-t border-[#D0CCC6] bg-[#FCFCFD] py-16">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 space-y-8">
            <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
              <div>
                <span className="text-xs font-mono font-bold uppercase tracking-widest text-[#69736C]">
                  Plan Matrix
                </span>
                <h2 className="text-2xl font-extrabold text-[#3F434C] mt-1">
                  Complete Feature &amp; Quota Comparison
                </h2>
              </div>
              <Link
                href="/products/asiyst-ai/plans"
                className="inline-flex items-center gap-1.5 text-xs font-bold text-[#3F434C] hover:underline"
              >
                <span>Open dedicated comparison view</span>
                <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </div>

            <DynamicComparisonTable />
          </div>
        </section>

        {/* Billing Information & FAQ */}
        <section className="border-t border-[#D0CCC6] bg-[#F9F9F9] py-16">
          <div className="mx-auto max-w-5xl px-4 sm:px-6 lg:px-8 space-y-10">
            <div className="text-center space-y-2">
              <h2 className="text-2xl font-extrabold text-[#3F434C]">
                Frequently Asked Questions &amp; Subscription Policy
              </h2>
              <p className="text-xs text-[#69736C]">
                How organization subscriptions, payment verification, and Asiyst-WEB entitlements work together.
              </p>
            </div>

            <div className="grid grid-cols-1 gap-4">
              {FAQ_ITEMS.map((item) => (
                <div
                  key={item.q}
                  className="rounded-2xl border border-[#D0CCC6] bg-[#FCFCFD] p-6 space-y-2"
                >
                  <h3 className="text-sm font-bold text-[#3F434C] flex items-center gap-2">
                    <CheckCircle2 className="h-4 w-4 text-[#3F434C] shrink-0" />
                    <span>{item.q}</span>
                  </h3>
                  <p className="text-xs leading-relaxed text-[#69736C] pl-6">
                    {item.a}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </section>
      </main>

      <PlanFooter />
    </div>
  );
}
