import type { BillingEmailEventType } from "@/types/billing";

export const DEFAULT_EMAIL_FROM = "ASIYST <noreply@asiyst.com>";
export const DEFAULT_EMAIL_REPLY_TO = "support@asiyst.com";
export const PLAN_APP_BASE_URL =
  process.env.NEXT_PUBLIC_APP_URL || "https://plan.asiyst.com";

export interface EmailTemplatePayload {
  eventType: BillingEmailEventType;
  organizationName?: string;
  productName?: string;
  planName?: string;
  previousPlanName?: string;
  amountMinor?: number;
  currency?: string;
  billingInterval?: string;
  activationDate?: string;
  effectiveDate?: string;
  nextRenewalDate?: string;
  periodEndDate?: string;
  recoveryDeadline?: string;
  daysRemaining?: number;
  transactionReference?: string;
  refundStatus?: string;
  includedBenefits?: string[];
  resourceName?: string;
  currentUsage?: number;
  limitValue?: number;
  invitedRole?: string;
  invitationUrl?: string;
  actionUrl?: string;
  actionLabel?: string;
  customMessage?: string;
}

export interface RenderedEmailTemplate {
  subject: string;
  preheader: string;
  html: string;
  text: string;
}

/**
 * Essential transactional billing notifications cannot be opted out of by the organization owner.
 */
export const ESSENTIAL_BILLING_EMAIL_EVENTS = new Set<BillingEmailEventType>([
  "billing.subscription.activated",
  "billing.subscription.welcome",
  "billing.subscription.plan_upgraded",
  "billing.subscription.plan_downgraded",
  "billing.cancellation.requested",
  "billing.cancellation.reversed",
  "billing.subscription.canceled",
  "billing.subscription.expiring",
  "billing.subscription.reactivated",
  "billing.subscription.renewed",
  "billing.trial.started",
  "billing.trial.ending",
  "billing.payment.succeeded",
  "billing.payment.failed",
  "billing.payment.retry_scheduled",
  "billing.payment.recovered",
  "billing.subscription.past_due",
  "billing.payment.final_warning",
  "billing.payment.refunded",
  "billing.payment.dispute",
  "billing.invoice.available",
  "billing.details.updated",
  "billing.contact.changed",
  "billing.admin.invited",
  "billing.admin.role_changed",
  "billing.usage.limit_reached",
  "billing.sync.issue",
]);

export function isEssentialBillingEmail(eventType: BillingEmailEventType): boolean {
  return ESSENTIAL_BILLING_EMAIL_EVENTS.has(eventType);
}

export function escapeHtml(raw: unknown): string {
  if (raw === null || raw === undefined) return "";
  return String(raw)
    .slice(0, 1000)
    .replace(/[&<>"']/g, (char) => {
      switch (char) {
        case "&":
          return "&amp;";
        case "<":
          return "&lt;";
        case ">":
          return "&gt;";
        case '"':
          return "&quot;";
        case "'":
          return "&#39;";
        default:
          return char;
      }
    });
}

function formatMoney(amountMinor?: number, currency: string = "USD"): string {
  if (typeof amountMinor !== "number" || !Number.isFinite(amountMinor)) {
    return "";
  }
  const code = (currency || "USD").toUpperCase();
  const formatted = (amountMinor / 100).toFixed(2);
  return code === "USD" ? `$${formatted} USD` : `${code} ${formatted}`;
}

export function getBillingEmailMetadata(payload: EmailTemplatePayload): {
  subject: string;
  preheader: string;
  headline: string;
  body: string;
  ctaLabel: string;
  ctaUrl: string;
} {
  const plan = payload.planName || "Asiyst Plan";
  const prevPlan = payload.previousPlanName || "Previous Plan";
  const org = payload.organizationName || "your organization";
  const defaultBillingUrl = `${PLAN_APP_BASE_URL}/account/billing`;
  const defaultSubsUrl = `${PLAN_APP_BASE_URL}/account/subscriptions`;

  switch (payload.eventType) {
    case "billing.subscription.activated":
      return {
        subject: `Your ${plan} subscription is active`,
        preheader: `${plan} is now active for ${org}.`,
        headline: `${plan} is now active`,
        body: `Your subscription for ${org} has been verified and activated. All included plan benefits are now active in Asiyst AI.`,
        ctaLabel: "View Subscription & Benefits",
        ctaUrl: payload.actionUrl || defaultSubsUrl,
      };

    case "billing.subscription.welcome":
      return {
        subject: `Welcome to ${plan}`,
        preheader: `Explore your new ${plan} capabilities across your Asiyst projects.`,
        headline: `Welcome to ${plan}`,
        body: `Thank you for subscribing to ${plan}. Your organization (${org}) now has immediate access to your upgraded project, knowledge, and 3D avatar capabilities in Asiyst.`,
        ctaLabel: "Open Asiyst Plan Dashboard",
        ctaUrl: payload.actionUrl || `${PLAN_APP_BASE_URL}/account`,
      };

    case "billing.subscription.plan_upgraded":
      return {
        subject: "Your Asiyst plan has been upgraded",
        preheader: `${org} was upgraded from ${prevPlan} to ${plan}.`,
        headline: `Upgraded to ${plan}`,
        body: `Your organization subscription has been upgraded from ${prevPlan} to ${plan}. Your expanded limits and features are now active.`,
        ctaLabel: "Review Upgraded Benefits",
        ctaUrl: payload.actionUrl || defaultSubsUrl,
      };

    case "billing.subscription.plan_downgraded":
      return {
        subject: "Your Asiyst plan change is scheduled",
        preheader: `${org} is scheduled to change from ${prevPlan} to ${plan}.`,
        headline: `Plan change to ${plan}`,
        body: `Your organization's plan change from ${prevPlan} to ${plan} has been recorded. You retain your current paid access until the effective date shown below. Existing projects, knowledge files, and avatars are never automatically deleted.`,
        ctaLabel: "Manage Subscription",
        ctaUrl: payload.actionUrl || defaultSubsUrl,
      };

    case "billing.cancellation.requested":
      return {
        subject: "Your Asiyst subscription cancellation is scheduled",
        preheader: `Your ${plan} subscription remains active until the end of the current period.`,
        headline: "Cancellation request confirmed",
        body: `We have received your request to cancel ${plan} for ${org}. Your subscription will remain active until the end of your current billing period.`,
        ctaLabel: "View or Reactivate Subscription",
        ctaUrl: payload.actionUrl || defaultSubsUrl,
      };

    case "billing.cancellation.reversed":
    case "billing.subscription.reactivated":
      return {
        subject: `Your ${plan} subscription is active again`,
        preheader: `${plan} has been reactivated for ${org}.`,
        headline: "Subscription reactivated",
        body: `Your ${plan} subscription for ${org} is active and in good standing. Your scheduled cancellation has been removed.`,
        ctaLabel: "View Subscription",
        ctaUrl: payload.actionUrl || defaultSubsUrl,
      };

    case "billing.subscription.canceled":
      return {
        subject: "Your Asiyst subscription cancellation is confirmed",
        preheader: `Your ${plan} subscription for ${org} has ended.`,
        headline: "Subscription ended",
        body: `Your ${plan} subscription for ${org} has now ended, and your workspace has transitioned to Asiyst Zero. Your existing organization data remains intact.`,
        ctaLabel: "Explore Plans",
        ctaUrl: payload.actionUrl || `${PLAN_APP_BASE_URL}/plans`,
      };

    case "billing.subscription.expiring":
      return {
        subject: "Your Asiyst subscription expires soon",
        preheader: `Your ${plan} subscription ends in ${payload.daysRemaining ?? 7} day(s).`,
        headline: `Subscription expires in ${payload.daysRemaining ?? 7} day${payload.daysRemaining === 1 ? "" : "s"}`,
        body: `Your ${plan} subscription for ${org} is scheduled to expire and will not auto-renew. Reactivate anytime before the expiration date to keep your paid plan benefits without interruption.`,
        ctaLabel: "Reactivate Subscription",
        ctaUrl: payload.actionUrl || defaultSubsUrl,
      };

    case "billing.subscription.renewed":
      return {
        subject: "Your Asiyst subscription has been renewed",
        preheader: `${plan} renewed successfully for ${org}.`,
        headline: `${plan} renewed`,
        body: `Your monthly ${plan} subscription for ${org} has been renewed for the new billing period.`,
        ctaLabel: "View Billing History",
        ctaUrl: payload.actionUrl || defaultBillingUrl,
      };

    case "billing.trial.started":
      return {
        subject: `Your ${plan} trial has started`,
        preheader: `Trial access is active for ${org}.`,
        headline: `${plan} trial started`,
        body: `Your trial period for ${plan} is now active.`,
        ctaLabel: "Manage Subscription",
        ctaUrl: payload.actionUrl || defaultSubsUrl,
      };

    case "billing.trial.ending":
      return {
        subject: `Your ${plan} trial ends soon`,
        preheader: `Your trial period for ${org} ends in ${payload.daysRemaining ?? 3} day(s).`,
        headline: "Trial ending soon",
        body: `Your ${plan} trial period ends soon. Review your billing settings to continue uninterrupted access.`,
        ctaLabel: "Review Billing",
        ctaUrl: payload.actionUrl || defaultBillingUrl,
      };

    case "billing.payment.succeeded":
      return {
        subject: "Payment received for your Asiyst subscription",
        preheader: `Receipt for ${plan} (${formatMoney(payload.amountMinor, payload.currency)}).`,
        headline: "Payment successful",
        body: `We have received your payment for ${plan} (${org}). This email serves as your official payment receipt confirmation.`,
        ctaLabel: "View Invoices & Receipts",
        ctaUrl: payload.actionUrl || `${PLAN_APP_BASE_URL}/account/invoices`,
      };

    case "billing.payment.failed":
      return {
        subject: "Action required: Your Asiyst payment failed",
        preheader: `We could not process the payment for ${plan}.`,
        headline: "Payment failed",
        body: `We were unable to process the subscription payment for ${plan} (${org}). Please update your payment method to keep your subscription in good standing.`,
        ctaLabel: "Update Payment Method",
        ctaUrl: payload.actionUrl || defaultBillingUrl,
      };

    case "billing.payment.retry_scheduled":
      return {
        subject: "Payment retry scheduled for your Asiyst subscription",
        preheader: `An automatic payment retry is scheduled for ${plan}.`,
        headline: "Payment retry scheduled",
        body: `Our payment provider has scheduled an automatic retry for your ${plan} subscription. You may also update your payment details directly in your billing dashboard.`,
        ctaLabel: "Review Payment Method",
        ctaUrl: payload.actionUrl || defaultBillingUrl,
      };

    case "billing.payment.recovered":
      return {
        subject: "Your Asiyst payment was recovered",
        preheader: `${plan} for ${org} has returned to active standing.`,
        headline: "Payment recovered",
        body: `Your recovery payment for ${plan} succeeded, and ${org} is back in good standing.`,
        ctaLabel: "View Billing Summary",
        ctaUrl: payload.actionUrl || defaultBillingUrl,
      };

    case "billing.subscription.past_due":
      return {
        subject: "Action required: Your Asiyst subscription is past due",
        preheader: `Please update your payment details for ${org}.`,
        headline: "Subscription is past due",
        body: `Your ${plan} subscription for ${org} is currently past due. Please complete payment recovery before the deadline below to prevent downgrading to Asiyst Zero.`,
        ctaLabel: "Recover Payment Now",
        ctaUrl: payload.actionUrl || defaultBillingUrl,
      };

    case "billing.payment.final_warning":
      return {
        subject: "Final warning: Your Asiyst payment recovery deadline is tomorrow",
        preheader: `Update your payment method for ${org} to avoid service downgrade.`,
        headline: "Final payment recovery notice",
        body: `The payment recovery deadline for ${plan} (${org}) is approaching. Please update your payment method immediately to retain your paid entitlements.`,
        ctaLabel: "Update Billing Now",
        ctaUrl: payload.actionUrl || defaultBillingUrl,
      };

    case "billing.payment.refunded":
      return {
        subject: "Your Asiyst payment has been refunded",
        preheader: `Refund processed for ${org} (${formatMoney(payload.amountMinor, payload.currency)}).`,
        headline: "Refund issued",
        body: `A refund has been issued for your ${plan} transaction. Depending on your bank or card issuer, funds typically appear on your statement within standard provider processing times.`,
        ctaLabel: "View Payment History",
        ctaUrl: payload.actionUrl || defaultBillingUrl,
      };

    case "billing.payment.dispute":
      return {
        subject: "Alert: Payment dispute recorded for your organization",
        preheader: `A payment dispute or chargeback was reported for ${org}.`,
        headline: "Payment dispute notification",
        body: `Our payment processor notified us of a dispute or chargeback on a transaction for ${org}. Please contact Asiyst billing support or review your billing dashboard.`,
        ctaLabel: "Review Billing Status",
        ctaUrl: payload.actionUrl || defaultBillingUrl,
      };

    case "billing.invoice.available":
      return {
        subject: "New invoice available for your Asiyst subscription",
        preheader: `Your latest billing statement for ${org} is ready.`,
        headline: "Invoice available",
        body: `A new invoice or billing statement is available for ${org}.`,
        ctaLabel: "Download Invoice",
        ctaUrl: payload.actionUrl || `${PLAN_APP_BASE_URL}/account/invoices`,
      };

    case "billing.details.updated":
    case "billing.contact.changed":
      return {
        subject: "Your Asiyst organization billing details were updated",
        preheader: `Billing contact details were updated for ${org}.`,
        headline: "Billing details updated",
        body: `The billing contact or billing profile information for ${org} was recently updated.`,
        ctaLabel: "Review Billing Settings",
        ctaUrl: payload.actionUrl || `${PLAN_APP_BASE_URL}/account/settings`,
      };

    case "billing.admin.invited":
      return {
        subject: `You have been invited as a Billing Administrator for ${org}`,
        preheader: `Accept your invitation to manage subscriptions and billing for ${org}.`,
        headline: "Billing Administrator Invitation",
        body: `You have been invited to serve as an authorized Billing Administrator for ${org} on Asiyst Plan. This invitation expires in 7 days.`,
        ctaLabel: "Accept Billing Invitation",
        ctaUrl: payload.invitationUrl || payload.actionUrl || `${PLAN_APP_BASE_URL}/account/settings`,
      };

    case "billing.admin.role_changed":
      return {
        subject: `Your billing permissions for ${org} have been updated`,
        preheader: `An organization owner updated your billing role in ${org}.`,
        headline: "Billing administrator permissions updated",
        body: `Your billing administration permissions for ${org} have been updated by the organization owner.`,
        ctaLabel: "View Account Access",
        ctaUrl: payload.actionUrl || `${PLAN_APP_BASE_URL}/account/settings`,
      };

    case "billing.usage.limit_approaching":
      return {
        subject: `Usage alert: ${payload.resourceName || "Plan quota"} is approaching its limit`,
        preheader: `${org} has used ${payload.currentUsage ?? 0} of ${payload.limitValue ?? 0} ${payload.resourceName || "units"}.`,
        headline: "Approaching plan quota limit",
        body: `Your organization (${org}) has reached ${payload.currentUsage ?? 0} of ${payload.limitValue ?? 0} allowed ${payload.resourceName || "resources"} on ${plan}. Consider upgrading your plan to avoid interruptions.`,
        ctaLabel: "Upgrade Plan Capacity",
        ctaUrl: payload.actionUrl || `${PLAN_APP_BASE_URL}/plans`,
      };

    case "billing.usage.limit_reached":
      return {
        subject: "Your Asiyst usage limit has been reached",
        preheader: `${org} reached its ${payload.resourceName || "plan"} limit on ${plan}.`,
        headline: "Plan limit reached",
        body: `An operation was blocked because ${org} has reached the ${payload.resourceName || "resource"} limit (${payload.currentUsage ?? 0}/${payload.limitValue ?? 0}) included in ${plan}. Upgrade your subscription to unlock higher capacity immediately.`,
        ctaLabel: "Upgrade Subscription",
        ctaUrl: payload.actionUrl || `${PLAN_APP_BASE_URL}/plans`,
      };

    case "billing.sync.issue":
      return {
        subject: "[Internal Alert] Subscription synchronization issue detected",
        preheader: `Review synchronization status for ${org}.`,
        headline: "Subscription Synchronization Notice",
        body:
          payload.customMessage ||
          `A subscription synchronization discrepancy was detected for ${org} and logged for administrative review.`,
        ctaLabel: "Open Subscription Dashboard",
        ctaUrl: payload.actionUrl || `${PLAN_APP_BASE_URL}/account/subscriptions`,
      };
  }
}

/**
 * Renders both branded responsive HTML and plain-text alternatives for any billing event.
 * Escapes all dynamic values and never includes raw secrets or card details.
 */
export function renderBillingEmailTemplate(
  payload: EmailTemplatePayload,
): RenderedEmailTemplate {
  const meta = getBillingEmailMetadata(payload);
  const amountFormatted = formatMoney(payload.amountMinor, payload.currency);

  const detailRows: Array<[string, string | undefined]> = [
    ["Organization", payload.organizationName],
    ["Product", payload.productName || "Asiyst AI"],
    ["Plan", payload.planName],
    ["Previous Plan", payload.previousPlanName],
    ["Amount", amountFormatted || undefined],
    ["Billing Interval", payload.billingInterval],
    ["Activation Date", payload.activationDate],
    ["Effective Date", payload.effectiveDate],
    ["Next Renewal Date", payload.nextRenewalDate],
    ["Current Period Ends", payload.periodEndDate],
    ["Recovery Deadline", payload.recoveryDeadline],
    [
      "Days Remaining",
      payload.daysRemaining !== undefined ? String(payload.daysRemaining) : undefined,
    ],
    ["Transaction Reference", payload.transactionReference],
    ["Refund Status", payload.refundStatus],
    ["Resource", payload.resourceName],
    [
      "Current Usage",
      payload.currentUsage !== undefined && payload.limitValue !== undefined
        ? `${payload.currentUsage} / ${payload.limitValue}`
        : undefined,
    ],
    ["Role", payload.invitedRole],
  ];

  const validRows = detailRows.filter(
    (row): row is [string, string] => Boolean(row[1] && row[1].trim()),
  );

  const htmlRows = validRows
    .map(
      ([label, val]) => `
      <tr>
        <td style="padding: 10px 16px 10px 0; color: #69736C; font-size: 13px; border-bottom: 1px solid #ECECE6; vertical-align: top;">
          ${escapeHtml(label)}
        </td>
        <td style="padding: 10px 0; color: #171D1B; font-size: 13px; font-weight: 600; border-bottom: 1px solid #ECECE6; vertical-align: top; text-align: right;">
          ${escapeHtml(val)}
        </td>
      </tr>`,
    )
    .join("");

  const benefitsHtml =
    payload.includedBenefits && payload.includedBenefits.length > 0
      ? `
      <div style="margin-top: 20px; padding: 16px; background-color: #F9F9F9; border-radius: 10px; border: 1px solid #DCDDD5;">
        <div style="font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; color: #3F434C; margin-bottom: 8px;">
          Included Plan Benefits
        </div>
        <ul style="margin: 0; padding-left: 18px; color: #3F434C; font-size: 13px; line-height: 1.6;">
          ${payload.includedBenefits.map((b) => `<li>${escapeHtml(b)}</li>`).join("")}
        </ul>
      </div>`
      : "";

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(meta.subject)}</title>
</head>
<body style="margin: 0; padding: 0; background-color: #F9F9F9; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #3F434C;">
  <div style="display: none; max-height: 0; overflow: hidden;">
    ${escapeHtml(meta.preheader)}
  </div>
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color: #F9F9F9; padding: 36px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width: 560px; background-color: #FCFCFD; border: 1px solid #D0CCC6; border-radius: 16px; overflow: hidden;">
          <tr>
            <td style="background-color: #171D1B; padding: 20px 32px;">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                <tr>
                  <td>
                    <img src="${escapeHtml(PLAN_APP_BASE_URL)}/asiyst_plan_logo_square_v6.svg" alt="Asiyst Plan" width="24" height="24" style="display: inline-block; width: 24px; height: 24px; border-radius: 6px; vertical-align: middle; margin-right: 10px;" />
                    <span style="color: #FCFCFD; font-size: 16px; font-weight: 800; letter-spacing: 0.05em; vertical-align: middle;">ASIYST PLAN</span>
                  </td>
                  <td align="right" style="color: #C6F36A; font-size: 12px; font-family: monospace;">
                    plan.asiyst.com
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding: 32px;">
              <h1 style="margin: 0 0 12px 0; font-size: 22px; line-height: 1.3; color: #171D1B;">
                ${escapeHtml(meta.headline)}
              </h1>
              <p style="margin: 0 0 24px 0; font-size: 14px; line-height: 1.65; color: #3F434C;">
                ${escapeHtml(meta.body)}
              </p>
              ${
                validRows.length > 0
                  ? `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin-bottom: 24px; border-top: 1px solid #ECECE6;">${htmlRows}</table>`
                  : ""
              }
              ${benefitsHtml}
              <div style="margin-top: 28px;">
                <a href="${escapeHtml(meta.ctaUrl)}" style="display: inline-block; background-color: #3F434C; color: #FCFCFD; text-decoration: none; padding: 12px 22px; border-radius: 10px; font-size: 13px; font-weight: 700;">
                  ${escapeHtml(meta.ctaLabel)}
                </a>
              </div>
              <p style="margin: 28px 0 0 0; padding-top: 20px; border-top: 1px solid #ECECE6; font-size: 12px; line-height: 1.6; color: #69736C;">
                Need assistance with your subscription or billing? Reply to this email or contact <a href="mailto:support@asiyst.com" style="color: #3F434C; font-weight: 600;">support@asiyst.com</a>.
              </p>
            </td>
          </tr>
          <tr>
            <td style="background-color: #F5F4EF; padding: 16px 32px; font-size: 11px; color: #69736C; text-align: center;">
              © ${new Date().getUTCFullYear()} Asiyst · Central Subscription &amp; Entitlement Platform (<a href="https://plan.asiyst.com" style="color: #3F434C; text-decoration: none;">plan.asiyst.com</a>)
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  const textLines: string[] = [
    `ASIYST PLAN — ${meta.headline.toUpperCase()}`,
    meta.subject,
    "",
    meta.body,
    "",
  ];

  for (const [label, val] of validRows) {
    textLines.push(`${label}: ${val}`);
  }

  if (payload.includedBenefits && payload.includedBenefits.length > 0) {
    textLines.push("", "Included Plan Benefits:");
    for (const benefit of payload.includedBenefits) {
      textLines.push(`- ${benefit}`);
    }
  }

  textLines.push(
    "",
    `${meta.ctaLabel}: ${meta.ctaUrl}`,
    "",
    "Support: support@asiyst.com",
    "© Asiyst · https://plan.asiyst.com",
  );

  return {
    subject: meta.subject,
    preheader: meta.preheader,
    html,
    text: textLines.join("\n"),
  };
}
