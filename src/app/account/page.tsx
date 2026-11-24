"use client";

import * as React from "react";
import Link from "next/link";
import {
  Building2,
  CheckCircle2,
  CreditCard,
  Layers,
  ArrowRight,
  ShieldCheck,
  Users,
  Bell,
} from "lucide-react";
import { OFFICIAL_PLANS, formatMinorCurrency } from "@/features/catalog/plans";
import type { OfficialPlanSlug } from "@/types/billing";

interface BillingSummaryPayload {
  organization: { id: string; name: string; owner_id: string };
  membership: { role: string; can_manage_billing: boolean };
  plan: { slug: OfficialPlanSlug; name: string; priceMinor: number };
  subscription: {
    id: string;
    status: string;
    current_period_end: string | null;
    cancel_at_period_end: boolean;
  } | null;
  entitlements: {
    plan: OfficialPlanSlug;
    status: string;
    isPaidActive: boolean;
  };
  usage: {
    projects: { used: number; limit: number | null; unlimited: boolean };
    organizationSeats: { used: number; limit: number | null; unlimited: boolean };
    knowledgeFiles: { used: number; limit: number | null; unlimited: boolean };
  };
  billingContact: { billing_email: string; email_verified: boolean };
  recentPayments: Array<{
    id: string;
    provider_payment_id: string;
    amount_minor: number;
    currency: string;
    status: string;
    created_at: string;
  }>;
}

export default function AccountDashboardPage() {
  const [data, setData] = React.useState<BillingSummaryPayload | null>(null);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    let mounted = true;
    async function load() {
      try {
        const res = await fetch("/api/v1/billing/summary");
        const body = await res.json();
        if (!mounted) return;
        if (res.ok && body.data) {
          setData(body.data);
        }
      } finally {
        if (mounted) setLoading(false);
      }
    }
    load();
    return () => {
      mounted = false;
    };
  }, []);

  const activePlanSlug: OfficialPlanSlug = data?.entitlements?.plan || "zero";
  const planDef = OFFICIAL_PLANS[activePlanSlug];

  return (
    <div className="space-y-8">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <span className="text-xs font-mono font-bold uppercase tracking-widest text-[#69736C]">
            Organization Subscription Overview
          </span>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-[#3F434C] mt-1">
            {data?.organization?.name || "Organization Workspace"}
          </h1>
        </div>
        <div className="flex items-center gap-3">
          <Link
            href="/plans"
            className="inline-flex items-center gap-2 rounded-xl border border-[#3F434C] bg-[#FCFCFD] px-4 py-2.5 text-xs font-bold text-[#3F434C] hover:bg-[#D0CCC6]/30 transition"
          >
            <span>Compare Plans</span>
          </Link>
          <Link
            href="/account/subscriptions"
            className="inline-flex items-center gap-2 rounded-xl bg-[#3F434C] px-4 py-2.5 text-xs font-bold text-[#FCFCFD] hover:bg-[#2a2d33] transition"
          >
            <span>Manage Subscription</span>
            <ArrowRight className="h-3.5 w-3.5 text-[#C6F36A]" />
          </Link>
        </div>
      </div>

      {/* Top Metrics Cards */}
      <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
        <div className="rounded-2xl border border-[#D0CCC6] bg-[#FCFCFD] p-6 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-[#69736C]">
              Active Plan
            </span>
            <Layers className="h-4 w-4 text-[#3F434C]" />
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-extrabold text-[#3F434C]">
              {planDef.name}
            </span>
            <span className="rounded-full bg-[#C6F36A] px-2.5 py-0.5 text-[10px] font-bold uppercase text-[#171D1B]">
              {data?.entitlements?.status || "free"}
            </span>
          </div>
          <p className="text-xs text-[#69736C]">
            {formatMinorCurrency(planDef.priceMinor)}
            {planDef.billingInterval === "month"
              ? "/month · Billed monthly"
              : " · Free forever"}
          </p>
        </div>

        <div className="rounded-2xl border border-[#D0CCC6] bg-[#FCFCFD] p-6 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-[#69736C]">
              Next Renewal / Payment
            </span>
            <CreditCard className="h-4 w-4 text-[#3F434C]" />
          </div>
          <div className="text-2xl font-extrabold text-[#3F434C]">
            {data?.subscription?.current_period_end
              ? new Date(data.subscription.current_period_end)
                  .toISOString()
                  .slice(0, 10)
              : "No recurring charge"}
          </div>
          <p className="text-xs text-[#69736C]">
            {data?.subscription?.cancel_at_period_end
              ? "Scheduled to cancel at period end"
              : data?.entitlements?.isPaidActive
                ? `Auto-renews at ${formatMinorCurrency(planDef.priceMinor)}/mo`
                : "Upgrade anytime to unlock paid capacity"}
          </p>
        </div>

        <div className="rounded-2xl border border-[#D0CCC6] bg-[#FCFCFD] p-6 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-[#69736C]">
              Billing Contact &amp; Role
            </span>
            <Building2 className="h-4 w-4 text-[#3F434C]" />
          </div>
          <div className="text-sm font-bold text-[#3F434C] truncate">
            {data?.billingContact?.billing_email || "Owner workspace email"}
          </div>
          <p className="text-xs text-[#69736C]">
            Role: <strong className="text-[#3F434C]">{data?.membership?.role || "owner"}</strong> · AI Credits: <strong>0 included</strong>
          </p>
        </div>
      </div>

      {/* Resource Quotas & Active Benefits */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        <div className="lg:col-span-7 rounded-2xl border border-[#D0CCC6] bg-[#FCFCFD] p-6 space-y-5">
          <div className="flex items-center justify-between border-b border-[#D0CCC6] pb-4">
            <div>
              <h2 className="text-base font-extrabold text-[#3F434C]">
                Organization Quota &amp; Benefit Usage
              </h2>
              <p className="text-xs text-[#69736C]">
                Enforced across all projects belonging to your organization
              </p>
            </div>
            <Link
              href="/account/usage"
              className="text-xs font-bold text-[#3F434C] hover:underline"
            >
              Full usage details →
            </Link>
          </div>

          <div className="space-y-4">
            {[
              {
                label: "Active Projects",
                used: data?.usage?.projects.used ?? 1,
                limit:
                  data?.usage?.projects.limit ??
                  (typeof planDef.limits.projects === "number"
                    ? planDef.limits.projects
                    : 1),
                unlimited: false,
              },
              {
                label: "Organization Seats (Owners, Admins & Members)",
                used: data?.usage?.organizationSeats.used ?? 1,
                limit:
                  data?.usage?.organizationSeats.limit ??
                  (typeof planDef.limits.organizationSeats === "number"
                    ? planDef.limits.organizationSeats
                    : 1),
                unlimited: false,
              },
              {
                label: "Knowledge Files",
                used: data?.usage?.knowledgeFiles.used ?? 0,
                limit:
                  planDef.limits.knowledgeFiles === "unlimited"
                    ? null
                    : planDef.limits.knowledgeFiles === "basic"
                      ? 0
                      : planDef.limits.knowledgeFiles,
                unlimited: planDef.limits.knowledgeFiles === "unlimited",
              },
            ].map((item) => {
              const pct =
                item.unlimited || !item.limit
                  ? 15
                  : Math.min(100, Math.round((item.used / item.limit) * 100));
              return (
                <div key={item.label} className="space-y-1.5">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-semibold text-[#3F434C]">
                      {item.label}
                    </span>
                    <span className="font-mono text-[#69736C]">
                      {item.used} /{" "}
                      {item.unlimited
                        ? "Unlimited"
                        : item.limit === 0
                          ? "Basic context (Upgrade for files)"
                          : item.limit}
                    </span>
                  </div>
                  <div className="h-2 w-full rounded-full bg-[#F9F9F9] border border-[#D0CCC6] overflow-hidden">
                    <div
                      className="h-full bg-[#3F434C]"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="lg:col-span-5 rounded-2xl border border-[#D0CCC6] bg-[#FCFCFD] p-6 space-y-4">
          <div className="flex items-center justify-between border-b border-[#D0CCC6] pb-4">
            <h2 className="text-base font-extrabold text-[#3F434C]">
              Active Plan Capabilities
            </h2>
            <ShieldCheck className="h-4 w-4 text-[#3F434C]" />
          </div>

          <ul className="space-y-2.5">
            {planDef.benefitGroups
              .flatMap((g) => g.items)
              .map((benefit) => (
                <li
                  key={benefit}
                  className="flex items-start gap-2.5 text-xs text-[#3F434C]"
                >
                  <CheckCircle2 className="h-4 w-4 shrink-0 text-[#3F434C] mt-0.5" />
                  <span>{benefit}</span>
                </li>
              ))}
          </ul>

          <div className="pt-3 border-t border-[#D0CCC6] flex items-center justify-between text-xs">
            <Link
              href="/account/settings"
              className="inline-flex items-center gap-1.5 font-bold text-[#3F434C] hover:underline"
            >
              <Users className="h-3.5 w-3.5" />
              <span>Manage Billing Admins</span>
            </Link>
            <Link
              href="/account/billing"
              className="inline-flex items-center gap-1.5 font-bold text-[#3F434C] hover:underline"
            >
              <Bell className="h-3.5 w-3.5" />
              <span>Payment History</span>
            </Link>
          </div>
        </div>
      </div>

      {loading && (
        <p className="text-xs text-[#69736C] text-center">
          Synchronizing live subscription state...
        </p>
      )}
    </div>
  );
}
