import { type NextRequest, NextResponse } from "next/server";
import { getToken, type JWT } from "next-auth/jwt";
import { isDevelopmentEnvironment } from "./lib/constants";

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  let token: JWT | null;
  try {
    token = await getToken({
      req: request,
      secret: process.env.AUTH_SECRET,
      secureCookie: !isDevelopmentEnvironment,
    });
  } catch (error) {
    console.error("Study session verification failed:", error);
    return NextResponse.json(
      { error: "暂时无法验证会话，请稍后刷新页面。" },
      { headers: { "Cache-Control": "no-store" }, status: 503 }
    );
  }

  if (!token) {
    const redirectUrl = encodeURIComponent(pathname);

    return NextResponse.redirect(
      new URL(`/api/auth/guest?redirectUrl=${redirectUrl}`, request.url)
    );
  }

  return NextResponse.next();
}

export const config = {
  // API handlers verify their own sessions and return JSON errors.
  matcher: ["/study/a", "/study/b"],
};
