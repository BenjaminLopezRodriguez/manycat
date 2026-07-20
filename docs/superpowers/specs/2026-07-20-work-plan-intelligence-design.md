# Work mode: plan-over-time + work intelligence

**Date:** 2026-07-20  
**Status:** Implemented  
**Related plan:** `.cursor/plans/work_plan_intelligence_a9551b39.plan.md`

## Summary

Work mode ships:

1. **Plan over time** — composer calendar control; user sets window/cadence; LLM writes agenda; Manycat cron fires sessions; Google Calendar is write-only mirror.
2. **Work intelligence** — notes extracted from Work turns; suggestion chips under the prompt with author badges.
3. **Thin channels** — Work chats shareable via join links (`/c/[id]?join=token`).

## Key paths

- Schema: `src/server/db/schema.ts`, `drizzle/0007_work_plans.sql`
- Cadence / plans / fire / calendar / notes / membership: `src/server/work/*`
- tRPC: `src/server/api/routers/work.ts`
- Cron: `src/app/api/cron/work-plans/route.ts`
- Calendar OAuth: `src/app/api/integrations/google-calendar/*`
- UI: `work-plan-button.tsx`, `work-intelligence-chips.tsx`, `work-panes.tsx`, `ModeThreadView` in `chat.tsx`
