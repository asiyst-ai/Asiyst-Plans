"use client";

import * as React from "react";
import Link from "next/link";
import { CheckCircle2, Lock, ArrowRight } from "lucide-react";
import { OFFICIAL_PLANS } from "@/features/catalog/plans";
import { computeEffectiveEntitlementsFromSubscription } from "@/features/entitlements/engine";
import type {
  EffectiveOrganizationEntitlements,
  OfficialPlanSlug,
} from "@/types/billing";

export default function AccountUsageAndEntitlementsPage() {
  const [entitlements, setEntitlements] =
    React.useState<EffectiveOrganizationEntitlements>(() =>
      computeEffectiveEntitlementsFromSubscription("preview_org", null),
    );

  React.useEffect(() => {
    async function load() {
      try {
        const res = await fetch("/api/v1/entitlements");
        if (res.ok) {
          const body = await res.json();
          if (body.data?.entitlements) {
            setEntitlements(body.data.entitlements);
          }
        }
      } catch {
        // Fallback to Zero preview
      }
    }
    load();
  }, []);

  const planDef = OFFICIAL_PLANS[entitlements.plan as OfficialPlanSlug];
  const featureEntries = Object.entries(entitlements.features);

  return (
    <div className="space-y-8">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <span className="text-xs font-mono font-bold uppercase tracking-widest text-[#69736C]">
            Central Entitlement Engine
          </span>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-[#3F434C] mt-1">
            Effective Organization Entitlements ({planDef.name})
          </h1>
          <p className="text-xs text-[#69736C] mt-1">
            Live feature flags and resource quotas inherited by all projects in your organization.
          </p>
        </div>

        <Link
          href="/plans"
          className="inline-flex items-center gap-2 rounded-xl bg-[#3F434C] px-4 py-2.5 text-xs font-bold text-[#FCFCFD] hover:bg-[#2a2d33] transition"
        >
          <span>Upgrade Plan Limits</span>
          <ArrowRight className="h-3.5 w-3.5 text-[#C6F36A]" />
        </Link>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {featureEntries.map(([key, val]) => {
          const entry = val as {
            enabled: boolean;
            limit?: number | null;
            unlimited?: boolean;
            tier?: string;
          };
          return (
            <div
              key={key}
              className={`rounded-2xl border p-4 flex items-start justify-between gap-3 ${
                entry.enabled
                  ? "border-[#D0CCC6] bg-[#FCFCFD]"
                  : "border-[#D0CCC6]/60 bg-[#F9F9F9] opacity-75"
              }`}
            >
              <div className="space-y-1">
                <div className="text-xs font-mono font-bold text-[#3F434C]">
                  {key}
                </div>
                <div className="text-xs text-[#69736C]">
                  {entry.unlimited
                    ? "Limit: Unlimited"
                    : typeof entry.limit === "number"
                      ? `Limit: ${entry.limit}`
                      : entry.tier
                        ? `Tier: ${entry.tier}`
                        : entry.enabled
                          ? "Enabled"
                          : "Locked on current plan"}
                </div>
              </div>

              {entry.enabled ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-[#C6F36A] px-2.5 py-0.5 text-[10px] font-bold uppercase text-[#171D1B]">
                  <CheckCircle2 className="h-3 w-3" />
                  <span>Active</span>
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 rounded-full bg-[#D0CCC6]/50 px-2.5 py-0.5 text-[10px] font-bold uppercase text-[#3F434C]">
                  <Lock className="h-3 w-3" />
                  <span>Locked</span>
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
