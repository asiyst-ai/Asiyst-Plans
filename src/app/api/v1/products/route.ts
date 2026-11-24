import { NextResponse } from "next/server";
import { OFFICIAL_PLAN_LIST } from "@/features/catalog/plans";
import { isSupabaseAdminConfigured, createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export async function GET() {
  const defaultProduct = {
    id: "prod_asiyst_ai",
    slug: "asiyst-ai",
    name: "Asiyst AI",
    description:
      "Interactive 3D AI Website Assistant, Knowledge Engine, Avatar Studio & Website Intelligence Platform.",
    logoUrl: null,
    status: "active",
    plansCount: OFFICIAL_PLAN_LIST.length,
  };

  if (!isSupabaseAdminConfigured()) {
    return NextResponse.json({
      data: {
        products: [defaultProduct],
      },
    });
  }

  try {
    const admin = createAdminClient();
    const { data: rows } = await admin
      .from("billing_products")
      .select("id, slug, name, description, logo_url, status")
      .eq("status", "active");

    if (!rows || rows.length === 0) {
      return NextResponse.json({ data: { products: [defaultProduct] } });
    }

    return NextResponse.json({
      data: {
        products: rows.map((r) => ({
          id: r.id,
          slug: r.slug,
          name: r.name,
          description: r.description,
          logoUrl: r.logo_url,
          status: r.status,
          plansCount: OFFICIAL_PLAN_LIST.length,
        })),
      },
    });
  } catch {
    return NextResponse.json({ data: { products: [defaultProduct] } });
  }
}
