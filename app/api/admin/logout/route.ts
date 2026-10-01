import { NextResponse } from "next/server";
import { STUDY_ADMIN_COOKIE } from "@/lib/study/admin";

export function POST() {
  const response = NextResponse.json({ authenticated: false });
  response.cookies.set(STUDY_ADMIN_COOKIE, "", {
    httpOnly: true,
    maxAge: 0,
    path: "/",
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
  });
  response.headers.set("Cache-Control", "no-store");
  return response;
}
