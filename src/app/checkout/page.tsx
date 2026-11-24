"use client";

import * as React from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  ArrowLeft,
  ArrowRight,
  Building2,
  CheckCircle2,
  Clock,
  CreditCard,
  FileText,
  Lock,
  AlertCircle,
  Loader2,
  RefreshCw,
  ShieldCheck,
  LogIn,
  XCircle,
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

function generateAttemptKey(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `attempt_${Date.now()}_${Math.random().toString(36).slice(2, 12)}`;
}

function formatCountdown(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  const mins = Math.floor(safe / 60);
  const secs = safe % 60;
  return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

interface VerifiedOrderDetails {
  orderId: string;
  paymentState: string;
  isPaymentVerifiedAndActive: boolean;
  retryAllowed: boolean;
  planSlug: OfficialPlanSlug;
  periodStart?: string | null;
  periodEnd?: string | null;
  invoiceNumber?: string | null;
  paymentReference?: string | null;
}

function CheckoutContent() {
  const searchParams = useSearchParams();
  const initialPlanParam = searchParams.get("plan");
  const checkoutModeParam = searchParams.get("checkout");
  const returnedOrderId = searchParams.get("orderId");
  const ssoErrorParam = searchParams.get("sso_error");

  const [selectedSlug, setSelectedSlug] = React.useState<OfficialPlanSlug>(
    () => normalizeOfficialPlanSlug(initialPlanParam) || "pulse",
  );
  const [attemptKey, setAttemptKey] = React.useState<string>(() =>
    generateAttemptKey(),
  );
  const inFlightMutexRef = React.useRef<boolean>(false);

  const [sessionState, setSessionState] = React.useState<{
    loading: boolean;
    authenticated: boolean;
    purchaseAuthorized: boolean;
    purchaseAuthStatus: string;
    remainingSeconds: number;
    userEmail?: string;
    userFullName?: string;
    organizationName?: string;
    loginUrl: string;
    reauthUrl: string;
  }>({
    loading: true,
    authenticated: false,
    purchaseAuthorized: false,
    purchaseAuthStatus: "missing",
    remainingSeconds: 0,
    loginUrl: `${MAIN_APP_URL}/api/v1/auth/sso/plan/start?returnPath=%2Fcheckout&source=direct_plan_login`,
    reauthUrl: `${MAIN_APP_URL}/api/v1/auth/sso/plan/start?returnPath=%2Fcheckout&source=reauth&reauth=1`,
  });

  const [submitting, setSubmitting] = React.useState(false);
  const [verifyingReturn, setVerifyingReturn] = React.useState<boolean>(
    Boolean(checkoutModeParam === "return" && returnedOrderId),
  );
  const [verifiedOrder, setVerifiedOrder] =
    React.useState<VerifiedOrderDetails | null>(null);

  const [statusMessage, setStatusMessage] = React.useState<{
    type:
      | "success"
      | "error"
      | "info"
      | "pending"
      | "login_required"
      | "purchase_expired";
    code?: string;
    text: string;
    orderId?: string;
  } | null>(() => {
    if (ssoErrorParam) {
      return {
        type: "purchase_expired",
        code: ssoErrorParam.toUpperCase(),
        text:
          ssoErrorParam === "sso_code_expired"
            ? "Your authentication handoff expired before completion. Please sign in again to continue purchasing."
            : ssoErrorParam === "sso_code_already_used"
              ? "That single-use sign-in link was already used. Please sign in again to start a fresh purchase session."
              : "Unable to verify your authentication handoff. Please sign in again to continue.",
      };
    }
    return null;
  });

  // Load & refresh server-verified authentication + 15-minute purchase authorization
  const loadSession = React.useCallback(
    async (planForReturn: OfficialPlanSlug) => {
      const returnPath = `/checkout?plan=${encodeURIComponent(planForReturn)}`;
      try {
        const res = await fetch(
          `/api/v1/auth/session?returnPath=${encodeURIComponent(returnPath)}&plan=${encodeURIComponent(planForReturn)}`,
          { cache: "no-store" },
        );
        const body = await res.json();
        const data = body?.data;
        setSessionState({
          loading: false,
          authenticated: Boolean(data?.authenticated),
          purchaseAuthorized: Boolean(data?.purchaseAuthorized),
          purchaseAuthStatus: String(
            data?.purchaseAuthorization?.status || "missing",
          ),
          remainingSeconds: Number(
            data?.purchaseAuthorization?.remainingSeconds || 0,
          ),
          userEmail: data?.user?.email,
          userFullName: data?.user?.fullName,
          organizationName: data?.organization?.name,
          loginUrl:
            data?.loginUrl ||
            `${MAIN_APP_URL}/api/v1/auth/sso/plan/start?returnPath=${encodeURIComponent(returnPath)}&plan=${planForReturn}&source=direct_plan_login`,
          reauthUrl:
            data?.reauthUrl ||
            `${MAIN_APP_URL}/api/v1/auth/sso/plan/start?returnPath=${encodeURIComponent(returnPath)}&plan=${planForReturn}&source=reauth&reauth=1`,
        });
      } catch {
        setSessionState((prev) => ({
          ...prev,
          loading: false,
          authenticated: false,
          purchaseAuthorized: false,
        }));
      }
    },
    [],
  );

  React.useEffect(() => {
    let cancelled = false;
    void Promise.resolve().then(() => {
      if (!cancelled) {
        void loadSession(selectedSlug);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [loadSession, selectedSlug]);

  // Countdown tick for short-lived 15-minute purchase authorization
  React.useEffect(() => {
    if (!sessionState.purchaseAuthorized || sessionState.remainingSeconds <= 0) {
      return;
    }
    const timer = window.setInterval(() => {
      setSessionState((prev) => {
        if (!prev.purchaseAuthorized) return prev;
        if (prev.remainingSeconds <= 1) {
          return {
            ...prev,
            purchaseAuthorized: false,
            purchaseAuthStatus: "expired",
            remainingSeconds: 0,
          };
        }
        return {
          ...prev,
          remainingSeconds: prev.remainingSeconds - 1,
        };
      });
    }, 1000);
    return () => window.clearInterval(timer);
  }, [sessionState.purchaseAuthorized, sessionState.remainingSeconds]);

  // Reconcile order status server-side when returning from Dodo Payments (NEVER trust URL params alone!)
  const checkReturnedOrderStatus = React.useCallback(async (orderId: string) => {
    setVerifyingReturn(true);
    try {
      const res = await fetch(
        `/api/v1/checkout/${encodeURIComponent(orderId)}?reconcile=1`,
        { cache: "no-store" },
      );
      if (!res.ok) {
        setVerifyingReturn(false);
        return false;
      }
      const payload = await res.json();
      const data = payload?.data;
      const paymentState = String(data?.paymentState || "checkout_pending");
      const isVerified = Boolean(data?.isPaymentVerifiedAndActive);
      const orderPlan =
        normalizeOfficialPlanSlug(data?.order?.plan_slug) || "pulse";

      setVerifiedOrder({
        orderId,
        paymentState,
        isPaymentVerifiedAndActive: isVerified,
        retryAllowed: Boolean(data?.retryAllowed),
        planSlug: orderPlan,
        periodStart: data?.subscription?.current_period_start || null,
        periodEnd: data?.subscription?.current_period_end || null,
        invoiceNumber: data?.invoice?.invoice_number || null,
        paymentReference:
          data?.invoice?.provider_payment_id ||
          data?.order?.provider_checkout_id ||
          orderId,
      });

      if (isVerified) {
        setStatusMessage({
          type: "success",
          text: `${OFFICIAL_PLANS[orderPlan].name} has been verified and activated for your organization!`,
          orderId,
        });
        setVerifyingReturn(false);
        return true;
      }

      if (paymentState === "payment_failed") {
        setStatusMessage({
          type: "error",
          code: "PAYMENT_FAILED",
          text: "Payment unsuccessful. No subscription has been activated and no paid benefits were granted. You may safely retry below.",
          orderId,
        });
        setAttemptKey(generateAttemptKey());
        setVerifyingReturn(false);
        return true;
      }

      if (paymentState === "expired") {
        setStatusMessage({
          type: "purchase_expired",
          code: "CHECKOUT_EXPIRED",
          text: "Purchase session expired. No new payment was initiated. Sign in again to continue purchasing.",
          orderId,
        });
        setVerifyingReturn(false);
        return true;
      }

      if (paymentState === "payment_cancelled") {
        setStatusMessage({
          type: "info",
          code: "CHECKOUT_CANCELLED",
          text: "Your checkout session was cancelled. No charges were made and your current plan remains unchanged.",
          orderId,
        });
        setAttemptKey(generateAttemptKey());
        setVerifyingReturn(false);
        return true;
      }

      // Still pending provider confirmation
      setStatusMessage({
        type: "pending",
        code: "PAYMENT_VERIFICATION_PENDING",
        text: "Payment is being verified with Dodo Payments. Please do not initiate another payment while verification completes.",
        orderId,
      });
      return false;
    } catch {
      setVerifyingReturn(false);
      return false;
    }
  }, []);

  React.useEffect(() => {
    if (!returnedOrderId) return;
    let cancelled = false;

    if (checkoutModeParam === "cancelled") {
      void fetch(`/api/v1/checkout/${encodeURIComponent(returnedOrderId)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "cancel" }),
      })
        .then((r) => r.json())
        .then((res) => {
          if (cancelled) return;
          if (res?.data?.activated) {
            void checkReturnedOrderStatus(returnedOrderId);
          } else {
            setStatusMessage({
              type: "info",
              text: "Your previous checkout session was cancelled safely. No charges were made and your current entitlements remain unchanged.",
            });
            setAttemptKey(generateAttemptKey());
          }
        })
        .catch(() => undefined);
      return () => {
        cancelled = true;
      };
    }

    if (checkoutModeParam === "return") {
      let polls = 0;
      const runPoll = async () => {
        if (cancelled) return;
        const settled = await checkReturnedOrderStatus(returnedOrderId);
        polls += 1;
        if (!settled && !cancelled && polls < 8) {
          window.setTimeout(runPoll, 3000);
        } else if (!cancelled) {
          setVerifyingReturn(false);
        }
      };
      void Promise.resolve().then(() => {
        if (!cancelled) {
          void runPoll();
        }
      });
    }

    return () => {
      cancelled = true;
    };
  }, [checkoutModeParam, returnedOrderId, checkReturnedOrderStatus]);

  const selectedPlan = OFFICIAL_PLANS[selectedSlug];
  const priceDisplay = formatMinorCurrency(
    selectedPlan.priceMinor,
    selectedPlan.currency,
    true,
  );

  const isPurchaseExpired =
    sessionState.authenticated &&
    !sessionState.purchaseAuthorized &&
    sessionState.purchaseAuthStatus !== "missing";

  async function handleCheckoutSubmit(e: React.FormEvent) {
    e.preventDefault();

    // Synchronous mutex prevents rapid double-clicks within the same millisecond
    if (inFlightMutexRef.current || submitting || verifyingReturn) {
      return;
    }

    if (!sessionState.authenticated) {
      setStatusMessage({
        type: "login_required",
        code: "ASIYST_LOGIN_REQUIRED",
        text: "Sign in to Asiyst to buy a plan.",
      });
      window.location.assign(sessionState.loginUrl);
      return;
    }

    if (!sessionState.purchaseAuthorized) {
      setStatusMessage({
        type: "purchase_expired",
        code: "PURCHASE_AUTHORIZATION_EXPIRED",
        text: "Purchase session expired. No new payment was initiated. Sign in again to continue purchasing.",
      });
      return;
    }

    inFlightMutexRef.current = true;
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
          const isExpired =
            payload?.error?.code === "PURCHASE_AUTHORIZATION_EXPIRED" ||
            payload?.error?.code === "PURCHASE_AUTHORIZATION_ALREADY_USED";
          setStatusMessage({
            type: isExpired ? "purchase_expired" : "login_required",
            code: payload?.error?.code,
            text:
              payload?.error?.message ||
              "Sign in to Asiyst to activate this plan.",
          });
          await loadSession(selectedSlug);
        } else if (!res.ok) {
          setStatusMessage({
            type: "error",
            code: payload?.error?.code,
            text:
              payload?.error?.message ||
              "Unable to activate Asiyst Zero. Ensure you are an organization owner or billing administrator.",
          });
        } else {
          setStatusMessage({
            type: "success",
            text: payload?.data?.alreadyActive
              ? "Asiyst Zero is already active for your organization."
              : "Asiyst Zero ($0) has been activated for your organization! Your entitlements are active in Asiyst-WEB.",
          });
          await loadSession(selectedSlug);
        }
        inFlightMutexRef.current = false;
        setSubmitting(false);
        return;
      }

      const res = await fetch("/api/v1/checkout/session", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": attemptKey,
        },
        body: JSON.stringify({
          plan: selectedSlug,
          idempotencyKey: attemptKey,
        }),
      });
      const payload = await res.json();

      if (res.status === 401) {
        const isExpired =
          payload?.error?.code === "PURCHASE_AUTHORIZATION_EXPIRED" ||
          payload?.error?.code === "PURCHASE_AUTHORIZATION_ALREADY_USED";
        setStatusMessage({
          type: isExpired ? "purchase_expired" : "login_required",
          code: payload?.error?.code,
          text:
            payload?.error?.message ||
            "Your purchase session expired. Sign in again on Asiyst to continue purchasing.",
        });
        await loadSession(selectedSlug);
        inFlightMutexRef.current = false;
        setSubmitting(false);
        return;
      }

      if (!res.ok) {
        const errCode = payload?.error?.code;
        setStatusMessage({
          type:
            errCode === "PAYMENT_VERIFICATION_IN_PROGRESS" ? "pending" : "error",
          code: errCode,
          orderId: payload?.error?.details?.orderId,
          text:
            payload?.error?.message ||
            "Unable to start Dodo Payments checkout session.",
        });
        if (errCode !== "PAYMENT_VERIFICATION_IN_PROGRESS") {
          setAttemptKey(generateAttemptKey());
        }
        inFlightMutexRef.current = false;
        setSubmitting(false);
        return;
      }

      if (payload?.data?.alreadyPaidAndActivated) {
        setStatusMessage({
          type: "success",
          orderId: payload.data.orderId,
          text: "Your previous payment was already confirmed and your subscription is now active! No duplicate charge was created.",
        });
        inFlightMutexRef.current = false;
        setSubmitting(false);
        return;
      }

      if (payload?.data?.checkoutUrl) {
        // Keep button locked during browser navigation to Dodo Payments so a second click is impossible
        window.location.assign(payload.data.checkoutUrl);
        return;
      }

      inFlightMutexRef.current = false;
      setSubmitting(false);
    } catch {
      setStatusMessage({
        type: "error",
        text: "A network error occurred while communicating with the Asiyst Plan billing server. Please check your connection before retrying.",
      });
      inFlightMutexRef.current = false;
      setSubmitting(false);
    }
  }

  // Verified Post-Payment Confirmation View (Phase 9)
  if (verifiedOrder?.isPaymentVerifiedAndActive) {
    const activePlan = OFFICIAL_PLANS[verifiedOrder.planSlug];
    return (
      <div className="mx-auto max-w-2xl rounded-3xl border-2 border-[#171D1B] bg-[#FCFCFD] p-8 shadow-sm space-y-6">
        <div className="flex items-center gap-3.5">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-[#171D1B] text-[#C6F36A]">
            <CheckCircle2 className="h-6 w-6" />
          </div>
          <div>
            <span className="text-[11px] font-mono font-bold uppercase tracking-widest text-emerald-700">
              Verified Payment Confirmation
            </span>
            <h1 className="text-2xl font-extrabold text-[#171D1B]">
              Payment Successful · {activePlan.name} Activated
            </h1>
          </div>
        </div>

        <p className="text-xs leading-relaxed text-[#69736C]">
          Your payment has been cryptographically verified with Dodo Payments and your organization&apos;s{" "}
          <strong className="text-[#171D1B]">{activePlan.name}</strong> entitlements are now active across Asiyst-WEB. A confirmation email and official receipt have been queued for your billing contacts.
        </p>

        <div className="rounded-2xl border border-[#D0CCC6] bg-[#F9F9F9] p-5 space-y-2.5 text-xs">
          <div className="flex justify-between">
            <span className="text-[#69736C]">Activated Plan</span>
            <span className="font-bold text-[#171D1B]">{activePlan.name}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-[#69736C]">Amount Verified</span>
            <span className="font-bold text-[#171D1B]">
              {formatMinorCurrency(activePlan.priceMinor, "USD", true)} USD / month
            </span>
          </div>
          {verifiedOrder.periodStart && verifiedOrder.periodEnd && (
            <div className="flex justify-between">
              <span className="text-[#69736C]">Subscription Period</span>
              <span className="font-mono text-[#171D1B]">
                {verifiedOrder.periodStart.slice(0, 10)} →{" "}
                {verifiedOrder.periodEnd.slice(0, 10)}
              </span>
            </div>
          )}
          <div className="flex justify-between">
            <span className="text-[#69736C]">Payment Reference</span>
            <span className="font-mono text-[#171D1B]">
              {verifiedOrder.paymentReference}
            </span>
          </div>
          {verifiedOrder.invoiceNumber && (
            <div className="flex justify-between">
              <span className="text-[#69736C]">Official Receipt #</span>
              <span className="font-mono font-bold text-[#171D1B]">
                {verifiedOrder.invoiceNumber}
              </span>
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-3 pt-2">
          <Link
            href="/account/invoices"
            className="inline-flex items-center gap-2 rounded-xl bg-[#171D1B] px-5 py-3 text-xs font-bold text-[#FCFCFD] hover:bg-[#2d3431] transition"
          >
            <FileText className="h-4 w-4 text-[#C6F36A]" />
            <span>View &amp; Download Receipt</span>
          </Link>
          <Link
            href="/account/subscriptions"
            className="inline-flex items-center gap-2 rounded-xl border border-[#3F434C] bg-[#F9F9F9] px-5 py-3 text-xs font-bold text-[#3F434C] hover:bg-[#D0CCC6]/35 transition"
          >
            <span>Manage Subscription</span>
          </Link>
          <a
            href={`${MAIN_APP_URL}/dashboard/settings?tab=billing`}
            className="inline-flex items-center gap-1.5 px-3 py-3 text-xs font-bold text-[#3F434C] hover:underline"
          >
            <span>Return to Asiyst Dashboard</span>
            <ArrowRight className="h-3.5 w-3.5" />
          </a>
        </div>
      </div>
    );
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
                  disabled={submitting || verifyingReturn}
                  onClick={() => {
                    if (plan.slug !== selectedSlug) {
                      setSelectedSlug(plan.slug);
                      setAttemptKey(generateAttemptKey());
                      setStatusMessage(null);
                    }
                  }}
                  className={`flex flex-col justify-between rounded-xl border p-4 text-left transition cursor-pointer disabled:opacity-60 ${
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
              Creating a checkout session sets your purchase intent to <code>checkout_pending</code>. Subscription benefits activate in Asiyst-WEB strictly after Dodo Payments confirms your payment via cryptographic webhook or server-to-server verification. No AI Credits are included in subscription plans.
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
            <div className="min-w-0">
              <h2 className="text-lg font-extrabold text-[#3F434C]">
                Payment &amp; Order Summary
              </h2>
              <p className="text-xs text-[#69736C] truncate">
                {sessionState.authenticated
                  ? `${sessionState.organizationName || "Verified Workspace"} · ${sessionState.userEmail || ""}`
                  : "Sign in to Asiyst to buy a plan"}
              </p>
            </div>
            <Building2 className="h-5 w-5 shrink-0 text-[#3F434C]" />
          </div>

          {sessionState.authenticated && sessionState.purchaseAuthorized && (
            <div className="flex items-center justify-between rounded-xl border border-emerald-700/25 bg-emerald-50/70 px-3.5 py-2.5 text-xs text-emerald-950">
              <div className="flex items-center gap-2 font-semibold">
                <Clock className="h-3.5 w-3.5 text-emerald-700" />
                <span>Purchase session active</span>
              </div>
              <span className="font-mono font-bold">
                {formatCountdown(sessionState.remainingSeconds)}
              </span>
            </div>
          )}

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
              <span className="text-[#69736C]">Authoritative Subtotal</span>
              <span className="font-semibold text-[#3F434C]">{priceDisplay} USD</span>
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

          {/* Unauthenticated Prompt */}
          {!sessionState.loading && !sessionState.authenticated && (
            <div className="rounded-xl border-2 border-[#3F434C] bg-[#F9F9F9] p-4 text-xs space-y-3">
              <div className="flex items-center gap-2 font-bold text-[#3F434C]">
                <LogIn className="h-4 w-4 shrink-0" />
                <span>Sign in to Asiyst to buy a plan</span>
              </div>
              <p className="text-[#69736C] leading-relaxed">
                Your selected plan (<strong>{selectedPlan.name}</strong>) will be preserved automatically. If you are already signed in on Asiyst Web, clicking below verifies your account immediately without asking for your password twice.
              </p>
              <a
                href={sessionState.loginUrl}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#3F434C] px-4 py-2.5 text-xs font-bold text-[#FCFCFD] hover:bg-[#2a2d33] transition"
              >
                <LogIn className="h-3.5 w-3.5 text-[#C6F36A]" />
                <span>Continue with Asiyst Account</span>
                <ArrowRight className="h-3.5 w-3.5" />
              </a>
            </div>
          )}

          {/* Expired Short-Lived Purchase Authorization Prompt (Phase 3 & 9) */}
          {!sessionState.loading && isPurchaseExpired && (
            <div className="rounded-xl border-2 border-amber-700/50 bg-amber-50 p-4 text-xs text-amber-950 space-y-3">
              <div className="flex items-center gap-2 font-bold">
                <Clock className="h-4 w-4 shrink-0 text-amber-800" />
                <span>Purchase session expired</span>
              </div>
              <p className="leading-relaxed">
                For your financial security, subscription purchase sessions expire after 15 minutes of inactivity. No new payment was initiated, and your main Asiyst dashboard session remains active. Sign in again to continue purchasing.
              </p>
              <a
                href={sessionState.reauthUrl}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#171D1B] px-4 py-2.5 text-xs font-bold text-[#FCFCFD] hover:bg-[#2d3431] transition"
              >
                <LogIn className="h-3.5 w-3.5 text-[#C6F36A]" />
                <span>Sign in again to continue purchasing</span>
                <ArrowRight className="h-3.5 w-3.5" />
              </a>
            </div>
          )}

          {/* Status Messages (Pending, Failed, Cancelled, Info) */}
          {statusMessage && (
            <div
              className={`rounded-xl border p-4 text-xs space-y-2.5 ${
                statusMessage.type === "success"
                  ? "border-emerald-700/30 bg-emerald-50 text-emerald-950"
                  : statusMessage.type === "pending"
                    ? "border-sky-700/30 bg-sky-50 text-sky-950"
                    : statusMessage.type === "info"
                      ? "border-[#D0CCC6] bg-[#F9F9F9] text-[#3F434C]"
                      : "border-amber-700/40 bg-amber-50 text-amber-950"
              }`}
            >
              <div className="flex items-center gap-2 font-bold">
                {statusMessage.type === "pending" ? (
                  <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
                ) : statusMessage.type === "error" ? (
                  <XCircle className="h-4 w-4 shrink-0" />
                ) : (
                  <AlertCircle className="h-4 w-4 shrink-0" />
                )}
                <span>
                  {statusMessage.type === "pending"
                    ? "Verifying Payment Status"
                    : statusMessage.code
                      ? `Notice (${statusMessage.code})`
                      : "Checkout Update"}
                </span>
              </div>
              <p className="leading-relaxed">{statusMessage.text}</p>

              {statusMessage.type === "pending" && returnedOrderId && (
                <button
                  type="button"
                  onClick={() => void checkReturnedOrderStatus(returnedOrderId)}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-sky-800/30 bg-white px-3 py-1.5 text-[11px] font-bold text-sky-950 hover:bg-sky-100/50 transition cursor-pointer"
                >
                  <RefreshCw className="h-3 w-3" />
                  <span>Check Verification Status</span>
                </button>
              )}

              {(statusMessage.type === "login_required" ||
                statusMessage.type === "purchase_expired") && (
                <a
                  href={
                    statusMessage.type === "purchase_expired"
                      ? sessionState.reauthUrl
                      : sessionState.loginUrl
                  }
                  className="inline-flex items-center gap-1.5 rounded-lg bg-[#3F434C] px-3.5 py-2 text-xs font-bold text-[#FCFCFD] mt-1"
                >
                  <LogIn className="h-3.5 w-3.5 text-[#C6F36A]" />
                  <span>
                    {statusMessage.type === "purchase_expired"
                      ? "Sign in again on Asiyst"
                      : "Sign in on Asiyst"}
                  </span>
                </a>
              )}

              {statusMessage.orderId && (
                <p className="font-mono text-[11px] pt-1">
                  Purchase Intent ID: {statusMessage.orderId}
                </p>
              )}
            </div>
          )}

          {/* Primary Action Button */}
          {isPurchaseExpired ? (
            <a
              href={sessionState.reauthUrl}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#171D1B] px-5 py-3.5 text-sm font-bold text-[#FCFCFD] hover:bg-[#2a2d33] transition shadow-xs"
            >
              <LogIn className="h-4 w-4 text-[#C6F36A]" />
              <span>Sign in Again to Unlock Purchase</span>
            </a>
          ) : (
            <button
              type="submit"
              disabled={
                submitting ||
                verifyingReturn ||
                sessionState.loading ||
                statusMessage?.type === "pending"
              }
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#3F434C] px-5 py-3.5 text-sm font-bold text-[#FCFCFD] hover:bg-[#2a2d33] disabled:opacity-60 disabled:cursor-not-allowed transition shadow-xs cursor-pointer"
            >
              {submitting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin text-[#C6F36A]" />
                  <span>Processing payment securely — do not refresh…</span>
                </>
              ) : verifyingReturn || statusMessage?.type === "pending" ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin text-[#C6F36A]" />
                  <span>Payment verification in progress…</span>
                </>
              ) : !sessionState.authenticated ? (
                <>
                  <LogIn className="h-4 w-4 text-[#C6F36A]" />
                  <span>Sign in to Asiyst to buy a plan</span>
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
          )}

          <div className="flex items-center justify-center gap-1.5 text-[11px] text-[#69736C]">
            <Lock className="h-3 w-3" />
            <span>
              {selectedPlan.requiresDodoCheckout
                ? "Idempotent checkout · Server-verified webhook activation"
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
