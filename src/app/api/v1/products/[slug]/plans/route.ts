import { NextResponse, type NextRequest } from "next/server";
import {
  OFFICIAL_PLAN_LIST,
  PLAN_COMPARISON_ROWS,
} from "@/features/catalog/plans";
import { jsonError } from "@/lib/auth/session";
import { getDodoConfigurationStatus } from "@/lib/payments/dodo";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ slug: string }> };

export async function GET(_request: NextRequest, context: Context) {
  const { slug } = await context.params;
  if (slug !== "asiyst-ai") {
    return jsonError(404, "PRODUCT_NOT_FOUND", `Product '${slug}' was not found.`);
  }

  const dodoStatus = getDodoConfigurationStatus();

  return NextResponse.json({
    data: {
      productSlug: "asiyst-ai",
      plans: OFFICIAL_PLAN_LIST.map((plan) => ({
        ...plan,
        checkoutReady:
          plan.slug === "zero"
            ? true
            : dodoStatus.apiKeyConfigured &&
              dodoStatus.products[plan.slug].isConfigured,
      })),
      comparison: PLAN_COMPARISON_ROWS,
      gatewayConfigured: dodoStatus.isFullyConfigured,
    },
  });
}
