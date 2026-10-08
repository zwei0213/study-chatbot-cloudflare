import { NextResponse } from "next/server";
import { checkIpRateLimit, RateLimitError } from "@/lib/ratelimit";
import {
  getStudyAdminCookieValue,
  isStudyAdminTokenConfigured,
  STUDY_ADMIN_COOKIE,
  verifyStudyAdminToken,
} from "@/lib/study/admin";

export async function POST(request: Request) {
  if (!isStudyAdminTokenConfigured()) {
    return NextResponse.json(
      {
        error:
          "请先在 Cloudflare Workers 中设置至少 32 位的 STUDY_ADMIN_TOKEN。",
      },
      { status: 503 }
    );
  }

  try {
    await checkIpRateLimit(request, "admin");
  } catch (error) {
    if (!(error instanceof RateLimitError)) {
      console.error("Study admin rate limiter unavailable:", error);
      return NextResponse.json(
        { error: "暂时无法登录，请稍后重试。" },
        { status: 503 }
      );
    }
    return NextResponse.json(
      { error: "尝试次数过多，请稍后再试。" },
      { status: 429 }
    );
  }

  const body = (await request.json().catch(() => null)) as {
    token?: unknown;
  } | null;
  const token = typeof body?.token === "string" ? body.token : "";
  if (token.length > 512 || !verifyStudyAdminToken(token)) {
    return NextResponse.json({ error: "管理员密钥无效。" }, { status: 401 });
  }

  const response = NextResponse.json({ authenticated: true });
  response.cookies.set(STUDY_ADMIN_COOKIE, getStudyAdminCookieValue(), {
    httpOnly: true,
    maxAge: 60 * 60 * 8,
    path: "/",
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
  });
  response.headers.set("Cache-Control", "no-store");
  return response;
}
