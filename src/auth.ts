import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import GitHub from "next-auth/providers/github";
import Google from "next-auth/providers/google";
import type { Provider } from "next-auth/providers";

const githubId = process.env.AUTH_GITHUB_ID;
const githubSecret = process.env.AUTH_GITHUB_SECRET;
const googleId = process.env.AUTH_GOOGLE_ID;
const googleSecret = process.env.AUTH_GOOGLE_SECRET;
const authSecret = process.env.AUTH_SECRET;
const isDev = process.env.NODE_ENV === "development";

export const githubAuthConfigured = Boolean(
  githubId && githubSecret && authSecret,
);

export const googleAuthConfigured = Boolean(
  googleId && googleSecret && authSecret,
);

export const authConfigured = Boolean(
  authSecret && (githubAuthConfigured || googleAuthConfigured || isDev),
);

const providers: Provider[] = [];

if (googleAuthConfigured) {
  providers.push(
    Google({
      clientId: googleId!,
      clientSecret: googleSecret!,
    }),
  );
}

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

// Local-only escape hatch when OAuth callbacks are pointed at prod.
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
      if (account?.provider) {
        token.provider = account.provider;
      }

      if (account?.provider === "github" && account.access_token) {
        token.accessToken = account.access_token;
        token.hasGitHub = true;
      }

      if (account?.provider === "google") {
        // Google session: app auth without GitHub repo access.
        token.hasGitHub = false;
        delete token.accessToken;
      }

      if (profile && typeof profile === "object" && "login" in profile) {
        token.login = String(
          (profile as { login?: string }).login ?? "",
        );
      }

      if (account?.provider === "dev" && user) {
        token.login = "local-dev";
        token.provider = "dev";
        token.hasGitHub = false;
      }

      // Provider-agnostic account id: prefer email, then GitHub login, then sub.
      const email =
        typeof token.email === "string" && token.email.length > 0
          ? token.email.toLowerCase()
          : typeof user?.email === "string"
            ? user.email.toLowerCase()
            : undefined;

      token.accountId =
        email ??
        token.login ??
        (typeof token.sub === "string" ? token.sub : undefined) ??
        token.accountId;

      return token;
    },
    async session({ session, token }) {
      session.accessToken = token.accessToken;
      session.login = token.login ?? undefined;
      session.accountId = token.accountId ?? token.login ?? undefined;
      session.provider =
        (token.provider as SessionProvider | undefined) ?? undefined;
      session.hasGitHub = Boolean(token.hasGitHub ?? token.accessToken);
      return session;
    },
  },
});

type SessionProvider = "github" | "google" | "dev";
