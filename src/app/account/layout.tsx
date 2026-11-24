"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Layers,
  CreditCard,
  FileText,
  BarChart3,
  Settings,
  LogIn,
  ArrowRight,
  Lock,
} from "lucide-react";
import { PlanNavbar, PlanFooter } from "@/components/navigation";

const ACCOUNT_TABS = [
  { href: "/account", label: "Overview", icon: LayoutDashboard },
  { href: "/account/subscriptions", label: "Subscriptions", icon: Layers },
  { href: "/account/billing", label: "Billing & Payments", icon: CreditCard },
  { href: "/account/invoices", label: "Invoices & Receipts", icon: FileText },
  { href: "/account/usage", label: "Plan Benefits & Usage", icon: BarChart3 },
  { href: "/account/settings", label: "Billing Admins & Contact", icon: Settings },
];

const MAIN_APP_URL =
  process.env.NEXT_PUBLIC_MAIN_APP_URL || "https://asiyst.com";

export default function AccountLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [auth, setAuth] = React.useState<{
    loading: boolean;
    authenticated: boolean;
    loginUrl: string;
  }>({
    loading: true,
    authenticated: false,
    loginUrl: `${MAIN_APP_URL}/login`,
  });

  React.useEffect(() => {
    let active = true;
    fetch("/api/v1/auth/session")
      .then((res) => res.json())
      .then((body) => {
        if (!active) return;
        setAuth({
          loading: false,
          authenticated: Boolean(body?.data?.authenticated),
          loginUrl: body?.data?.loginUrl || `${MAIN_APP_URL}/login`,
        });
      })
      .catch(() => {
        if (active) {
          setAuth({
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

  return (
    <div className="min-h-screen flex flex-col bg-[#F9F9F9] text-[#3F434C]">
      <PlanNavbar />

      {auth.authenticated && (
        <div className="border-b border-[#D0CCC6] bg-[#FCFCFD]">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <div className="flex items-center gap-1 overflow-x-auto py-2.5">
              {ACCOUNT_TABS.map((tab) => {
                const Icon = tab.icon;
                const isActive = pathname === tab.href;
                return (
                  <Link
                    key={tab.href}
                    href={tab.href}
                    className={`inline-flex items-center gap-2 rounded-xl px-3.5 py-2 text-xs font-bold whitespace-nowrap transition ${
                      isActive
                        ? "bg-[#3F434C] text-[#FCFCFD]"
                        : "text-[#3F434C] hover:bg-[#D0CCC6]/35"
                    }`}
                  >
                    <Icon
                      className={`h-3.5 w-3.5 ${
                        isActive ? "text-[#C6F36A]" : "text-[#69736C]"
                      }`}
                    />
                    <span>{tab.label}</span>
                  </Link>
                );
              })}
            </div>
          </div>
        </div>
      )}

      <main className="flex-1 mx-auto w-full max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
        {auth.loading ? (
          <div className="rounded-2xl border border-[#D0CCC6] bg-[#FCFCFD] p-12 text-center text-xs text-[#69736C]">
            Verifying Asiyst Web authentication session...
          </div>
        ) : !auth.authenticated ? (
          <div className="mx-auto max-w-lg rounded-3xl border-2 border-[#3F434C] bg-[#FCFCFD] p-8 text-center space-y-5 shadow-sm my-8">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-[#3F434C] text-[#C6F36A]">
              <Lock className="h-6 w-6" />
            </div>
            <div className="space-y-2">
              <h1 className="text-2xl font-extrabold text-[#3F434C]">
                Sign in on Asiyst Web Required
              </h1>
              <p className="text-xs leading-relaxed text-[#69736C]">
                Account subscription management, billing history, invoices, and quota monitoring are strictly accessible to users signed in on Asiyst Web. You can explore plans without signing in, or sign in now to manage your organization.
              </p>
            </div>
            <div className="flex flex-col sm:flex-row items-center justify-center gap-3 pt-2">
              <a
                href={auth.loginUrl}
                className="inline-flex w-full sm:w-auto items-center justify-center gap-2 rounded-xl bg-[#3F434C] px-5 py-3 text-xs font-bold text-[#FCFCFD] hover:bg-[#2a2d33] transition"
              >
                <LogIn className="h-4 w-4 text-[#C6F36A]" />
                <span>Sign in on Asiyst Web</span>
                <ArrowRight className="h-3.5 w-3.5" />
              </a>
              <Link
                href="/plans"
                className="inline-flex w-full sm:w-auto items-center justify-center gap-2 rounded-xl border border-[#3F434C] bg-[#F9F9F9] px-5 py-3 text-xs font-bold text-[#3F434C] hover:bg-[#D0CCC6]/30 transition"
              >
                <span>View Public Plans</span>
              </Link>
            </div>
          </div>
        ) : (
          children
        )}
      </main>

      <PlanFooter />
    </div>
  );
}
