"use client";

import * as React from "react";
import { useSearchParams } from "next/navigation";
import {
  Mail,
  UserPlus,
  Bell,
  CheckCircle2,
  AlertCircle,
  Users,
  RefreshCw,
  Trash2,
  ShieldCheck,
} from "lucide-react";
import { PLANS_ORG_CHANGE_EVENT, PLANS_ORG_STORAGE_KEY } from "../layout";

interface OrgMember {
  id: string;
  user_id: string;
  role: string;
  can_manage_billing: boolean;
  status?: string;
  created_at: string;
}

interface PendingInvite {
  id: string;
  email: string;
  role: string;
  can_manage_billing: boolean;
  status: string;
  expires_at: string;
  created_at: string;
}

function AccountSettingsContent() {
  const searchParams = useSearchParams();
  const inviteToken = searchParams.get("invite")?.trim() || null;
  const verifyContactToken = searchParams.get("verifyContact")?.trim() || null;
  const queryOrgId = searchParams.get("orgId")?.trim() || null;

  const [organizationId, setOrganizationId] = React.useState<string | null>(null);
  const [organizationName, setOrganizationName] = React.useState<string>("Organization");
  const [callerRole, setCallerRole] = React.useState<string>("member");
  const [canManageBilling, setCanManageBilling] = React.useState<boolean>(false);

  const [billingEmail, setBillingEmail] = React.useState("");
  const [companyName, setCompanyName] = React.useState("");
  const [contactVerified, setContactVerified] = React.useState<boolean>(false);
  const [inviteEmail, setInviteEmail] = React.useState("");
  const [inviteRole, setInviteRole] = React.useState<"admin" | "manager" | "member" | "viewer">("admin");
  const [inviteBillingPerm, setInviteBillingPerm] = React.useState(true);

  const [members, setMembers] = React.useState<OrgMember[]>([]);
  const [invitations, setInvitations] = React.useState<PendingInvite[]>([]);
  const [usageAlerts, setUsageAlerts] = React.useState(true);
  const [productUpdates, setProductUpdates] = React.useState(true);

  const [savingContact, setSavingContact] = React.useState(false);
  const [sendingInvite, setSendingInvite] = React.useState(false);
  const [savingPrefs, setSavingPrefs] = React.useState(false);
  const [acceptingInvite, setAcceptingInvite] = React.useState(false);
  const [invitePreview, setInvitePreview] = React.useState<{
    organizationId: string;
    organizationName: string;
    email: string;
    role: string;
    canManageBilling: boolean;
    status: string;
  } | null>(null);

  const [feedback, setFeedback] = React.useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);

  const loadSettings = React.useCallback(async (explicitOrgId?: string | null) => {
    const selectedOrg =
      explicitOrgId ||
      queryOrgId ||
      (typeof window !== "undefined"
        ? window.localStorage.getItem(PLANS_ORG_STORAGE_KEY)
        : null);
    const orgQs = selectedOrg ? `?organizationId=${encodeURIComponent(selectedOrg)}` : "";

    try {
      const [sessionRes, prefsRes] = await Promise.all([
        fetch(`/api/v1/auth/session${orgQs}`, { cache: "no-store" }),
        fetch(`/api/v1/notifications/preferences${orgQs}`, { cache: "no-store" }),
      ]);

      let activeOrgId = selectedOrg;
      if (sessionRes.ok) {
        const sBody = await sessionRes.json();
        const org = sBody?.data?.organization;
        if (org?.id) {
          activeOrgId = org.id;
          setOrganizationId(org.id);
          setOrganizationName(org.name || "Organization");
          setCallerRole(org.role || "member");
          setCanManageBilling(Boolean(org.canManageBilling));
        }
      }

      if (activeOrgId) {
        const orgRes = await fetch(`/api/v1/organizations/${encodeURIComponent(activeOrgId)}/billing`, {
          cache: "no-store",
        });
        if (orgRes.ok) {
          const orgBody = await orgRes.json();
          const contact = orgBody?.data?.billingContact;
          if (contact?.billing_email) setBillingEmail(contact.billing_email);
          if (contact?.company_name) setCompanyName(contact.company_name);
          setContactVerified(Boolean(contact?.email_verified));
          setMembers(orgBody?.data?.members || []);
          setInvitations(orgBody?.data?.pendingInvitations || []);
        }
      }

      if (prefsRes.ok) {
        const prefsBody = await prefsRes.json();
        const prefs = prefsBody.data?.preferences;
        if (prefs) {
          setUsageAlerts(Boolean(prefs.usage_alerts ?? true));
          setProductUpdates(Boolean(prefs.product_updates ?? true));
        }
      }
    } catch {
      // Handled gracefully
    }
  }, [queryOrgId]);

  React.useEffect(() => {
    const t = setTimeout(() => {
      void loadSettings();
    }, 0);
    const onOrgChange = (e: Event) => {
      const nextId = (e as CustomEvent<string>).detail;
      void loadSettings(nextId);
    };
    window.addEventListener(PLANS_ORG_CHANGE_EVENT, onOrgChange);
    return () => {
      clearTimeout(t);
      window.removeEventListener(PLANS_ORG_CHANGE_EVENT, onOrgChange);
    };
  }, [loadSettings]);

  // Load billing admin invitation preview when ?invite= is present
  React.useEffect(() => {
    if (!inviteToken || !queryOrgId) return;
    let active = true;
    fetch(
      `/api/v1/organizations/${encodeURIComponent(queryOrgId)}/billing-admins/accept?token=${encodeURIComponent(inviteToken)}`,
      { cache: "no-store" },
    )
      .then((res) => (res.ok ? res.json() : null))
      .then((body) => {
        if (active && body?.data?.invitation) {
          setInvitePreview(body.data.invitation);
        }
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [inviteToken, queryOrgId]);

  // Verify external billing contact when ?verifyContact= is present
  React.useEffect(() => {
    if (!verifyContactToken || !queryOrgId) return;
    fetch(`/api/v1/organizations/${encodeURIComponent(queryOrgId)}/billing-contact/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: verifyContactToken }),
    })
      .then((res) => res.json().then((b) => ({ ok: res.ok, body: b })))
      .then(({ ok, body }) => {
        if (ok) {
          setContactVerified(true);
          setFeedback({ type: "success", text: "Billing contact email verified successfully." });
        } else {
          setFeedback({
            type: "error",
            text: body?.error?.message || "Unable to verify billing contact email.",
          });
        }
      })
      .catch(() => {});
  }, [verifyContactToken, queryOrgId]);

  async function handleAcceptBillingInvite() {
    if (!inviteToken || !queryOrgId || acceptingInvite) return;
    setAcceptingInvite(true);
    setFeedback(null);
    try {
      const res = await fetch(
        `/api/v1/organizations/${encodeURIComponent(queryOrgId)}/billing-admins/accept`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token: inviteToken }),
        },
      );
      const body = await res.json();
      if (!res.ok) {
        setFeedback({
          type: "error",
          text: body?.error?.message || "Unable to accept invitation.",
        });
      } else {
        setInvitePreview(null);
        setFeedback({
          type: "success",
          text: "Invitation accepted! Your organization billing access is now active.",
        });
        void loadSettings(queryOrgId);
      }
    } catch {
      setFeedback({ type: "error", text: "Network error accepting invitation." });
    } finally {
      setAcceptingInvite(false);
    }
  }

  async function handleSaveContact(e: React.FormEvent) {
    e.preventDefault();
    if (!organizationId || !canManageBilling) return;
    setSavingContact(true);
    setFeedback(null);
    try {
      const res = await fetch(
        `/api/v1/organizations/${organizationId}/billing-contact`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            billingEmail,
            companyName,
          }),
        },
      );
      const body = await res.json();
      if (!res.ok) {
        setFeedback({
          type: "error",
          text: body?.error?.message || "Unable to update billing contact.",
        });
      } else {
        const reqVerify = Boolean(body?.data?.verificationRequired);
        setContactVerified(!reqVerify);
        setFeedback({
          type: "success",
          text: reqVerify
            ? "Billing contact saved. A verification link was sent to the new billing email."
            : "Organization billing contact updated and verified.",
        });
      }
    } catch {
      setFeedback({
        type: "error",
        text: "Network error saving billing contact.",
      });
    } finally {
      setSavingContact(false);
    }
  }

  async function handleInviteAdmin(e: React.FormEvent) {
    e.preventDefault();
    if (!organizationId || !inviteEmail.trim() || callerRole !== "owner") return;
    setSendingInvite(true);
    setFeedback(null);
    try {
      const res = await fetch(
        `/api/v1/organizations/${organizationId}/billing-admins/invite`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            email: inviteEmail.trim(),
            role: inviteRole,
            canManageBilling: inviteBillingPerm,
            action: "invite",
          }),
        },
      );
      const body = await res.json();
      if (!res.ok) {
        setFeedback({
          type: "error",
          text: body?.error?.message || "Unable to invite billing administrator.",
        });
      } else {
        setInviteEmail("");
        setFeedback({
          type: "success",
          text: "Billing administrator invitation sent via secure expiring token.",
        });
        void loadSettings(organizationId);
      }
    } catch {
      setFeedback({
        type: "error",
        text: "Network error sending billing administrator invitation.",
      });
    } finally {
      setSendingInvite(false);
    }
  }

  async function handleInvitationAction(invitationId: string, action: "resend" | "revoke") {
    if (!organizationId || callerRole !== "owner") return;
    setFeedback(null);
    const res = await fetch(`/api/v1/organizations/${organizationId}/billing-admins/invite`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, invitationId }),
    });
    const body = await res.json();
    if (!res.ok) {
      setFeedback({ type: "error", text: body?.error?.message || `Unable to ${action} invitation.` });
    } else {
      setFeedback({
        type: "success",
        text: action === "resend" ? "Invitation refreshed and re-sent." : "Invitation revoked.",
      });
      void loadSettings(organizationId);
    }
  }

  async function handleRevokeMemberBilling(userId: string) {
    if (!organizationId || callerRole !== "owner") return;
    setFeedback(null);
    const res = await fetch(`/api/v1/organizations/${organizationId}/billing-admins/invite`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "remove", userId }),
    });
    const body = await res.json();
    if (!res.ok) {
      setFeedback({ type: "error", text: body?.error?.message || "Unable to revoke billing access." });
    } else {
      setFeedback({ type: "success", text: "Billing administrator access revoked." });
      void loadSettings(organizationId);
    }
  }

  async function handleSavePreferences(
    nextUsageAlerts: boolean,
    nextProductUpdates: boolean,
  ) {
    setUsageAlerts(nextUsageAlerts);
    setProductUpdates(nextProductUpdates);
    setSavingPrefs(true);
    setFeedback(null);
    try {
      const res = await fetch("/api/v1/notifications/preferences", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          organizationId: organizationId || undefined,
          usageAlerts: nextUsageAlerts,
          productUpdates: nextProductUpdates,
        }),
      });
      if (res.ok) {
        setFeedback({
          type: "success",
          text: "Notification preferences saved.",
        });
      }
    } finally {
      setSavingPrefs(false);
    }
  }

  return (
    <div className="space-y-8">
      <div>
        <span className="text-xs font-mono font-bold uppercase tracking-widest text-[#69736C]">
          {organizationName} · Billing Administration
        </span>
        <h1 className="text-2xl sm:text-3xl font-extrabold text-[#3F434C] mt-1">
          Billing Contact, Administrators &amp; Notifications
        </h1>
        <p className="text-xs text-[#69736C] mt-1">
          Manage who receives billing emails and who is authorized to manage subscriptions for your organization.
        </p>
      </div>

      {invitePreview && (
        <div className="rounded-2xl border-2 border-[#3F434C] bg-[#FCFCFD] p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2 text-xs font-bold text-[#3F434C]">
              <ShieldCheck className="h-4 w-4 text-emerald-700" />
              <span>Pending Billing Administrator Invitation</span>
            </div>
            <p className="text-xs text-[#69736C]">
              You have been invited to <strong>{invitePreview.organizationName}</strong> as{" "}
              <strong>{invitePreview.role}</strong> ({invitePreview.email}).
            </p>
          </div>
          {invitePreview.status === "pending" ? (
            <button
              type="button"
              onClick={handleAcceptBillingInvite}
              disabled={acceptingInvite}
              className="rounded-xl bg-[#3F434C] px-4 py-2.5 text-xs font-bold text-[#FCFCFD] hover:bg-[#2a2d33] disabled:opacity-60 transition cursor-pointer"
            >
              {acceptingInvite ? "Accepting..." : "Accept Invitation"}
            </button>
          ) : (
            <span className="text-xs font-bold uppercase text-amber-700">
              Status: {invitePreview.status}
            </span>
          )}
        </div>
      )}

      {feedback && (
        <div
          className={`rounded-xl border p-4 text-xs font-semibold flex items-center gap-2 ${
            feedback.type === "success"
              ? "border-[#3F434C] bg-[#C6F36A]/25 text-[#171D1B]"
              : "border-amber-700/40 bg-amber-50 text-amber-950"
          }`}
        >
          {feedback.type === "success" ? (
            <CheckCircle2 className="h-4 w-4 shrink-0" />
          ) : (
            <AlertCircle className="h-4 w-4 shrink-0" />
          )}
          <span>{feedback.text}</span>
        </div>
      )}

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
        {/* Billing Contact Form */}
        <form
          onSubmit={handleSaveContact}
          className="rounded-2xl border border-[#D0CCC6] bg-[#FCFCFD] p-6 space-y-5"
        >
          <div className="flex items-center justify-between border-b border-[#D0CCC6] pb-4">
            <div className="flex items-center gap-2.5">
              <Mail className="h-4 w-4 text-[#3F434C]" />
              <div>
                <h2 className="text-base font-extrabold text-[#3F434C]">
                  Organization Billing Contact
                </h2>
                <p className="text-xs text-[#69736C]">
                  Verified billing contacts receive invoices, receipts, and renewal notices.
                </p>
              </div>
            </div>
            {billingEmail && (
              <span
                className={`rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase ${
                  contactVerified
                    ? "bg-emerald-100 text-emerald-800"
                    : "bg-amber-100 text-amber-800"
                }`}
              >
                {contactVerified ? "Verified" : "Pending Verification"}
              </span>
            )}
          </div>

          <div className="space-y-4 text-xs">
            <div className="space-y-1.5">
              <label className="block font-bold text-[#3F434C]">
                Billing Contact Email
              </label>
              <input
                type="email"
                required
                disabled={!canManageBilling}
                value={billingEmail}
                onChange={(e) => setBillingEmail(e.target.value)}
                placeholder="billing@yourcompany.com"
                className="w-full rounded-xl border border-[#D0CCC6] bg-[#F9F9F9] px-3.5 py-2.5 text-xs text-[#3F434C] disabled:opacity-60"
              />
            </div>

            <div className="space-y-1.5">
              <label className="block font-bold text-[#3F434C]">
                Organization / Legal Company Name
              </label>
              <input
                type="text"
                disabled={!canManageBilling}
                value={companyName}
                onChange={(e) => setCompanyName(e.target.value)}
                placeholder="Acme Inc."
                className="w-full rounded-xl border border-[#D0CCC6] bg-[#F9F9F9] px-3.5 py-2.5 text-xs text-[#3F434C] disabled:opacity-60"
              />
            </div>

            <button
              type="submit"
              disabled={savingContact || !canManageBilling}
              className="rounded-xl bg-[#3F434C] px-4 py-2.5 text-xs font-bold text-[#FCFCFD] hover:bg-[#2a2d33] disabled:opacity-60 transition cursor-pointer"
            >
              {savingContact ? "Saving..." : "Save Billing Contact"}
            </button>
          </div>
        </form>

        {/* Invite Billing Administrator */}
        <form
          onSubmit={handleInviteAdmin}
          className="rounded-2xl border border-[#D0CCC6] bg-[#FCFCFD] p-6 space-y-5"
        >
          <div className="flex items-center gap-2.5 border-b border-[#D0CCC6] pb-4">
            <UserPlus className="h-4 w-4 text-[#3F434C]" />
            <div>
              <h2 className="text-base font-extrabold text-[#3F434C]">
                Invite Billing Administrator
              </h2>
              <p className="text-xs text-[#69736C]">
                Only the organization owner may grant billing administrator authority. Subject to your plan&apos;s seat limit.
              </p>
            </div>
          </div>

          <div className="space-y-4 text-xs">
            <div className="space-y-1.5">
              <label className="block font-bold text-[#3F434C]">
                Administrator Email Address
              </label>
              <input
                type="email"
                required
                disabled={callerRole !== "owner"}
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                placeholder="finance@yourcompany.com"
                className="w-full rounded-xl border border-[#D0CCC6] bg-[#F9F9F9] px-3.5 py-2.5 text-xs text-[#3F434C] disabled:opacity-60"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="block font-bold text-[#3F434C]">Role</label>
                <select
                  disabled={callerRole !== "owner"}
                  value={inviteRole}
                  onChange={(e) =>
                    setInviteRole(e.target.value as "admin" | "manager" | "member" | "viewer")
                  }
                  className="w-full rounded-xl border border-[#D0CCC6] bg-[#F9F9F9] px-3 py-2 text-xs text-[#3F434C] disabled:opacity-60"
                >
                  <option value="admin">Admin</option>
                  <option value="manager">Manager</option>
                  <option value="member">Member</option>
                  <option value="viewer">Viewer</option>
                </select>
              </div>
              <label className="flex items-center gap-2 pt-5 font-semibold text-[#3F434C]">
                <input
                  type="checkbox"
                  disabled={callerRole !== "owner"}
                  checked={inviteBillingPerm}
                  onChange={(e) => setInviteBillingPerm(e.target.checked)}
                  className="h-4 w-4"
                />
                <span>Grant billing management</span>
              </label>
            </div>

            <button
              type="submit"
              disabled={sendingInvite || callerRole !== "owner"}
              className="rounded-xl bg-[#3F434C] px-4 py-2.5 text-xs font-bold text-[#FCFCFD] hover:bg-[#2a2d33] disabled:opacity-60 transition cursor-pointer"
            >
              {sendingInvite ? "Sending..." : "Send Expiring Invitation"}
            </button>
          </div>
        </form>
      </div>

      {/* Active Members & Pending Billing Invitations */}
      {canManageBilling && (
        <div className="rounded-2xl border border-[#D0CCC6] bg-[#FCFCFD] p-6 space-y-5">
          <div className="flex items-center gap-2.5 border-b border-[#D0CCC6] pb-4">
            <Users className="h-4 w-4 text-[#3F434C]" />
            <div>
              <h2 className="text-base font-extrabold text-[#3F434C]">
                Organization Members &amp; Pending Invitations
              </h2>
              <p className="text-xs text-[#69736C]">
                Active members ({members.length}) and pending billing invitations ({invitations.length}).
              </p>
            </div>
          </div>

          <div className="space-y-2">
            {members.map((m) => (
              <div
                key={m.id || m.user_id}
                className="flex items-center justify-between rounded-xl border border-[#D0CCC6] bg-[#F9F9F9] px-4 py-3 text-xs"
              >
                <div>
                  <span className="font-mono font-semibold text-[#3F434C]">{m.user_id}</span>
                  <div className="flex items-center gap-2 mt-1">
                    <span className="rounded bg-[#3F434C] px-2 py-0.5 text-[10px] font-bold uppercase text-white">
                      {m.role}
                    </span>
                    {m.can_manage_billing && (
                      <span className="rounded bg-[#C6F36A]/40 px-2 py-0.5 text-[10px] font-bold text-[#171D1B]">
                        Billing Admin
                      </span>
                    )}
                  </div>
                </div>
                {callerRole === "owner" && m.role !== "owner" && m.can_manage_billing && (
                  <button
                    type="button"
                    onClick={() => void handleRevokeMemberBilling(m.user_id)}
                    className="inline-flex items-center gap-1 rounded-lg border border-red-300 bg-white px-2.5 py-1.5 text-[11px] font-bold text-red-700 hover:bg-red-50"
                  >
                    <Trash2 className="h-3 w-3" />
                    <span>Revoke Billing</span>
                  </button>
                )}
              </div>
            ))}
          </div>

          {invitations.length > 0 && (
            <div className="space-y-2 pt-3 border-t border-[#D0CCC6]">
              <h3 className="text-xs font-bold uppercase tracking-wider text-[#69736C]">
                Pending Billing Invitations
              </h3>
              {invitations.map((inv) => (
                <div
                  key={inv.id}
                  className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 rounded-xl border border-[#D0CCC6] bg-white px-4 py-3 text-xs"
                >
                  <div>
                    <span className="font-bold text-[#3F434C]">{inv.email}</span>
                    <span className="ml-2 text-[#69736C]">
                      ({inv.role} · expires {new Date(inv.expires_at).toLocaleDateString()})
                    </span>
                  </div>
                  {callerRole === "owner" && (
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => void handleInvitationAction(inv.id, "resend")}
                        className="inline-flex items-center gap-1 rounded-lg border border-[#D0CCC6] px-2.5 py-1 text-[11px] font-bold text-[#3F434C] hover:bg-[#F9F9F9]"
                      >
                        <RefreshCw className="h-3 w-3" />
                        <span>Resend</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleInvitationAction(inv.id, "revoke")}
                        className="inline-flex items-center gap-1 rounded-lg border border-red-300 px-2.5 py-1 text-[11px] font-bold text-red-700 hover:bg-red-50"
                      >
                        <Trash2 className="h-3 w-3" />
                        <span>Revoke</span>
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Notification Preferences */}
      <div className="rounded-2xl border border-[#D0CCC6] bg-[#FCFCFD] p-6 space-y-4">
        <div className="flex items-center gap-2.5 border-b border-[#D0CCC6] pb-4">
          <Bell className="h-4 w-4 text-[#3F434C]" />
          <div>
            <h2 className="text-base font-extrabold text-[#3F434C]">
              Email Notification Preferences
            </h2>
            <p className="text-xs text-[#69736C]">
              Essential transactional billing emails (receipts, payment failures, cancellations, and renewals) are always delivered to the organization owner and authorized billing administrators.
            </p>
          </div>
        </div>

        <div className="space-y-3 text-xs">
          <label className="flex items-center justify-between py-2">
            <div>
              <span className="font-bold text-[#3F434C] block">
                Essential Transactional Billing Notifications
              </span>
              <span className="text-[#69736C]">
                Subscription activation, payment receipts, renewals, cancellations, and dunning alerts
              </span>
            </div>
            <input type="checkbox" checked disabled className="h-4 w-4" />
          </label>

          <label className="flex items-center justify-between py-2">
            <div>
              <span className="font-bold text-[#3F434C] block">
                80% &amp; 100% Quota Usage Alerts
              </span>
              <span className="text-[#69736C]">
                Receive alerts when projects, seats, or knowledge files approach plan limits
              </span>
            </div>
            <input
              type="checkbox"
              disabled={savingPrefs}
              checked={usageAlerts}
              onChange={(e) =>
                handleSavePreferences(e.target.checked, productUpdates)
              }
              className="h-4 w-4"
            />
          </label>

          <label className="flex items-center justify-between py-2">
            <div>
              <span className="font-bold text-[#3F434C] block">
                Product &amp; Plan Feature Updates
              </span>
              <span className="text-[#69736C]">
                Optional announcements about new Asiyst capabilities
              </span>
            </div>
            <input
              type="checkbox"
              disabled={savingPrefs}
              checked={productUpdates}
              onChange={(e) =>
                handleSavePreferences(usageAlerts, e.target.checked)
              }
              className="h-4 w-4"
            />
          </label>
        </div>
      </div>
    </div>
  );
}

export default function AccountSettingsPage() {
  return (
    <React.Suspense
      fallback={
        <div className="rounded-2xl border border-[#D0CCC6] bg-[#FCFCFD] p-12 text-center text-xs text-[#69736C]">
          Loading organization settings...
        </div>
      }
    >
      <AccountSettingsContent />
    </React.Suspense>
  );
}
