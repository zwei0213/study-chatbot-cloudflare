import NextAuth, { type DefaultSession } from "next-auth";
import type { DefaultJWT } from "next-auth/jwt";
import Credentials from "next-auth/providers/credentials";
import { createGuestUser } from "@/lib/db/users";
import { checkIpRateLimit } from "@/lib/ratelimit";

export type UserType = "guest";

declare module "next-auth" {
  interface Session extends DefaultSession {
    user: {
      id: string;
      type: UserType;
    } & DefaultSession["user"];
  }

  interface User {
    email?: string | null;
    id?: string;
    type: UserType;
  }
}

declare module "next-auth/jwt" {
  interface JWT extends DefaultJWT {
    id: string;
    type: UserType;
  }
}

export const {
  handlers: { GET, POST },
  auth,
  signIn,
} = NextAuth({
  basePath: "/api/auth",
  callbacks: {
    jwt({ token, user }) {
      if (user) {
        token.id = user.id as string;
        token.type = user.type;
      }
      return token;
    },
    session({ session, token }) {
      if (session.user) {
        session.user.id = token.id;
        session.user.type = token.type;
      }
      return session;
    },
  },
  pages: {
    newUser: "/",
    signIn: "/",
  },
  providers: [
    Credentials({
      async authorize(_credentials, request) {
        await checkIpRateLimit(request, "chat");
        const [guestUser] = await createGuestUser();
        return { ...guestUser, type: "guest" };
      },
      credentials: {},
      id: "guest",
    }),
  ],
  trustHost: true,
});
