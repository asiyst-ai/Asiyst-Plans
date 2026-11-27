import { NextResponse } from "next/server";
import { readFileSync } from "node:fs";
import path from "node:path";

export const dynamic = "force-static";

export async function GET() {
  try {
    const filePath = path.join(process.cwd(), "public", "llms.txt");
    const content = readFileSync(filePath, "utf8");
    return new NextResponse(content, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "public, max-age=86400, stale-while-revalidate=604800",
      },
    });
  } catch {
    return new NextResponse("# Asiyst Plans\nhttps://plan.asiyst.com/plans", {
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }
}
