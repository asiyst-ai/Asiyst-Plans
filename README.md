# Asiyst Plan (`plan.asiyst.com`)

**Asiyst Plan** is the centralized subscription, billing, Dodo Payments integration, organization entitlement engine, and automated transactional email platform for the Asiyst ecosystem.

## Commercial Plans

| Plan | Internal Key | DB Legacy Key | Price | Checkout Method | AI Credits Included |
|---|---|---|---:|---|---:|
| **Asiyst Zero** | `zero` | `free` | **$0/month** | Direct backend activation | **0** |
| **Asiyst Pulse** | `pulse` | `starter` | **$24/month** | Dodo Payments | **0** |
| **Asiyst Vector** | `vector` | `pro` | **$54/month** | Dodo Payments | **0** |
| **Asiyst Quantum** | `quantum` | `business` | **$154/month** | Dodo Payments | **0** |

## Core Architectural Guarantees

1. **Verified Payment Activation Only**: Creating a checkout session initializes the subscription in `pending` state. Paid plan benefits (`pulse`, `vector`, `quantum`) **only** activate in `Asiyst-WEB` and `Asiyst-Plan` after `POST /api/webhooks/dodo` cryptographically verifies the payment and updates the subscription to `active`.
2. **Organization-Owned Subscriptions**: Subscriptions belong to `public.organizations`, and all projects (`public.projects`) belonging to the organization inherit its effective entitlements.
3. **Strict AI Credits Separation**: No subscription plan grants AI Credits, AI token balances, or guaranteed model inference messages.

## Quick Start

```bash
# Install dependencies
npm install

# Run unit & security verification tests
npm test

# Type-check
npm run typecheck

# Start development server on port 3001
npm run dev

# Production build
npm run build
```
