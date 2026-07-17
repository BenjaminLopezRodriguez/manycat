import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import GitHub from "next-auth/providers/github";
import type { Provider } from "next-auth/providers";

const githubId = process.env.AUTH_GITHUB_ID;
const githubSecret = process.env.AUTH_GITHUB_SECRET;
const authSecret = process.env.AUTH_SECRET;
const isDev = process.env.NODE_ENV === "development";

export const githubAuthConfigured = Boolean(
  githubId && githubSecret && authSecret,
);

const providers: Provider[] = [];

if (githubAuthConfigured) {
  providers.push(
    GitHub({
      clientId: githubId!,
      clientSecret: githubSecret!,
      authorization: {
        params: { scope: "read:user user:email repo" },
      },
    }),
  );
}

// Local-only escape hatch when GitHub callback URL is pointed at prod.
if (isDev && authSecret) {
  providers.push(
    Credentials({
      id: "dev",
      name: "Local development",
      credentials: {},
      authorize() {
        return {
          id: "local-dev",
          name: "Local Dev",
          email: "dev@localhost",
        };
      },
    }),
  );
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  trustHost: true,
  secret: authSecret,
  pages: {
    signIn: "/signin",
  },
  providers,
  callbacks: {
    async jwt({ token, account, profile, user }) {
      if (account?.access_token) {
        token.accessToken = account.access_token;
      }
      if (profile && typeof profile === "object" && "login" in profile) {
        token.login = String(
          (profile as { login?: string }).login ?? "",
        );
      }
      if (account?.provider === "dev" && user) {
        token.login = "local-dev";
      }
      return token;
    },
    async session({ session, token }) {
      session.accessToken = token.accessToken;
      session.login = token.login ?? undefined;
      return session;
    },
  },
});
