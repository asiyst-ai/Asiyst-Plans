"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  CreditCard,
  HelpCircle,
  LogIn,
} from "lucide-react";
import { AsiystPlanLogoMark } from "@/components/brand-logo";

const MAIN_APP_URL =
  process.env.NEXT_PUBLIC_MAIN_APP_URL || "https://asiyst.com";

export function PlanNavbar() {
  const pathname = usePathname();
  const [authState, setAuthState] = React.useState<{
    loaded: boolean;
    authenticated: boolean;
    email?: string;
    organizationName?: string;
    loginUrl: string;
  }>({
    loaded: false,
    authenticated: false,
    loginUrl: `${MAIN_APP_URL}/api/v1/auth/sso/plan/start?returnPath=%2Fplans&source=direct_plan_login`,
  });

  React.useEffect(() => {
    let active = true;
    let returnPath = pathname || "/plans";
    let planParam = "";
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      const candidatePlan = params.get("plan") || params.get("selected") || "";
      if (candidatePlan) {
        planParam = candidatePlan;
        const cleanSearch = new URLSearchParams();
        cleanSearch.set(
          pathname === "/checkout" ? "plan" : "selected",
          candidatePlan,
        );
        returnPath = `${pathname || "/plans"}?${cleanSearch.toString()}`;
      }
    }
    const query = new URLSearchParams({ returnPath });
    if (planParam) query.set("plan", planParam);
    fetch(`/api/v1/auth/session?${query.toString()}`, {
      cache: "no-store",
    })
      .then((res) => res.json())
      .then((body) => {
        if (!active) return;
        const data = body?.data;
        setAuthState({
          loaded: true,
          authenticated: Boolean(data?.authenticated),
          email: data?.user?.email,
          organizationName: data?.organization?.name,
          loginUrl:
            data?.loginUrl ||
            `${MAIN_APP_URL}/api/v1/auth/sso/plan/start?returnPath=${encodeURIComponent(returnPath)}&source=direct_plan_login`,
        });
      })
      .catch(() => {
        if (active) {
          setAuthState((prev) => ({ ...prev, loaded: true, authenticated: false }));
        }
      });
    return () => {
      active = false;
    };
  }, [pathname]);

  const navLinks = [
    { href: "/products", label: "Products" },
    { href: "/plans", label: "Plans" },
    { href: "/offers", label: "Compare & Benefits" },
    { href: "/account/subscriptions", label: "My Subscriptions" },
  ];

  return (
    <header className="sticky top-0 z-50 w-full border-b border-[#D0CCC6] bg-[#FCFCFD]/95 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
        <div className="flex items-center gap-8">
          <Link href="/" className="flex items-center gap-2.5 group">
            <AsiystPlanLogoMark
              size={34}
              className="shadow-xs transition-transform duration-200 group-hover:scale-105"
            />
            <div className="flex flex-col">
              <span className="text-base font-extrabold tracking-tight text-[#171D1B] leading-none">
                Asiyst{" "}
                <span className="rounded bg-[#C6F36A]/45 px-1.5 py-0.5 text-xs font-bold uppercase tracking-wider text-[#171D1B]">
                  Plan
                </span>
              </span>
              <span className="mt-0.5 text-[10px] font-mono text-[#69736C] tracking-wider">
                plan.asiyst.com
              </span>
            </div>
          </Link>

          <nav className="hidden md:flex items-center gap-1" aria-label="Main navigation">
            {navLinks.map((item) => {
              const active =
                pathname === item.href ||
                (item.href !== "/" && pathname?.startsWith(item.href));
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`rounded-lg px-3.5 py-2 text-sm font-medium transition ${
                    active
                      ? "bg-[#3F434C] text-[#FCFCFD]"
                      : "text-[#3F434C] hover:bg-[#D0CCC6]/35"
                  }`}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>
        </div>

        <div className="flex items-center gap-3">
          <a
            href={`${MAIN_APP_URL}/support`}
            className="hidden sm:inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium text-[#3F434C] hover:bg-[#D0CCC6]/30 transition"
          >
            <HelpCircle className="h-3.5 w-3.5 text-[#69736C]" />
            <span>Help</span>
          </a>

          {authState.authenticated ? (
            <Link
              href="/account"
              className="inline-flex items-center gap-2 rounded-lg bg-[#3F434C] px-3.5 py-2 text-xs font-semibold text-[#FCFCFD] hover:bg-[#2d3037] transition shadow-xs"
            >
              <LayoutDashboard className="h-3.5 w-3.5 text-[#C6F36A]" />
              <span className="max-w-[160px] truncate">
                {authState.organizationName || authState.email || "My Account"}
              </span>
            </Link>
          ) : (
            <a
              href={authState.loginUrl}
              className="inline-flex items-center gap-1.5 rounded-lg bg-[#3F434C] px-4 py-2 text-xs font-semibold text-[#FCFCFD] hover:bg-[#2d3037] transition shadow-xs"
            >
              <LogIn className="h-3.5 w-3.5 text-[#C6F36A]" />
              <span>Sign in on Asiyst</span>
            </a>
          )}
        </div>
      </div>
    </header>
  );
}

export function PlanFooter() {
  return (
    <footer className="mt-auto border-t border-[#D0CCC6] bg-[#FCFCFD]">
      <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 gap-8 md:grid-cols-4">
          <div className="space-y-3">
            <div className="flex items-center gap-2.5">
              <AsiystPlanLogoMark size={28} />
              <span className="text-base font-extrabold text-[#171D1B]">
                Asiyst Plan
              </span>
            </div>
            <p className="text-xs leading-relaxed text-[#69736C]">
              Centralized subscription, billing, and organization entitlement management for the Asiyst ecosystem.
            </p>
            <p className="text-[11px] font-mono text-[#69736C]">
              Domain: https://plan.asiyst.com
            </p>
          </div>

          <div>
            <h3 className="text-xs font-bold uppercase tracking-wider text-[#3F434C]">
              Official Plans
            </h3>
            <ul className="mt-3 space-y-2 text-xs text-[#69736C]">
              <li>
                <Link href="/checkout?plan=zero" className="hover:text-[#3F434C]">
                  Asiyst Zero — $0/month
                </Link>
              </li>
              <li>
                <Link href="/checkout?plan=pulse" className="hover:text-[#3F434C]">
                  Asiyst Pulse — $24/month
                </Link>
              </li>
              <li>
                <Link href="/checkout?plan=vector" className="hover:text-[#3F434C]">
                  Asiyst Vector — $54/month
                </Link>
              </li>
              <li>
                <Link href="/checkout?plan=quantum" className="hover:text-[#3F434C]">
                  Asiyst Quantum — $154/month
                </Link>
              </li>
            </ul>
          </div>

          <div>
            <h3 className="text-xs font-bold uppercase tracking-wider text-[#3F434C]">
              Subscription &amp; Billing
            </h3>
            <ul className="mt-3 space-y-2 text-xs text-[#69736C]">
              <li>
                <Link href="/account" className="hover:text-[#3F434C]">
                  Account Overview
                </Link>
              </li>
              <li>
                <Link href="/account/subscriptions" className="hover:text-[#3F434C]">
                  Manage Subscription
                </Link>
              </li>
              <li>
                <Link href="/account/billing" className="hover:text-[#3F434C]">
                  Payment History
                </Link>
              </li>
              <li>
                <Link href="/account/invoices" className="hover:text-[#3F434C]">
                  Invoices &amp; Receipts
                </Link>
              </li>
              <li>
                <Link href="/account/usage" className="hover:text-[#3F434C]">
                  Plan Benefits &amp; Quotas
                </Link>
              </li>
            </ul>
          </div>

          <div>
            <h3 className="text-xs font-bold uppercase tracking-wider text-[#3F434C]">
              Asiyst Ecosystem
            </h3>
            <ul className="mt-3 space-y-2 text-xs text-[#69736C]">
              <li>
                <a href="https://asiyst.com" className="hover:text-[#3F434C]">
                  Asiyst AI Web Platform (asiyst.com)
                </a>
              </li>
              <li>
                <a
                  href="https://asiyst.com/dashboard/ai/credits"
                  className="hover:text-[#3F434C] inline-flex items-center gap-1"
                >
                  <CreditCard className="h-3 w-3" />
                  <span>AI Credits (Separate Purchase)</span>
                </a>
              </li>
              <li>
                <a href="mailto:support@asiyst.com" className="hover:text-[#3F434C]">
                  Billing Support (support@asiyst.com)
                </a>
              </li>
            </ul>
          </div>
        </div>

        <div className="mt-10 flex flex-col sm:flex-row items-center justify-between border-t border-[#D0CCC6] pt-6 text-xs text-[#69736C] gap-4">
          <p>© {new Date().getUTCFullYear()} Asiyst. All rights reserved.</p>
          <p className="text-[11px]">
            Organization-owned subscriptions · AI Credits excluded from subscription plans
          </p>
        </div>
      </div>
    </footer>
  );
}
