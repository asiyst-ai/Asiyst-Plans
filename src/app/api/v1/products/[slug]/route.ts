import { NextResponse, type NextRequest } from "next/server";
import {
  OFFICIAL_PLAN_LIST,
  PLAN_COMPARISON_ROWS,
} from "@/features/catalog/plans";
import { jsonError } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ slug: string }> };

export async function GET(_request: NextRequest, context: Context) {
  const { slug } = await context.params;
  if (slug !== "asiyst-ai") {
    return jsonError(404, "PRODUCT_NOT_FOUND", `Product '${slug}' was not found.`);
  }

  return NextResponse.json({
    data: {
      product: {
        id: "prod_asiyst_ai",
        slug: "asiyst-ai",
        name: "Asiyst AI",
        description:
          "Interactive 3D AI Website Assistant, Knowledge Engine, Avatar Studio & Website Intelligence Platform.",
        status: "active",
      },
      plans: OFFICIAL_PLAN_LIST,
      comparison: PLAN_COMPARISON_ROWS,
      aiCreditsIncluded: false,
      aiCreditsPolicy:
        "No subscription plan includes AI Credits, token balances, or guaranteed model inference allowances. AI Credits are purchased separately.",
    },
  });
}
