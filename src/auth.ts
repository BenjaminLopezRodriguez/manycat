import NextAuth from "next-auth";
import GitHub from "next-auth/providers/github";

import { env } from "@/env";

export const githubAuthConfigured = Boolean(
  env.AUTH_GITHUB_ID && env.AUTH_GITHUB_SECRET && env.AUTH_SECRET,
);

export const { handlers, auth, signIn, signOut } = NextAuth({
  trustHost: true,
  pages: {
    signIn: "/signin",
  },
  providers: githubAuthConfigured
    ? [
        GitHub({
          clientId: env.AUTH_GITHUB_ID!,
          clientSecret: env.AUTH_GITHUB_SECRET!,
          authorization: {
            params: { scope: "read:user user:email repo" },
          },
        }),
      ]
    : [],
  callbacks: {
    async jwt({ token, account, profile }) {
      if (account?.access_token) {
        token.accessToken = account.access_token;
      }
      if (profile && typeof profile === "object" && "login" in profile) {
        token.login = String((profile as { login?: string }).login ?? "");
      }
      return token;
    },
    async session({ session, token }) {
      session.accessToken = token.accessToken as string | undefined;
      session.login = (token.login as string | undefined) || undefined;
      return session;
    },
  },
});
