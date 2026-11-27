"use client";

import * as React from "react";
import Link from "next/link";
import { Check, ArrowRight, ShieldAlert, Building2 } from "lucide-react";
import { AsiystPlanLogoMark } from "@/components/brand-logo";
import {
  OFFICIAL_PLAN_LIST,
  PLAN_COMPARISON_ROWS,
  comparePlanRank,
  formatMinorCurrency,
  normalizeOfficialPlanSlug,
} from "@/features/catalog/plans";
import type { OfficialPlanDefinition, OfficialPlanSlug } from "@/types/billing";

interface PlanCardsProps {
  currentPlan?: OfficialPlanSlug | null;
  isPaidActive?: boolean;
}

export function PlanCardsGrid({
  currentPlan: initialCurrentPlan = null,
  isPaidActive: initialIsPaidActive = false,
}: PlanCardsProps) {
  const [currentPlan, setCurrentPlan] = React.useState<OfficialPlanSlug | null>(
    initialCurrentPlan,
  );
  const [isPaidActive, setIsPaidActive] = React.useState<boolean>(
    initialIsPaidActive,
  );
  const [selectedFromWeb, setSelectedFromWeb] =
    React.useState<OfficialPlanSlug | null>(null);

  React.useEffect(() => {
    let mounted = true;
    queueMicrotask(() => {
      if (!mounted || typeof window === "undefined") return;
      const params = new URLSearchParams(window.location.search);
      const rawSelected =
        params.get("selected") || params.get("plan") || params.get("highlight");
      const normalized = normalizeOfficialPlanSlug(rawSelected);
      if (normalized) {
        setSelectedFromWeb(normalized);
      }
    });

    fetch("/api/v1/subscriptions", { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => {
        if (!mounted || !json?.data) return;
        const activePlan = normalizeOfficialPlanSlug(
          json.data.entitlements?.plan ||
            json.data.effectiveEntitlements?.effectivePlanSlug,
        );
        if (activePlan) {
          setCurrentPlan(activePlan);
          setIsPaidActive(
            activePlan !== "zero" &&
              Boolean(
                json.data.entitlements?.isPaidActive ??
                  json.data.effectiveEntitlements?.isPaidActive,
              ),
          );
        }
      })
      .catch(() => {
        // Unauthenticated visitors simply see public catalog state
      });

    return () => {
      mounted = false;
    };
  }, []);

  function getCtaConfig(plan: OfficialPlanDefinition): {
    label: string;
    href: string;
    disabled?: boolean;
    variant: "primary" | "secondary" | "current";
  } {
    if (currentPlan && currentPlan === plan.slug) {
      if (plan.slug === "zero" || isPaidActive) {
        return {
          label: "Current plan",
          href: "/account/subscriptions",
          variant: "current",
        };
      }
    }

    if (currentPlan) {
      const diff = comparePlanRank(plan.slug, currentPlan);
      if (diff > 0) {
        return {
          label: `Upgrade to ${plan.name.replace("Asiyst ", "")}`,
          href: `/checkout?plan=${plan.slug}`,
          variant: "primary",
        };
      }
      if (diff < 0) {
        return {
          label: `Downgrade to ${plan.name.replace("Asiyst ", "")}`,
          href: `/account/subscriptions?action=downgrade&target=${plan.slug}`,
          variant: "secondary",
        };
      }
    }

    if (plan.slug === "zero") {
      return {
        label: "Get started",
        href: "/checkout?plan=zero",
        variant: "secondary",
      };
    }

    return {
      label: `Purchase ${plan.name.replace("Asiyst ", "")}`,
      href: `/checkout?plan=${plan.slug}`,
      variant:
        selectedFromWeb === plan.slug || plan.highlight
          ? "primary"
          : "secondary",
    };
  }

  const selectedPlanDef = selectedFromWeb
    ? OFFICIAL_PLAN_LIST.find((p) => p.slug === selectedFromWeb)
    : null;

  return (
    <div className="space-y-6">
      {selectedPlanDef && (
        <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border-2 border-[#3F434C] bg-[#FCFCFD] p-5 shadow-xs">
          <div className="flex items-start gap-3">
            <AsiystPlanLogoMark size={40} className="shrink-0" />
            <div>
              <p className="text-xs font-mono font-bold uppercase tracking-wider text-[#69736C]">
                Selected from Asiyst-WEB
              </p>
              <h3 className="text-base font-extrabold text-[#3F434C]">
                Ready to activate {selectedPlanDef.name} (
                {formatMinorCurrency(
                  selectedPlanDef.priceMinor,
                  selectedPlanDef.currency,
                )}
                {selectedPlanDef.billingInterval === "month"
                  ? "/month"
                  : " · Free"}
                )
              </h3>
              <p className="text-xs text-[#69736C] mt-0.5">
                Review the plan benefits below and continue to checkout. Your purchased benefits activate automatically in Asiyst-WEB once payment is verified.
              </p>
            </div>
          </div>
          <Link
            href={`/checkout?plan=${selectedPlanDef.slug}`}
            className="inline-flex items-center gap-2 rounded-xl bg-[#3F434C] px-5 py-2.5 text-xs font-bold text-[#FCFCFD] hover:bg-[#2a2d33] transition"
          >
            <span>
              Continue to purchase {selectedPlanDef.name.replace("Asiyst ", "")}
            </span>
            <ArrowRight className="h-3.5 w-3.5 text-[#C6F36A]" />
          </Link>
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-4">
        {OFFICIAL_PLAN_LIST.map((plan) => {
          const cta = getCtaConfig(plan);
          const priceDisplay = formatMinorCurrency(
            plan.priceMinor,
            plan.currency,
          );
          const isSelectedTarget = selectedFromWeb === plan.slug;
          const isHighlightedCard = isSelectedTarget || plan.highlight;

          return (
            <div
              key={plan.slug}
              className={`relative flex flex-col justify-between rounded-2xl border p-6 transition-all ${
                isHighlightedCard
                  ? "border-2 border-[#3F434C] bg-[#FCFCFD] shadow-md"
                  : "border-[#D0CCC6] bg-[#FCFCFD] shadow-xs hover:border-[#AAB6B0]"
              }`}
            >
              {(isSelectedTarget || plan.badge) && (
                <div className="absolute -top-3 left-6 rounded-full bg-[#C6F36A] px-3 py-0.5 text-[11px] font-bold uppercase tracking-wider text-[#171D1B] border border-[#3F434C]/20">
                  {isSelectedTarget ? "Selected Plan" : plan.badge}
                </div>
              )}

            <div>
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-bold text-[#3F434C]">{plan.name}</h3>
                <span className="rounded-md bg-[#F9F9F9] px-2 py-0.5 text-[11px] font-mono text-[#69736C] border border-[#D0CCC6]">
                  {plan.slug}
                </span>
              </div>
              <p className="mt-1.5 text-xs text-[#69736C] min-h-[32px]">
                {plan.subtitle}
              </p>

              <div className="mt-5 flex items-baseline gap-1 border-b border-[#D0CCC6] pb-5">
                <span className="text-4xl font-extrabold tracking-tight text-[#3F434C]">
                  {priceDisplay}
                </span>
                <span className="text-xs font-medium text-[#69736C]">
                  {plan.billingInterval === "month" ? "/month" : "Free forever"}
                </span>
              </div>

              <div className="mt-5 space-y-4">
                {plan.benefitGroups.map((group) => (
                  <div key={group.category} className="space-y-2">
                    <p className="text-[11px] font-bold uppercase tracking-wider text-[#3F434C]">
                      {group.category}
                    </p>
                    <ul className="space-y-1.5">
                      {group.items.map((item) => (
                        <li
                          key={item}
                          className="flex items-start gap-2 text-xs text-[#3F434C]"
                        >
                          <Check className="h-3.5 w-3.5 shrink-0 text-[#3F434C] mt-0.5 bg-[#C6F36A] rounded-full p-0.5" />
                          <span>{item}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </div>

            <div className="mt-6 pt-4 border-t border-[#D0CCC6]/60 space-y-2.5">
              <Link
                href={cta.href}
                className={`flex w-full items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-xs font-bold transition ${
                  cta.variant === "primary"
                    ? "bg-[#3F434C] text-[#FCFCFD] hover:bg-[#2a2d33]"
                    : cta.variant === "current"
                      ? "bg-[#C6F36A]/40 text-[#171D1B] border border-[#3F434C]"
                      : "border border-[#3F434C] bg-[#F9F9F9] text-[#3F434C] hover:bg-[#D0CCC6]/30"
                }`}
              >
                <span>{cta.label}</span>
                <ArrowRight className="h-3.5 w-3.5" />
              </Link>
              <p className="text-[10px] text-center text-[#69736C]">
                {plan.requiresDodoCheckout
                  ? "Monthly recurring subscription · Cancel anytime"
                  : "Instant activation · No payment required"}
              </p>
            </div>
          </div>
        );
      })}
      </div>
    </div>
  );
}

export function DynamicComparisonTable() {
  return (
    <div className="overflow-hidden rounded-2xl border border-[#D0CCC6] bg-[#FCFCFD] shadow-xs">
      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="border-b border-[#D0CCC6] bg-[#F9F9F9]">
              <th className="py-4 px-5 text-xs font-bold uppercase tracking-wider text-[#3F434C]">
                Feature / Capability
              </th>
              <th className="py-4 px-5 text-xs font-bold uppercase tracking-wider text-[#3F434C] text-right">
                Asiyst Zero ($0)
              </th>
              <th className="py-4 px-5 text-xs font-bold uppercase tracking-wider text-[#3F434C] text-right">
                Asiyst Pulse ($24/mo)
              </th>
              <th className="py-4 px-5 text-xs font-bold uppercase tracking-wider text-[#3F434C] text-right bg-[#C6F36A]/15">
                Asiyst Vector ($54/mo)
              </th>
              <th className="py-4 px-5 text-xs font-bold uppercase tracking-wider text-[#3F434C] text-right">
                Asiyst Quantum ($154/mo)
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#D0CCC6]/60 text-xs">
            {PLAN_COMPARISON_ROWS.map((row) => (
              <tr key={row.key} className="hover:bg-[#F9F9F9]/70 transition">
                <td className="py-3.5 px-5 font-semibold text-[#3F434C]">
                  <div>{row.feature}</div>
                  <div className="text-[10px] font-normal text-[#69736C]">
                    {row.category}
                  </div>
                </td>
                <td className="py-3.5 px-5 text-right text-[#3F434C]">
                  {row.values.zero.display}
                </td>
                <td className="py-3.5 px-5 text-right text-[#3F434C]">
                  {row.values.pulse.display}
                </td>
                <td className="py-3.5 px-5 text-right font-semibold text-[#171D1B] bg-[#C6F36A]/10">
                  {row.values.vector.display}
                </td>
                <td className="py-3.5 px-5 text-right font-semibold text-[#3F434C]">
                  {row.values.quantum.display}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function CommercialRulesCallout() {
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
      <div className="flex items-start gap-3.5 rounded-2xl border border-[#D0CCC6] bg-[#FCFCFD] p-5">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#3F434C] text-[#C6F36A]">
          <Building2 className="h-5 w-5" />
        </div>
        <div className="space-y-1">
          <h4 className="text-sm font-bold text-[#3F434C]">
            Organization-Owned Subscriptions
          </h4>
          <p className="text-xs leading-relaxed text-[#69736C]">
            Your workspace owns its subscription, covering all eligible projects (1 on Zero, up to 3 on Pulse, up to 10 on Vector, and Unlimited on Quantum across up to 10 workspaces). Entitlements activate automatically in Asiyst-WEB once payment is verified.
          </p>
        </div>
      </div>

      <div className="flex items-start gap-3.5 rounded-2xl border border-[#D0CCC6] bg-[#FCFCFD] p-5">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#3F434C] text-[#C6F36A]">
          <ShieldAlert className="h-5 w-5" />
        </div>
        <div className="space-y-1">
          <h4 className="text-sm font-bold text-[#3F434C]">
            AI Credits Are Separate From Subscriptions
          </h4>
          <p className="text-xs leading-relaxed text-[#69736C]">
            Subscription plans unlock platform capabilities, project quotas, knowledge capacity, and Avatar Studio. No subscription plan includes AI Credits, AI token balances, or guaranteed AI messages—AI Credits are managed independently or used via Bring Your Own Key (BYOK).
          </p>
        </div>
      </div>
    </div>
  );
}
