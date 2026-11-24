import { NextResponse } from "next/server";
import {
  requireAuthenticatedUser,
  resolveUserOrganizationAccess,
} from "@/lib/auth/session";
import type { NextRequest } from "next/server";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const auth = await requireAuthenticatedUser(request);
  if ("error" in auth) {
    return NextResponse.json({
      data: {
        authenticated: false,
        user: null,
        organization: null,
        loginUrl: `${process.env.NEXT_PUBLIC_MAIN_APP_URL || "https://asiyst.com"}/login`,
      },
    });
  }

  const orgAccess = await resolveUserOrganizationAccess(
    auth.admin,
    auth.user.id,
    null,
    false,
  );

  return NextResponse.json({
    data: {
      authenticated: true,
      user: auth.user,
      organization: "error" in orgAccess ? null : orgAccess.organization,
      membership: "error" in orgAccess ? null : orgAccess.membership,
      loginUrl: `${process.env.NEXT_PUBLIC_MAIN_APP_URL || "https://asiyst.com"}/login`,
    },
  });
}
