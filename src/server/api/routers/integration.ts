import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { env } from "@/env";
import { createTRPCRouter, protectedProcedure } from "@/server/api/trpc";
import {
  assertNotRateLimited,
  markRateLimited,
} from "@/server/integrations/rate-limit";
import { sendIntegrationRequest } from "@/server/integrations/request-email";

export const integrationRouter = createTRPCRouter({
  request: protectedProcedure
    .input(
      z
        .object({
          name: z.string().trim().min(1).max(80),
          note: z.string().trim().max(2000).optional(),
          contactEmail: z.string().trim().max(320).optional(),
        })
        .superRefine((val, ctx) => {
          const email = val.contactEmail?.trim();
          if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: "Invalid email",
              path: ["contactEmail"],
            });
          }
        }),
    )
    .mutation(async ({ ctx, input }) => {
      const userKey = ctx.accountId;
      try {
        assertNotRateLimited(userKey);
      } catch {
        throw new TRPCError({
          code: "TOO_MANY_REQUESTS",
          message: "Please wait before requesting again",
        });
      }

      const contactEmail = input.contactEmail?.trim() || undefined;
      const sessionEmail = ctx.session?.user?.email ?? null;
      const userLabel =
        ctx.session?.login ??
        ctx.session?.user?.name ??
        sessionEmail ??
        ctx.accountId;

      try {
        await sendIntegrationRequest(
          {
            name: input.name,
            note: input.note,
            contactEmail,
            userId: ctx.accountId,
            userLabel,
            sessionEmail,
          },
          {
            apiKey: env.RESEND_API_KEY,
            from: env.RESEND_FROM,
            to: env.INTEGRATION_REQUEST_TO,
          },
        );
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Failed to send request";
        if (/Email not configured yet/i.test(message)) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: "Email not configured yet",
          });
        }
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message,
        });
      }

      markRateLimited(userKey);
      return { ok: true as const };
    }),
});
