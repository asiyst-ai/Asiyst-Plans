"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ArrowRight,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
  XCircle,
  ArrowUpCircle,
  ArrowDownCircle,
} from "lucide-react";
import {
  OFFICIAL_PLANS,
  OFFICIAL_PLAN_LIST,
  comparePlanRank,
  formatMinorCurrency,
  normalizeOfficialPlanSlug,
} from "@/features/catalog/plans";
import type { OfficialPlanSlug } from "@/types/billing";
import { PLANS_ORG_CHANGE_EVENT, PLANS_ORG_STORAGE_KEY } from "../layout";

interface SubscriptionRecord {
  id: string;
  organization_id: string;
  plan: string;
  status: string;
  current_period_start: string | null;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
  price_minor: number | null;
  billing_provider: string | null;
  dodo_subscription_id: string | null;
}

function SubscriptionsManagerContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [subscription, setSubscription] =
    React.useState<SubscriptionRecord | null>(null);
  const [effectivePlan, setEffectivePlan] =
    React.useState<OfficialPlanSlug>("zero");
  const [isPaidActive, setIsPaidActive] = React.useState(false);
  const [history, setHistory] = React.useState<
    Array<{
      id: string;
      change_type: string;
      previous_plan: string | null;
      new_plan: string | null;
      created_at: string;
    }>
  >([]);
  const [actionFeedback, setActionFeedback] = React.useState<{
    type: "success" | "error";
    text: string;
  } | null>(() => {
    const requestedAction = searchParams.get("action");
    const requestedTarget = normalizeOfficialPlanSlug(searchParams.get("target"));
    if (requestedAction === "downgrade" && requestedTarget) {
      return {
        type: "success",
        text: `Select "Downgrade to ${OFFICIAL_PLANS[requestedTarget].name.replace("Asiyst ", "")}" below to confirm your scheduled plan change.`,
      };
    }
    return null;
  });
  const [busyAction, setBusyAction] = React.useState<string | null>(null);

  const loadSubscriptionData = React.useCallback(async (explicitOrgId?: string | null) => {
    const orgId =
      explicitOrgId ??
      (typeof window !== "undefined"
        ? window.localStorage.getItem(PLANS_ORG_STORAGE_KEY)
        : null);
    const qs = orgId ? `?organizationId=${encodeURIComponent(orgId)}` : "";
    try {
      const res = await fetch(`/api/v1/subscriptions${qs}`, { cache: "no-store" });
      if (!res.ok) return;
      const body = await res.json();
      setSubscription(body.data?.subscription || null);
      setEffectivePlan(body.data?.entitlements?.plan || "zero");
      setIsPaidActive(Boolean(body.data?.entitlements?.isPaidActive));
      setHistory(body.data?.history || []);
    } catch {
      // Handled gracefully
    }
  }, []);

  React.useEffect(() => {
    let active = true;
    const orgId =
      typeof window !== "undefined"
        ? window.localStorage.getItem(PLANS_ORG_STORAGE_KEY)
        : null;
    const qs = orgId ? `?organizationId=${encodeURIComponent(orgId)}` : "";
    fetch(`/api/v1/subscriptions${qs}`, { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .then((body) => {
        if (!active || !body) return;
        setSubscription(body.data?.subscription || null);
        setEffectivePlan(body.data?.entitlements?.plan || "zero");
        setIsPaidActive(Boolean(body.data?.entitlements?.isPaidActive));
        setHistory(body.data?.history || []);
      })
      .catch(() => {
        // Handled gracefully
      });
    const onOrgChange = (e: Event) => {
      void loadSubscriptionData((e as CustomEvent<string>).detail);
    };
    window.addEventListener(PLANS_ORG_CHANGE_EVENT, onOrgChange);
    return () => {
      active = false;
      window.removeEventListener(PLANS_ORG_CHANGE_EVENT, onOrgChange);
    };
  }, [loadSubscriptionData]);

  async function handleLifecycleAction(
    action: "upgrade" | "downgrade" | "cancel" | "reactivate",
    targetPlan?: OfficialPlanSlug,
  ) {
    if (!subscription?.id) {
      if (targetPlan) {
        router.push(`/checkout?plan=${targetPlan}`);
      }
      return;
    }

    setBusyAction(`${action}:${targetPlan || ""}`);
    setActionFeedback(null);

    try {
      const endpoint = `/api/v1/subscriptions/${subscription.id}/${action}`;
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(targetPlan ? { targetPlan } : {}),
      });
      const payload = await res.json();

      if (!res.ok) {
        if (payload?.error?.code === "CHECKOUT_REQUIRED_FOR_FIRST_PAID_PLAN" && targetPlan) {
          router.push(`/checkout?plan=${targetPlan}`);
          return;
        }
        if (
          res.status === 401 &&
          typeof payload?.error?.details?.loginUrl === "string"
        ) {
          window.location.assign(payload.error.details.loginUrl);
          return;
        }
        setActionFeedback({
          type: "error",
          text: payload?.error?.message || `Unable to perform ${action}.`,
        });
      } else {
        setActionFeedback({
          type: "success",
          text:
            payload?.data?.message ||
            `Subscription ${action} request processed successfully.`,
        });
        await loadSubscriptionData();
      }
    } catch {
      setActionFeedback({
        type: "error",
        text: "Network error communicating with subscription lifecycle service.",
      });
    } finally {
      setBusyAction(null);
    }
  }

  const currentPlanDef = OFFICIAL_PLANS[effectivePlan];

  return (
    <div className="space-y-8">
      <div>
        <span className="text-xs font-mono font-bold uppercase tracking-widest text-[#69736C]">
          Subscription Lifecycle Management
        </span>
        <h1 className="text-2xl sm:text-3xl font-extrabold text-[#3F434C] mt-1">
          Manage Your Organization Subscription
        </h1>
        <p className="text-xs text-[#69736C] mt-1">
          Upgrade, downgrade, schedule cancellation, or reactivate your Asiyst AI plan.
        </p>
      </div>

      {actionFeedback && (
        <div
          className={`rounded-2xl border p-4 text-xs flex items-center gap-2.5 ${
            actionFeedback.type === "success"
              ? "border-emerald-700/30 bg-emerald-50 text-emerald-950"
              : "border-amber-700/40 bg-amber-50 text-amber-950"
          }`}
        >
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span>{actionFeedback.text}</span>
        </div>
      )}

      {/* Current Subscription Card */}
      <div className="rounded-2xl border-2 border-[#3F434C] bg-[#FCFCFD] p-6 space-y-6">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-[#D0CCC6] pb-5">
          <div className="space-y-1">
            <div className="flex items-center gap-2.5">
              <h2 className="text-xl font-extrabold text-[#3F434C]">
                {currentPlanDef.name}
              </h2>
              <span className="rounded-full bg-[#C6F36A] px-2.5 py-0.5 text-[10px] font-bold uppercase text-[#171D1B]">
                {subscription?.cancel_at_period_end
                  ? "Cancellation Scheduled"
                  : isPaidActive
                    ? "Active Paid"
                    : "Active Free"}
              </span>
            </div>
            <p className="text-xs text-[#69736C]">{currentPlanDef.subtitle}</p>
          </div>

          <div className="text-left md:text-right">
            <div className="text-2xl font-extrabold text-[#3F434C]">
              {formatMinorCurrency(currentPlanDef.priceMinor)}
              <span className="text-xs font-normal text-[#69736C]">
                {currentPlanDef.billingInterval === "month"
                  ? "/month"
                  : " Free"}
              </span>
            </div>
            {subscription?.current_period_end && (
              <p className="text-[11px] text-[#69736C]">
                {subscription.cancel_at_period_end
                  ? `Access ends on ${new Date(subscription.current_period_end).toISOString().slice(0, 10)}`
                  : `Renews on ${new Date(subscription.current_period_end).toISOString().slice(0, 10)}`}
              </p>
            )}
          </div>
        </div>

        {/* Cancel / Reactivate Controls */}
        {isPaidActive && subscription && (
          <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-[#D0CCC6] bg-[#F9F9F9] p-4">
            <div className="space-y-0.5 text-xs">
              <p className="font-bold text-[#3F434C]">
                {subscription.cancel_at_period_end
                  ? "Your subscription is scheduled to cancel at the end of the current period."
                  : "Auto-renewal is active for your organization."}
              </p>
              <p className="text-[#69736C]">
                {subscription.cancel_at_period_end
                  ? "You can reactivate now to keep your paid plan benefits without interruption."
                  : "If you cancel, your organization retains full paid access until the end of the billing cycle."}
              </p>
            </div>

            {subscription.cancel_at_period_end ? (
              <button
                type="button"
                disabled={busyAction !== null}
                onClick={() => handleLifecycleAction("reactivate")}
                className="inline-flex items-center gap-1.5 rounded-xl bg-[#3F434C] px-4 py-2.5 text-xs font-bold text-[#FCFCFD] hover:bg-[#2a2d33] transition cursor-pointer"
              >
                <RefreshCw className="h-3.5 w-3.5 text-[#C6F36A]" />
                <span>Reactivate Subscription</span>
              </button>
            ) : (
              <button
                type="button"
                disabled={busyAction !== null}
                onClick={() => handleLifecycleAction("cancel")}
                className="inline-flex items-center gap-1.5 rounded-xl border border-red-800/40 bg-white px-4 py-2.5 text-xs font-bold text-red-800 hover:bg-red-50 transition cursor-pointer"
              >
                <XCircle className="h-3.5 w-3.5" />
                <span>Cancel at Period End</span>
              </button>
            )}
          </div>
        )}

        {/* Plan Change Options */}
        <div className="space-y-3">
          <h3 className="text-xs font-bold uppercase tracking-wider text-[#3F434C]">
            Upgrade or Switch Plan
          </h3>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {OFFICIAL_PLAN_LIST.map((plan) => {
              const rankDiff = comparePlanRank(plan.slug, effectivePlan);
              const isCurrent = rankDiff === 0;
              const isUpgrade = rankDiff > 0;

              return (
                <div
                  key={plan.slug}
                  className={`rounded-xl border p-4 flex flex-col justify-between space-y-4 ${
                    isCurrent
                      ? "border-2 border-[#3F434C] bg-[#C6F36A]/15"
                      : "border-[#D0CCC6] bg-[#F9F9F9]"
                  }`}
                >
                  <div>
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-bold text-[#3F434C]">
                        {plan.name}
                      </span>
                      <span className="text-xs font-extrabold text-[#3F434C]">
                        {formatMinorCurrency(plan.priceMinor)}
                        {plan.billingInterval === "month" ? "/mo" : ""}
                      </span>
                    </div>
                    <p className="mt-1 text-[11px] text-[#69736C]">
                      {plan.subtitle}
                    </p>
                  </div>

                  {isCurrent ? (
                    <span className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-[#3F434C]/10 px-3 py-2 text-xs font-bold text-[#3F434C]">
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      <span>Active Plan</span>
                    </span>
                  ) : isUpgrade ? (
                    isPaidActive && subscription?.dodo_subscription_id ? (
                      <button
                        type="button"
                        disabled={busyAction !== null}
                        onClick={() =>
                          handleLifecycleAction("upgrade", plan.slug)
                        }
                        className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-[#3F434C] px-3 py-2 text-xs font-bold text-[#FCFCFD] hover:bg-[#2a2d33] transition cursor-pointer"
                      >
                        <ArrowUpCircle className="h-3.5 w-3.5 text-[#C6F36A]" />
                        <span>Upgrade to {plan.name.replace("Asiyst ", "")}</span>
                      </button>
                    ) : (
                      <Link
                        href={`/checkout?plan=${plan.slug}`}
                        className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-[#3F434C] px-3 py-2 text-xs font-bold text-[#FCFCFD] hover:bg-[#2a2d33] transition"
                      >
                        <span>Upgrade via Checkout</span>
                        <ArrowRight className="h-3.5 w-3.5 text-[#C6F36A]" />
                      </Link>
                    )
                  ) : (
                    <button
                      type="button"
                      disabled={busyAction !== null || !isPaidActive}
                      onClick={() =>
                        handleLifecycleAction("downgrade", plan.slug)
                      }
                      className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-[#3F434C] bg-[#FCFCFD] px-3 py-2 text-xs font-bold text-[#3F434C] hover:bg-[#D0CCC6]/30 disabled:opacity-50 transition cursor-pointer"
                    >
                      <ArrowDownCircle className="h-3.5 w-3.5" />
                      <span>Downgrade to {plan.name.replace("Asiyst ", "")}</span>
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Subscription Change History */}
      <div className="rounded-2xl border border-[#D0CCC6] bg-[#FCFCFD] p-6 space-y-4">
        <h2 className="text-base font-extrabold text-[#3F434C]">
          Subscription Lifecycle Audit Trail
        </h2>
        {history.length === 0 ? (
          <p className="text-xs text-[#69736C]">
            No plan transitions recorded yet for this organization.
          </p>
        ) : (
          <div className="divide-y divide-[#D0CCC6]/60 text-xs">
            {history.map((item) => (
              <div
                key={item.id}
                className="py-3 flex items-center justify-between"
              >
                <div>
                  <span className="font-bold text-[#3F434C] uppercase font-mono">
                    {item.change_type}
                  </span>
                  <span className="ml-2 text-[#69736C]">
                    {item.previous_plan
                      ? `${normalizeOfficialPlanSlug(item.previous_plan)} → `
                      : ""}
                    {normalizeOfficialPlanSlug(item.new_plan) || "zero"}
                  </span>
                </div>
                <span className="font-mono text-[#69736C]">
                  {new Date(item.created_at).toISOString().slice(0, 16).replace("T", " ")} UTC
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default function AccountSubscriptionsPage() {
  return (
    <React.Suspense
      fallback={
        <div className="p-8 text-center text-xs text-[#69736C]">
          Loading subscription details...
        </div>
      }
    >
      <SubscriptionsManagerContent />
    </React.Suspense>
  );
}
