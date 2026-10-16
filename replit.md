# Reelkeeper

Reelkeeper is a private, single-creator library and reminder queue for lyric videos.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- `artifacts/lyric-reels` — creator dashboard, sign-in, library, and schedule screens
- `artifacts/api-server/src/routes/videos.ts` — video library and rotation API
- `artifacts/api-server/src/routes/settings.ts` — recurring reminder settings
- `artifacts/api-server/src/routes/storage.ts` — private direct-to-object-storage uploads
- `lib/db/src/schema/lyric-reels.ts` — video metadata, schedule, and single-owner record
- `lib/api-spec/openapi.yaml` — API contract source of truth

## Architecture decisions

- Clerk handles account sign-in; the first authenticated account claims the single-owner space, and later accounts are denied.
- Videos are uploaded directly to private object storage; PostgreSQL stores metadata and the owner-only queue pointer.
- Facebook publishing is not connected. The queue supports manual-post tracking and browser reminders only; never collect Facebook passwords or imply automated posting.
- Browser reminders require the app to be open; no background push service is configured.

## Product

- Upload and organize personal lyric videos with per-video Reel titles and descriptions.
- Rotate videos in FIFO order, repeat indefinitely, and track manually marked posts.
- Set a recurring reminder interval and timezone; download a private video and copy its caption before posting manually.

## User preferences

- This site is for one creator's personal use. Typical videos are about four minutes and 600 MB.
- Keep the experience simple and require sign-in; do not reuse a shared password for site access.

## Gotchas

- Development and production have separate Clerk user stores and databases. The creator must claim the owner account on the environment they use.
- After publishing, the first account to sign in claims production ownership. The creator should create that account before sharing the published URL.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
