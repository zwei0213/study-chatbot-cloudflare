import type { NextAuthConfig } from "next-auth";

export const authConfig = {
  basePath: "/api/auth",
  callbacks: {},
  pages: {
    newUser: "/",
    signIn: "/",
  },
  providers: [],
  trustHost: true,
} satisfies NextAuthConfig;
