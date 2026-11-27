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
  Building2,
  ShieldAlert,
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

export const PLANS_ORG_STORAGE_KEY = "asiyst_plans_selected_org";
export const PLANS_ORG_CHANGE_EVENT = "asiyst:plans-org-changed";

interface SessionOrgSummary {
  id: string;
  name: string;
  role: string;
  canManageBilling: boolean;
}

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
    organizations: SessionOrgSummary[];
    activeOrg: SessionOrgSummary | null;
  }>({
    loading: true,
    authenticated: false,
    loginUrl: `${MAIN_APP_URL}/login`,
    organizations: [],
    activeOrg: null,
  });

  const loadSession = React.useCallback(async (explicitOrgId?: string | null) => {
    const returnPath = pathname || "/account";
    const storedOrg =
      explicitOrgId ??
      (typeof window !== "undefined"
        ? window.localStorage.getItem(PLANS_ORG_STORAGE_KEY)
        : null);
    const qs = new URLSearchParams({ returnPath });
    if (storedOrg) qs.set("organizationId", storedOrg);

    try {
      const res = await fetch(`/api/v1/auth/session?${qs.toString()}`, {
        cache: "no-store",
      });
      const body = await res.json();
      const orgs: SessionOrgSummary[] = Array.isArray(body?.data?.organizations)
        ? body.data.organizations
        : [];
      const current = body?.data?.organization || orgs[0] || null;
      if (current?.id && typeof window !== "undefined") {
        window.localStorage.setItem(PLANS_ORG_STORAGE_KEY, current.id);
      }
      setAuth({
        loading: false,
        authenticated: Boolean(body?.data?.authenticated),
        loginUrl:
          body?.data?.loginUrl ||
          `${MAIN_APP_URL}/api/v1/auth/sso/plan/start?returnPath=${encodeURIComponent(returnPath)}&source=direct_plan_login`,
        organizations: orgs,
        activeOrg: current,
      });
    } catch {
      setAuth({
        loading: false,
        authenticated: false,
        loginUrl: `${MAIN_APP_URL}/api/v1/auth/sso/plan/start?returnPath=${encodeURIComponent(returnPath)}&source=direct_plan_login`,
        organizations: [],
        activeOrg: null,
      });
    }
  }, [pathname]);

  React.useEffect(() => {
    let active = true;
    const returnPath = pathname || "/account";
    const storedOrg =
      typeof window !== "undefined"
        ? window.localStorage.getItem(PLANS_ORG_STORAGE_KEY)
        : null;
    const qs = new URLSearchParams({ returnPath });
    if (storedOrg) qs.set("organizationId", storedOrg);

    fetch(`/api/v1/auth/session?${qs.toString()}`, { cache: "no-store" })
      .then((res) => res.json())
      .then((body) => {
        if (!active) return;
        const orgs: SessionOrgSummary[] = Array.isArray(body?.data?.organizations)
          ? body.data.organizations
          : [];
        const current = body?.data?.organization || orgs[0] || null;
        if (current?.id && typeof window !== "undefined") {
          window.localStorage.setItem(PLANS_ORG_STORAGE_KEY, current.id);
        }
        setAuth({
          loading: false,
          authenticated: Boolean(body?.data?.authenticated),
          loginUrl:
            body?.data?.loginUrl ||
            `${MAIN_APP_URL}/api/v1/auth/sso/plan/start?returnPath=${encodeURIComponent(returnPath)}&source=direct_plan_login`,
          organizations: orgs,
          activeOrg: current,
        });
      })
      .catch(() => {
        if (!active) return;
        setAuth({
          loading: false,
          authenticated: false,
          loginUrl: `${MAIN_APP_URL}/api/v1/auth/sso/plan/start?returnPath=${encodeURIComponent(returnPath)}&source=direct_plan_login`,
          organizations: [],
          activeOrg: null,
        });
      });
    return () => {
      active = false;
    };
  }, [pathname]);

  function handleOrgChange(nextOrgId: string) {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(PLANS_ORG_STORAGE_KEY, nextOrgId);
      window.dispatchEvent(new CustomEvent(PLANS_ORG_CHANGE_EVENT, { detail: nextOrgId }));
    }
    void loadSession(nextOrgId);
  }

  return (
    <div className="min-h-screen flex flex-col bg-[#F9F9F9] text-[#3F434C]">
      <PlanNavbar />

      {auth.authenticated && (
        <div className="border-b border-[#D0CCC6] bg-[#FCFCFD]">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
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

            {auth.organizations.length > 0 && (
              <div className="flex items-center gap-2 py-2 sm:py-0">
                <Building2 className="h-3.5 w-3.5 text-[#69736C] shrink-0" />
                <select
                  aria-label="Active Organization"
                  value={auth.activeOrg?.id || ""}
                  onChange={(e) => handleOrgChange(e.target.value)}
                  className="rounded-lg border border-[#D0CCC6] bg-[#F9F9F9] px-2.5 py-1.5 text-xs font-bold text-[#3F434C]"
                >
                  {auth.organizations.map((org) => (
                    <option key={org.id} value={org.id}>
                      {org.name} ({org.role})
                    </option>
                  ))}
                </select>
              </div>
            )}
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
          <div className="space-y-6">
            {auth.activeOrg && !auth.activeOrg.canManageBilling && (
              <div className="rounded-xl border border-amber-700/30 bg-amber-50 px-4 py-3 text-xs text-amber-950 flex items-center gap-2.5">
                <ShieldAlert className="h-4 w-4 shrink-0 text-amber-700" />
                <span>
                  You are viewing <strong>{auth.activeOrg.name}</strong> with role{" "}
                  <strong>{auth.activeOrg.role}</strong>. Billing administration, invoices, and subscription changes require{" "}
                  <strong>Owner</strong> or <strong>Billing Administrator</strong> permissions.
                </span>
              </div>
            )}
            {children}
          </div>
        )}
      </main>

      <PlanFooter />
    </div>
  );
}
