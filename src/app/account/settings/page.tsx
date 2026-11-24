"use client";

import * as React from "react";
import { Mail, UserPlus, Bell, CheckCircle2, AlertCircle } from "lucide-react";

export default function AccountSettingsPage() {
  const [organizationId, setOrganizationId] = React.useState<string | null>(null);
  const [billingEmail, setBillingEmail] = React.useState("");
  const [companyName, setCompanyName] = React.useState("");
  const [inviteEmail, setInviteEmail] = React.useState("");
  const [usageAlerts, setUsageAlerts] = React.useState(true);
  const [productUpdates, setProductUpdates] = React.useState(true);
  const [savingContact, setSavingContact] = React.useState(false);
  const [sendingInvite, setSendingInvite] = React.useState(false);
  const [savingPrefs, setSavingPrefs] = React.useState(false);
  const [feedback, setFeedback] = React.useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);

  React.useEffect(() => {
    let active = true;
    async function load() {
      try {
        const [summaryRes, prefsRes] = await Promise.all([
          fetch("/api/v1/billing/summary"),
          fetch("/api/v1/notifications/preferences"),
        ]);
        if (!active) return;

        if (summaryRes.ok) {
          const summaryBody = await summaryRes.json();
          const org = summaryBody.data?.organization;
          const contact = summaryBody.data?.billingContact;
          if (org?.id) setOrganizationId(org.id);
          if (contact?.billing_email) setBillingEmail(contact.billing_email);
          if (contact?.company_name || org?.name) {
            setCompanyName(contact?.company_name || org?.name || "");
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
    }
    load();
    return () => {
      active = false;
    };
  }, []);

  async function handleSaveContact(e: React.FormEvent) {
    e.preventDefault();
    if (!organizationId) return;
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
        setFeedback({
          type: "success",
          text: "Organization billing contact updated.",
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
    if (!organizationId || !inviteEmail.trim()) return;
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
            role: "admin",
            canManageBilling: true,
            action: "invite",
          }),
        },
      );
      const body = await res.json();
      if (!res.ok) {
        setFeedback({
          type: "error",
          text:
            body?.error?.message ||
            "Unable to invite billing administrator.",
        });
      } else {
        setInviteEmail("");
        setFeedback({
          type: "success",
          text: "Billing administrator invitation queued via secure expiring token.",
        });
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
          Organization Billing Administration
        </span>
        <h1 className="text-2xl sm:text-3xl font-extrabold text-[#3F434C] mt-1">
          Billing Contact, Administrators &amp; Notifications
        </h1>
        <p className="text-xs text-[#69736C] mt-1">
          Manage who receives billing emails and who is authorized to manage subscriptions for your organization.
        </p>
      </div>

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
          <div className="flex items-center gap-2.5 border-b border-[#D0CCC6] pb-4">
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

          <div className="space-y-4 text-xs">
            <div className="space-y-1.5">
              <label className="block font-bold text-[#3F434C]">
                Billing Contact Email
              </label>
              <input
                type="email"
                required
                value={billingEmail}
                onChange={(e) => setBillingEmail(e.target.value)}
                placeholder="billing@yourcompany.com"
                className="w-full rounded-xl border border-[#D0CCC6] bg-[#F9F9F9] px-3.5 py-2.5 text-xs text-[#3F434C]"
              />
            </div>

            <div className="space-y-1.5">
              <label className="block font-bold text-[#3F434C]">
                Organization / Legal Company Name
              </label>
              <input
                type="text"
                value={companyName}
                onChange={(e) => setCompanyName(e.target.value)}
                placeholder="Acme Inc."
                className="w-full rounded-xl border border-[#D0CCC6] bg-[#F9F9F9] px-3.5 py-2.5 text-xs text-[#3F434C]"
              />
            </div>

            <button
              type="submit"
              disabled={savingContact}
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
                Authorized billing administrators can manage subscriptions and access invoices. Subject to your plan&apos;s organization seat limit.
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
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                placeholder="finance@yourcompany.com"
                className="w-full rounded-xl border border-[#D0CCC6] bg-[#F9F9F9] px-3.5 py-2.5 text-xs text-[#3F434C]"
              />
            </div>

            <button
              type="submit"
              disabled={sendingInvite}
              className="rounded-xl bg-[#3F434C] px-4 py-2.5 text-xs font-bold text-[#FCFCFD] hover:bg-[#2a2d33] disabled:opacity-60 transition cursor-pointer"
            >
              {sendingInvite ? "Sending..." : "Send Expiring Invitation"}
            </button>
          </div>
        </form>
      </div>

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
