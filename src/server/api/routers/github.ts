import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { githubAuthConfigured } from "@/auth";
import { createTRPCRouter, publicProcedure } from "@/server/api/trpc";

type GithubRepo = {
  id: number;
  full_name: string;
  description: string | null;
  private: boolean;
  html_url: string;
};

export const githubRouter = createTRPCRouter({
  status: publicProcedure.query(({ ctx }) => ({
    configured: githubAuthConfigured,
    signedIn: Boolean(ctx.session?.accessToken),
    login: ctx.session?.user?.name ?? ctx.session?.user?.email ?? null,
  })),

  listRepos: publicProcedure
    .input(
      z
        .object({
          query: z.string().optional(),
        })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      const token = ctx.session?.accessToken;
      if (!token) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "Sign in with GitHub to list your repositories.",
        });
      }

      const res = await fetch(
        "https://api.github.com/user/repos?per_page=50&sort=updated&affiliation=owner,collaborator,organization_member",
        {
          headers: {
            Accept: "application/vnd.github+json",
            Authorization: `Bearer ${token}`,
            "X-GitHub-Api-Version": "2022-11-28",
          },
          next: { revalidate: 0 },
        },
      );

      if (!res.ok) {
        throw new TRPCError({
          code: "BAD_GATEWAY",
          message: `GitHub API error (${res.status})`,
        });
      }

      const repos = (await res.json()) as GithubRepo[];
      const q = input?.query?.trim().toLowerCase();
      const filtered = q
        ? repos.filter(
            (r) =>
              r.full_name.toLowerCase().includes(q) ||
              (r.description?.toLowerCase().includes(q) ?? false),
          )
        : repos;

      return filtered.map((r) => ({
        fullName: r.full_name,
        description: r.description,
        private: r.private,
        url: r.html_url,
      }));
    }),
});
