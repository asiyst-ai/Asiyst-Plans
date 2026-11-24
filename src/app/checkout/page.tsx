"use client";

import * as React from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  ArrowLeft,
  ArrowRight,
  Building2,
  CheckCircle2,
  CreditCard,
  Lock,
  AlertCircle,
  Loader2,
  ShieldCheck,
  LogIn,
} from "lucide-react";
import { PlanNavbar, PlanFooter } from "@/components/navigation";
import {
  OFFICIAL_PLANS,
  OFFICIAL_PLAN_LIST,
  formatMinorCurrency,
  normalizeOfficialPlanSlug,
} from "@/features/catalog/plans";
import type { OfficialPlanSlug } from "@/types/billing";

const MAIN_APP_URL =
  process.env.NEXT_PUBLIC_MAIN_APP_URL || "https://asiyst.com";

function CheckoutContent() {
  const searchParams = useSearchParams();
  const initialPlanParam = searchParams.get("plan");
  const cancelledParam = searchParams.get("checkout") === "cancelled";

  const [selectedSlug, setSelectedSlug] = React.useState<OfficialPlanSlug>(
    () => normalizeOfficialPlanSlug(initialPlanParam) || "pulse",
  );
  const [sessionState, setSessionState] = React.useState<{
    loading: boolean;
    authenticated: boolean;
    userEmail?: string;
    organizationName?: string;
    loginUrl: string;
  }>({
    loading: true,
    authenticated: false,
    loginUrl: `${MAIN_APP_URL}/login`,
  });
  const [submitting, setSubmitting] = React.useState(false);
  const [statusMessage, setStatusMessage] = React.useState<{
    type: "success" | "error" | "info" | "login_required";
    code?: string;
    text: string;
    orderId?: string;
  } | null>(
    cancelledParam
      ? {
          type: "info",
          text: "Your previous checkout session was cancelled. No charges were made and your current entitlements remain unchanged.",
        }
      : null,
  );

  React.useEffect(() => {
    let active = true;
    fetch("/api/v1/auth/session")
      .then((res) => res.json())
      .then((body) => {
        if (!active) return;
        const data = body?.data;
        setSessionState({
          loading: false,
          authenticated: Boolean(data?.authenticated),
          userEmail: data?.user?.email,
          organizationName: data?.organization?.name,
          loginUrl: data?.loginUrl || `${MAIN_APP_URL}/login`,
        });
      })
      .catch(() => {
        if (active) {
          setSessionState({
            loading: false,
            authenticated: false,
            loginUrl: `${MAIN_APP_URL}/login`,
          });
        }
      });
    return () => {
      active = false;
    };
  }, []);

  const selectedPlan = OFFICIAL_PLANS[selectedSlug];
  const priceDisplay = formatMinorCurrency(
    selectedPlan.priceMinor,
    selectedPlan.currency,
    true,
  );

  async function handleCheckoutSubmit(e: React.FormEvent) {
    e.preventDefault();

    // Requirement 4: If user is not logged in on Asiyst-WEB, ask them to log in before payment
    if (!sessionState.authenticated) {
      setStatusMessage({
        type: "login_required",
        code: "ASIYST_LOGIN_REQUIRED",
        text: "Please sign in with your Asiyst Web account before completing payment or activating a subscription plan.",
      });
      return;
    }

    setSubmitting(true);
    setStatusMessage(null);

    try {
      if (selectedSlug === "zero") {
        const res = await fetch("/api/v1/checkout/free-plan", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        });
        const payload = await res.json();
        if (res.status === 401) {
          setStatusMessage({
            type: "login_required",
            code: "ASIYST_LOGIN_REQUIRED",
            text: "Please sign in with your Asiyst Web account to activate this plan.",
          });
        } else if (!res.ok) {
          setStatusMessage({
            type: "error",
            code: payload?.error?.code,
            text:
              payload?.error?.message ||
              "Unable to activate Asiyst Zero. Please make sure you are signed in as an organization owner or billing administrator.",
          });
        } else {
          setStatusMessage({
            type: "success",
            text: payload?.data?.alreadyActive
              ? "Asiyst Zero is already active for your organization."
              : "Asiyst Zero ($0) has been activated for your organization! Your free entitlements are now active in Asiyst-WEB.",
          });
        }
      } else {
        const res = await fetch("/api/v1/checkout/session", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ plan: selectedSlug }),
        });
        const payload = await res.json();

        if (res.status === 401) {
          setStatusMessage({
            type: "login_required",
            code: "ASIYST_LOGIN_REQUIRED",
            text: "Please sign in with your Asiyst Web account before proceeding to payment.",
          });
        } else if (!res.ok) {
          setStatusMessage({
            type: "error",
            code: payload?.error?.code,
            orderId: payload?.error?.details?.orderId,
            text:
              payload?.error?.message ||
              "Unable to create Dodo Payments checkout session.",
          });
        } else if (payload?.data?.checkoutUrl) {
          window.location.href = payload.data.checkoutUrl;
          return;
        }
      }
    } catch {
      setStatusMessage({
        type: "error",
        text: "A network error occurred while communicating with the Asiyst Plan billing server.",
      });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="grid grid-cols-1 gap-8 lg:grid-cols-12">
      {/* Left column: Plan Selector & Benefits */}
      <div className="lg:col-span-7 space-y-6">
        <div className="flex items-center justify-between">
          <Link
            href="/plans"
            className="inline-flex items-center gap-1.5 text-xs font-bold text-[#3F434C] hover:underline"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            <span>Back to plan comparison</span>
          </Link>
          <span className="text-xs font-mono text-[#69736C]">
            Product: Asiyst AI
          </span>
        </div>

        <div className="rounded-2xl border border-[#D0CCC6] bg-[#FCFCFD] p-6 space-y-5">
          <div>
            <h1 className="text-2xl font-extrabold text-[#3F434C]">
              Select Your Organization Subscription Plan
            </h1>
            <p className="text-xs text-[#69736C] mt-1">
              One subscription covers your organization and its eligible projects in Asiyst-WEB.
            </p>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {OFFICIAL_PLAN_LIST.map((plan) => {
              const isSelected = plan.slug === selectedSlug;
              return (
                <button
                  key={plan.slug}
                  type="button"
                  onClick={() => {
                    setSelectedSlug(plan.slug);
                    setStatusMessage(null);
                  }}
                  className={`flex flex-col justify-between rounded-xl border p-4 text-left transition cursor-pointer ${
                    isSelected
                      ? "border-2 border-[#3F434C] bg-[#C6F36A]/20 shadow-xs"
                      : "border-[#D0CCC6] bg-[#F9F9F9] hover:border-[#3F434C]/60"
                  }`}
                >
                  <div className="flex items-center justify-between w-full">
                    <span className="text-sm font-bold text-[#3F434C]">
                      {plan.name}
                    </span>
                    <span className="text-sm font-extrabold text-[#3F434C]">
                      {formatMinorCurrency(plan.priceMinor)}
                      {plan.billingInterval === "month" ? "/mo" : ""}
                    </span>
                  </div>
                  <p className="mt-1.5 text-[11px] text-[#69736C]">
                    {plan.subtitle}
                  </p>
                </button>
              );
            })}
          </div>

          <div className="rounded-xl border border-[#D0CCC6] bg-[#F9F9F9] p-4 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold uppercase tracking-wider text-[#3F434C]">
                Included in {selectedPlan.name}
              </span>
              <span className="text-[11px] font-mono text-[#69736C]">
                Key: {selectedPlan.slug}
              </span>
            </div>
            <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {selectedPlan.benefitGroups
                .flatMap((g) => g.items)
                .map((benefit) => (
                  <li
                    key={benefit}
                    className="flex items-start gap-2 text-xs text-[#3F434C]"
                  >
                    <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-[#3F434C] mt-0.5" />
                    <span>{benefit}</span>
                  </li>
                ))}
            </ul>
          </div>
        </div>

        <div className="rounded-2xl border border-[#D0CCC6] bg-[#FCFCFD] p-5 flex items-start gap-3.5">
          <ShieldCheck className="h-5 w-5 text-[#3F434C] shrink-0 mt-0.5" />
          <div className="space-y-1 text-xs text-[#69736C]">
            <p className="font-bold text-[#3F434C]">
              Verified Backend Entitlement Activation Policy
            </p>
            <p className="leading-relaxed">
              For paid plans (Pulse, Vector, Quantum), creating a checkout session sets your order to <code>pending</code>. Your purchased benefits activate in Asiyst-WEB strictly after Dodo Payments confirms the payment via our verified server webhook. No AI Credits are included in subscription plans.
            </p>
          </div>
        </div>
      </div>

      {/* Right column: Order Summary & Action */}
      <div className="lg:col-span-5">
        <form
          onSubmit={handleCheckoutSubmit}
          className="sticky top-24 rounded-2xl border-2 border-[#3F434C] bg-[#FCFCFD] p-6 shadow-sm space-y-6"
        >
          <div className="flex items-center justify-between border-b border-[#D0CCC6] pb-4">
            <div>
              <h2 className="text-lg font-extrabold text-[#3F434C]">
                Payment &amp; Order Summary
              </h2>
              <p className="text-xs text-[#69736C]">
                {sessionState.authenticated
                  ? `Organization: ${sessionState.organizationName || sessionState.userEmail || "Verified Account"}`
                  : "Sign in on Asiyst required before payment"}
              </p>
            </div>
            <Building2 className="h-5 w-5 text-[#3F434C]" />
          </div>

          <div className="space-y-3 text-xs">
            <div className="flex items-center justify-between">
              <span className="text-[#69736C]">Product</span>
              <span className="font-bold text-[#3F434C]">Asiyst AI</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[#69736C]">Selected Plan</span>
              <span className="font-bold text-[#3F434C]">{selectedPlan.name}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[#69736C]">Billing Interval</span>
              <span className="font-semibold text-[#3F434C]">
                {selectedPlan.billingInterval === "month"
                  ? "Monthly recurring"
                  : "Free (No recurring charge)"}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[#69736C]">Plan Subtotal</span>
              <span className="font-semibold text-[#3F434C]">{priceDisplay}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[#69736C]">Applicable Taxes</span>
              <span className="text-[#69736C]">
                {selectedPlan.requiresDodoCheckout
                  ? "Calculated at Dodo Payments checkout"
                  : "$0.00"}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[#69736C]">Discounts</span>
              <span className="text-[#69736C]">$0.00</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[#69736C]">AI Credits Included</span>
              <span className="font-mono text-[#69736C]">0 (Separate system)</span>
            </div>

            <div className="border-t border-[#D0CCC6] pt-3 flex items-baseline justify-between">
              <span className="text-sm font-bold text-[#3F434C]">Total Due</span>
              <div className="text-right">
                <span className="text-2xl font-extrabold text-[#3F434C]">
                  {priceDisplay}
                </span>
                <span className="block text-[10px] text-[#69736C]">
                  {selectedPlan.requiresDodoCheckout
                    ? "USD · billed monthly via Dodo Payments"
                    : "USD · no payment method required"}
                </span>
              </div>
            </div>
          </div>

          {!sessionState.loading && !sessionState.authenticated && (
            <div className="rounded-xl border-2 border-[#3F434C] bg-[#F9F9F9] p-4 text-xs space-y-3">
              <div className="flex items-center gap-2 font-bold text-[#3F434C]">
                <LogIn className="h-4 w-4 shrink-0" />
                <span>Sign in on Asiyst Web to Continue</span>
              </div>
              <p className="text-[#69736C] leading-relaxed">
                You can explore and compare plans freely. Before completing payment or activating a subscription, please sign in with your Asiyst account so your plan benefits are linked to your organization.
              </p>
              <a
                href={sessionState.loginUrl}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#3F434C] px-4 py-2.5 text-xs font-bold text-[#FCFCFD] hover:bg-[#2a2d33] transition"
              >
                <LogIn className="h-3.5 w-3.5 text-[#C6F36A]" />
                <span>Sign in on Asiyst Web</span>
                <ArrowRight className="h-3.5 w-3.5" />
              </a>
            </div>
          )}

          {statusMessage && (
            <div
              className={`rounded-xl border p-4 text-xs space-y-2 ${
                statusMessage.type === "success"
                  ? "border-emerald-700/30 bg-emerald-50 text-emerald-950"
                  : statusMessage.type === "info"
                    ? "border-[#D0CCC6] bg-[#F9F9F9] text-[#3F434C]"
                    : "border-amber-700/40 bg-amber-50 text-amber-950"
              }`}
            >
              <div className="flex items-center gap-2 font-bold">
                <AlertCircle className="h-4 w-4 shrink-0" />
                <span>
                  {statusMessage.code
                    ? `Notice (${statusMessage.code})`
                    : "Checkout Update"}
                </span>
              </div>
              <p className="leading-relaxed">{statusMessage.text}</p>
              {statusMessage.type === "login_required" && (
                <a
                  href={sessionState.loginUrl}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-[#3F434C] px-3.5 py-2 text-xs font-bold text-[#FCFCFD] mt-1"
                >
                  <LogIn className="h-3.5 w-3.5 text-[#C6F36A]" />
                  <span>Go to Asiyst Web Sign In</span>
                </a>
              )}
              {statusMessage.orderId && (
                <p className="font-mono text-[11px] pt-1">
                  Internal Order ID: {statusMessage.orderId} (Benefits locked until payment verified)
                </p>
              )}
            </div>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#3F434C] px-5 py-3.5 text-sm font-bold text-[#FCFCFD] hover:bg-[#2a2d33] disabled:opacity-60 transition shadow-xs cursor-pointer"
          >
            {submitting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin text-[#C6F36A]" />
                <span>Processing securely...</span>
              </>
            ) : !sessionState.authenticated ? (
              <>
                <LogIn className="h-4 w-4 text-[#C6F36A]" />
                <span>Sign in Required Before Payment</span>
              </>
            ) : selectedPlan.requiresDodoCheckout ? (
              <>
                <CreditCard className="h-4 w-4 text-[#C6F36A]" />
                <span>Proceed to Dodo Payments ({priceDisplay}/mo)</span>
                <ArrowRight className="h-4 w-4" />
              </>
            ) : (
              <>
                <CheckCircle2 className="h-4 w-4 text-[#C6F36A]" />
                <span>Activate Asiyst Zero (Free)</span>
              </>
            )}
          </button>

          <div className="flex items-center justify-center gap-1.5 text-[11px] text-[#69736C]">
            <Lock className="h-3 w-3" />
            <span>
              {selectedPlan.requiresDodoCheckout
                ? "Hosted checkout powered by Dodo Payments · Webhook-verified activation"
                : "Direct backend free-plan activation · No credit card required"}
            </span>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function CheckoutPage() {
  return (
    <div className="min-h-screen flex flex-col bg-[#F9F9F9] text-[#3F434C]">
      <PlanNavbar />
      <main className="flex-1 mx-auto w-full max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
        <React.Suspense
          fallback={
            <div className="rounded-2xl border border-[#D0CCC6] bg-[#FCFCFD] p-12 text-center text-sm text-[#69736C]">
              Loading checkout configuration...
            </div>
          }
        >
          <CheckoutContent />
        </React.Suspense>
      </main>
      <PlanFooter />
    </div>
  );
}
