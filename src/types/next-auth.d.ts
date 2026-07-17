import "next-auth";
import "next-auth/jwt";

declare module "next-auth" {
  interface Session {
    accessToken?: string;
    login?: string;
    /** Provider-agnostic Manycat account id. */
    accountId?: string;
    provider?: "github" | "google" | "dev";
    /** True when this session can call the GitHub API (repo list / private clone). */
    hasGitHub?: boolean;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    accessToken?: string;
    login?: string;
    accountId?: string;
    provider?: string;
    hasGitHub?: boolean;
  }
}
