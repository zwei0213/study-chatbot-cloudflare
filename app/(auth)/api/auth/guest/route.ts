import { NextResponse } from "next/server";
import { AuthError } from "next-auth";
import { getToken } from "next-auth/jwt";
import { signIn } from "@/app/(auth)/auth";
import { isDevelopmentEnvironment } from "@/lib/constants";
import { RateLimitError } from "@/lib/ratelimit";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const rawRedirect = searchParams.get("redirectUrl") || "/";
  const redirectUrl = [
    "/",
    "/study",
    "/study/a",
    "/study/b",
    "/study/c",
    "/practice/low",
    "/practice/high",
  ].includes(rawRedirect)
    ? rawRedirect
    : "/";

  try {
    const token = await getToken({
      req: request,
      secret: process.env.AUTH_SECRET,
      secureCookie: !isDevelopmentEnvironment,
    });

    if (token) {
      return NextResponse.redirect(new URL(redirectUrl, request.url));
    }

    const destination = await signIn("guest", {
      redirect: false,
      redirectTo: redirectUrl,
    });
    return NextResponse.redirect(new URL(destination, request.url));
  } catch (error) {
    if (
      error instanceof AuthError &&
      error.cause?.err instanceof RateLimitError
    ) {
      return NextResponse.json(
        { error: "创建会话过于频繁，请稍后重试。" },
        { status: 429 }
      );
    }
    console.error("Guest session creation failed:", error);
    return NextResponse.json(
      { error: "暂时无法创建会话，请稍后刷新页面。" },
      { status: 503 }
    );
  }
}
