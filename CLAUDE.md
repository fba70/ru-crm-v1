# CLAUDE.md

> ## ⛔ CRITICAL — Git & version control (overrides every other instruction)
>
> - **NEVER run `git push`. Ever. Under any circumstances.** The user pushes and deploys themselves.
> - **NEVER run `git commit` or `git add`** unless the user explicitly requests that exact action in their current message. A "yes" from an earlier turn does **not** carry forward — approval is per-action and does not persist.
> - **Only make code modifications that have been explicitly discussed and approved** in the conversation. Do not bundle in unrelated edits.
> - When work is ready, **stop and report** — let the user stage, commit, and push. If you believe a commit/push is warranted, *ask*; do not act.

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

**Subsystem details live in nested files:**
- `src/app/CLAUDE.md` — feature flows: invitation flow, sources (Nylas/**IMAP**/Chat/Drive/Files Drop Off/**Telegram bot** — per-org webhook push; email parser also folds **calendar (.ics) invites** into the parent item; **own-org attribution** of every parsed item; admin **source teardown/reset**), clients & contacts (+ **batch web enrichment**, owner-managed **discovery blocklist**), tasks (Kanban + Timeline), **deals (sales funnel + LLM discovery)**, **products (catalog) & orders (manual builder + guest order-confirmation links + LLM-assisted "order from request" assembly)**, org member management.
- `src/lib/CLAUDE.md` — logic/infra: email delivery, Google infrastructure, AI chat, json-render catalog/registry.

## Commands

- `pnpm dev` — start Next.js dev server
- `pnpm build` — production build
- `pnpm lint` — ESLint
- `npx drizzle-kit push` — push schema changes to database. **⚠ Caution:** a blanket `push` currently wants to **drop the Search V2 generated columns** on `product` (`name_norm`, `is_drink`, `search_vector`, …) — they live in the DB via raw SQL DDL (`scripts/search-v2/`) but aren't in `schema.ts`, so `push` reads them as deletions and prompts a data-loss confirmation (which fails non-interactively). For **additive** changes (new enum value / nullable column / new table / index) apply the specific SQL directly via a one-off `neon()` script instead — see the per-feature migration pattern (e.g. `scripts/add-entity-status-deleted.ts`).
- `npx drizzle-kit generate` — generate migration files
- `npx drizzle-kit migrate` — run migrations

## Tech Stack

- **Next.js 16** (App Router, React 19, TypeScript)
- **better-auth** — email/password, GitHub + Google OAuth, email OTP. Plugins: admin, organization, apiKey, polar, oAuthProxy, emailOTP, lastLoginMethod, nextCookies.
- **Drizzle ORM** with **Neon Postgres** (serverless)
- **Tailwind CSS v4** with shadcn/ui (New York style)
- **Polar** — payments
- **Resend** / **Nylas** — transactional email (dispatcher in `src/lib/email.ts`, provider picked by `EMAIL_PROVIDER`)
- **React Hook Form + Zod** — form validation
- **Vercel AI SDK v6** (`ai`) routed through **Vercel AI Gateway** (auth via `AI_GATEWAY_API_KEY`). `@ai-sdk/google` is kept only for the `google.tools.googleSearch()` tool factory used by Gemini grounding.
- **ai-elements**, **streamdown** (code via Shiki, math, CJK, mermaid plugins), **json-render** (`@json-render/{core,react,shadcn}`) — AI UI
- **Recharts** (via shadcn/ui Charts), **@tanstack/react-table** — data viz
- **Nylas SDK v8** — email reading/sending
- **imapflow** + **mailparser** — raw IMAP email source (per-org mailbox, no Nylas); **node-ical** — calendar (.ics) invite decoding folded into the email parser. All three are Node-only and listed in `next.config.ts` `serverExternalPackages` so Turbopack doesn't bundle them (imapflow's `BigInt`/stream internals break when inlined).
- **googleapis** — Google Chat, Google Drive (service account + DWD impersonation)
- **@aws-sdk/client-s3** — Cloudflare R2 (S3-compatible) for parsed-markdown blobs (`src/lib/r2.ts`: `putMarkdownToR2` / `getMarkdownFromR2` / `deleteFromR2`)

## Architecture

### Route Groups

- `src/app/(auth)/` — public auth pages (sign-in, sign-up, forgot-password, accept-invitation)
- `src/app/(protected)/` — auth-gated pages; session checked server-side in `layout.tsx`, redirects to `/sign-in` if unauthenticated
- `src/app/(protected)/settings/` — platform-admin-only (users & orgs management, templates, sources, **«Сброс источника» = admin source teardown/reset**)
- `src/app/o/[token]/` — **public, no-auth** guest order-confirmation page (capability = the token). Outside `(protected)` so the layout gate doesn't apply; there is no auth middleware. Details in `src/app/CLAUDE.md` § "Guest order-confirmation links".

### API Routes (overview)

Subsystem-specific details live in `src/app/CLAUDE.md`. Key routes:

- `api/auth/[...all]` — better-auth catch-all handler
- `api/admin/*` — admin-only (user-organizations, organizations CRUD)
- `api/chat` — AI chat streaming (60s max duration)
- `api/emails`, `api/chats`, `api/drive` — Nylas email + Google Chat + Google Drive integrations (listing + attachment download proxies)
- `api/products` — org-scoped catalog listing. GET only (read-only for now): `?q=&limit=&offset=` + attribute filters → `{ rows, total }` for the server-paginated Products table; `?categories=1` / `?filterOptions=1` for the filter dropdowns. Single-value attribute filters plus three **multi-select** export-relevant ones — `colors` / `regions` / `countryNames` — sent as **repeated params** (comma-safe; some region values contain commas) and gated as `IN (…)`. Search probes `name` + named `additional_metadata` text fields **by value** (not the JSON blob). Management mutations (create/edit/stock) are a deliberate later step. Details in `src/app/CLAUDE.md` § "Products".
- `api/products/export` — GET → XLSX **price list** (one sheet per country, hierarchical region → color → vendor → name). `?countries=&regions=&colors=` (repeated params) narrow it; every OTHER active filter is ignored by the export. No params → whole active catalog. Built via `buildPriceListWorkbook` (ExcelJS). Details in `src/app/CLAUDE.md` § "Products → Price-list export".
- `api/orders` — org-scoped sales orders. `GET ?q=&status=&limit=&offset=` → `{ rows, total }`; `?id=…` → single order detail (header + line items + link meta); `?clientOptions=1` → client picker. `POST` creates a **draft** (client + line items from the catalog); `PUT` is a draft-only content update (status transitions are NOT here). Details in `src/app/CLAUDE.md` § "Orders".
- `api/orders/[id]/link` — order status transitions that drive the guest-link lifecycle (the **only** mint/revoke path). `POST { action: send|resend|reopen|pullback|cancel|finalize, recipientEmail? }`. `send`/`resend`/`reopen` require a valid recipient email (defaults to the client's) and return the raw guest URL once; `finalize` (confirmed→finalized) is internal-only. Details in `src/app/CLAUDE.md` § "Guest order-confirmation links".
- `api/order-requests` — LLM-assisted "order from request" assembly. `POST { clientId, rawText, comment? }` creates an `order_request` and runs ONE LLM split of the pasted free-text client message into intent items (`maxDuration = 120`); `GET ?id=` → `{ request }` (header + items); `PUT { id, action }` switches on `linkOrder | itemStatus | status` for wizard progress. The wizard then drives the existing manual order builder. **No Vercel Workflow** — durable rows + a UI wizard over the draft order. Details in `src/app/CLAUDE.md` § "Order from request (LLM-assisted assembly)".
- `api/clients`, `api/contacts`, `api/tasks`, `api/deals` — org-scoped CRUD. `api/tasks` PUT supports `statusOnly: true` for the card's quick-status dropdown; `api/deals` PUT supports `statusOnly: true` + `status` for the quick cancel/delete/restore shortcut (deal lifecycle is an `active | cancelled | deleted` enum — see `src/app/CLAUDE.md` § "Deals") and `moveOnly: true` + `funnelStageId` + `position` for the **kanban drag** (persists manual order via `deal.position`, a fractional-indexing key; the Deals tab is a dnd-kit kanban board — see `src/app/CLAUDE.md` § "UI: Deals kanban board"), accepts a multi-contact `contactIds[]` payload, and exposes `?clientOptions=1` / `?contactOptions=1&clientId=…` / `?funnelStages=1` for the create form.
- `api/discovery/{preview,apply}` — unified "Discover from sources" flow (replaces the three legacy `api/clients/discover` + `api/contacts/discover` + `api/contacts/link-to-clients` routes). `preview` POST runs one read-only scan and returns company / contact / link candidates; `apply` POST creates the selected clients + contacts, links them (same-run linking via inferred `webUrl`), and stamps `source_item.discovery_scanned_at`. Both re-export their types for client components. Details in `src/app/CLAUDE.md` § "Unified discovery from sources".
- `api/clients/enrich/{pending,review}` + `api/clients/[id]/enrich{,/resolve}` — **batch client web-enrichment** (fills missing website/email/phone/address from web search, built on the existing `lookupClientOnWeb`). `pending` GET → worklist `{ ids, total }`; `[id]/enrich` POST (`maxDuration=60`) processes ONE client → auto-applies a single high-confidence match else parks it for review; `review` GET + `[id]/enrich/resolve` POST drive the manual disambiguation queue. Browser-driven one-by-one loop (the only mode) keyed off `client.enrichment_status IS NULL`. Details in `src/app/CLAUDE.md` § "Batch web enrichment".
- `api/blocklist{,/[id],/from-entity}` — owner-managed **discovery blocklist** (org-scoped dictionary of business-irrelevant companies/people/domains/emails). `GET` → `{ entries, canManage }`; `POST` (owner) adds + retroactively sweeps matching rows to `status='blocked'`; `DELETE /[id]`; `POST /from-entity` blacklists an existing client/contact. Honored by discovery (candidates never surface) + parse-time attribution. Details in `src/app/CLAUDE.md` § "Discovery blocklist".
- `api/admin/teardown/{sources,preview,execute}` — **admin source teardown/reset**: hard-deletes everything one source produced (items + R2 + cards + the clients/contacts/deals/tasks it triggered, via re-aggregated discovery collision keys) and resets the sync cursor, so a demo/test re-runs "as if new". `preview` POST → blast radius; `execute` POST (`maxDuration=300`) typed-confirm + hard delete, audited in `teardown_log`. Details in `src/app/CLAUDE.md` § "Source teardown / reset".
- `api/cards` — Truffalo Cards CRUD (LLM-generated dashboard signals). `GET` lists; `GET ?id=` returns one card (used by the `new_order` card's "Create order" handoff to /products). PUT accepts `action: "accept" | "reject"` shortcuts (rejection requires `rejectionReason`); otherwise applies a partial update. The `new_order` category drives a "Create order" button → opens the New Order dialog on /products prefilled with the client + verbatim source message. Details in `src/app/CLAUDE.md`.
- `api/cards/generate` — LLM-driven card generation from sources (the Truffalo Cards pipeline). POST runs the chosen Custom rule against eligible source items, inserts cards with linked clients/users. GET returns a preview count for the explore dialog. `maxDuration = 300`. Details in `src/app/CLAUDE.md`.
- `api/deals/discover` — LLM-driven deal discovery from sources. POST runs the chosen Custom rule against eligible source items, creates new deals, or moves existing open deals to a different funnel stage (mirrors `/api/cards/generate`). GET returns a preview count for the dialog. `maxDuration = 300`. Details in `src/app/CLAUDE.md`.
- `api/invitations/[id]` and `api/invitations/check` — **public** (no-auth) endpoints used by the accept-invitation page and sign-up pending-invite guard. Details in `src/app/CLAUDE.md`.
- `api/sources/{items,sync,r2/save,dropoff/upload,whatsapp/upload,telegram/fetch,org,stored,r2/pending-ids,items/pending-parse-ids}` — Sources subsystem. All org-scoped via `session.session.activeOrganizationId`. Per-row mutations verify tenant scope via `assertSourceItemInScope` / `assertSourceInScope` (typed errors → 403/404). `whatsapp/upload` is the only multipart route here — supports chunked client-side uploads via the `<WhatsAppArchiveDialog>`. `telegram/fetch` POST runs a manual `getUpdates` pull for a per-org Telegram source (the "Fetch" button — mainly local dev; 409s when a webhook is active). `pending-ids` and `pending-parse-ids` power the batch upload / parse controls. Details in `src/app/CLAUDE.md`.
- `api/webhooks/telegram/[sourceId]` — **public, no-auth** Telegram webhook (outside `(protected)`; the path `sourceId` + the per-source secret echoed in the `X-Telegram-Bot-Api-Secret-Token` header are the capability — org-unscoped, like the guest order link). `POST` delegates to `ingestTelegramUpdate` → resolves source→org by path id, verifies the secret, persists DM text as a `chat_message` source_item, acks the chat. Node runtime, fast-ack. Details in `src/app/CLAUDE.md` § "Telegram Bot (Sources)".

### Auth Flow

- Server sessions: `src/lib/get-session.ts` uses `cache()` to dedupe session calls per request.
- Client auth: `src/lib/auth-client.ts` exports `authClient` with organization, admin, apiKey, Polar, emailOTP plugins.
- Auth config: `src/lib/auth.ts` — 7-day sessions with **`session.cookieCache` enabled (5-min signed cookie)** so navigation doesn't hit the DB every request — without it a transient Neon blip made `getSession()` return null → the `(protected)` layout bounced to `/sign-in`, reading as a random mid-session logout. `databaseHooks.user.create.after` skips default-org creation when the new user's email has a live (pending + non-expired) invitation — otherwise they'd end up in two orgs (default + inviter's).
- Sign-in methods: email/password, Google OAuth, GitHub OAuth, **email OTP** (6-digit, 5 min expiry, `disableSignUp: true` — only registered users can OTP-sign-in). OTP page at `/sign-in/otp` uses a two-step form (email → shadcn `InputOTP`). OTP emails go through `sendEmails` in `src/lib/email.ts`.

### Role Model (Two-Tier)

- **Platform roles** (`user.role`, via admin plugin): `user` | `admin`. Controls access to Settings page + platform-wide admin functions.
- **Organization roles** (`member.role`, via organization plugin): `owner` | `admin` | `member`. Controls within-org permissions (member management, org editing, invitations).
- Independent: a platform `user` can be org `owner`.

### Admin Plugin

- Configured in `src/lib/auth.ts` with `adminUserIds` for static admin designation.
- Settings page (`/settings`) restricted to admin role — shows user management + org management tables.
- Admin-specific forms in `src/components/forms/form-admin-*.tsx`.

### Data Layer

- Schema: `src/db/schema.ts` — tables: user, session, account, verification, organization, member, invitation, apikey, rule, client, contact, task, **deal, deal_contact, deal_funnel_stage**, **product**, **order, order_item, order_access_link**, **order_request, order_request_item**, source, source_item, pipeline_run, card, card_client, card_user, card_contact, source_template, **discovery_blocklist** (org-scoped blocklist dictionary), **teardown_log** (admin source-teardown audit). (`client` also carries `name_phys` + `comment` + an extensible `custom_fields` jsonb — keys: `type` [one org] + `discount` [%, all orgs; the per-client order discount] — plus **`enrichment_status` + `enrichment_candidates`** for batch web-enrichment — see `src/app/CLAUDE.md` § "Clients & Contacts" / "Batch web enrichment".) `order` carries `discount_percent` (per-client discount snapshot; amount + discounted total derived on read — see `src/app/CLAUDE.md` § "Order discount").
- **Enum notes**: `entity_status` (`client`/`contact`) gained **`blocked`** (blocklist suppression — hidden from default lists, treated as ABSENT by discovery like `deleted` but never auto-revived). `source_provider` gained **`imap`**. New enums: `blocklist_kind` (email|domain|company|person), `enrichment_status` (enriched|review|no_match), **`org_attribution`** (own_org|external|unknown — on `source_item`, parse-time authorship verdict + a partial `own_org` index).
- DB client: `src/db/drizzle.ts` — Neon serverless.
- Server queries: `src/server/` — server-only modules for permissions, organizations, members, users, api-keys, rules, clients (incl. `lookupClientOnWeb` + batch `enrichClientFromWeb`/`resolveEnrichment`), contacts, **discovery** (unified clients/contacts/links discover-from-sources), **blocklist** (`loadOrgBlocklist` guard + owner CRUD + retroactive sweep), **org-identity** (`loadOwnOrgIdentity` for discovery + `getOrgIdentity` for attribution), **teardown** (admin source reset — re-aggregates collision keys, FK-safe hard delete), tasks, **deals, deals-discovery**, **products** (server-paginated + searched catalog listing), **orders** (CRUD + draft content), **order-links** (guest-link mint/resolve/transition lifecycle — the only place that touches `order_access_link`), **order-requests** (LLM split of a pasted client request into intent items + the wizard's get/link/item-status mutations), invitations, sources (admin + owner edit surfaces), source-items, parse-source-item (+ `parsers/org-attribution` authorship classifier + `parsers/ics` calendar decode), sync (incl. `sync/imap`), r2 upload, orchestration.
- **Rule:** API routes (`src/app/api/`) must NOT use Drizzle ORM or access the database directly. All DB queries and mutations must live in server functions under `src/server/` and be called from the API routes.

### Multi-Tenancy

Session stores active organization (id, name, slug). **The org `logo` is intentionally NOT on the session** — logos are base64 data URLs (often 100KB+) and `auth.ts`'s `cookieCache` serialises every session field into the signed session cookie, so a logo overflowed the ~16KB HTTP header limit → `431 Request Header Fields Too Large` on every authenticated request (dev + Vercel). The sidebar loads the logo server-side in `(protected)/layout.tsx` and passes it as the `orgLogo` prop instead (`user.image` data URLs are the same hazard — keep avatars/logos as hosted URLs, not data URLs). All feature tables (clients, contacts, tasks, **deals**, **products**, **orders**, **order_requests**, rules, **sources, source_items**, **discovery_blocklist**) are org-scoped via `session.session.activeOrganizationId`; no cross-org read/write. Permission checks in `src/server/permissions.ts`. **Exception:** the admin source-teardown tool (`/api/admin/teardown/*`) is platform-admin-only and intentionally cross-org (it resolves one source's owning org and operates within it). **Exception:** the guest order-confirmation flow (`/o/[token]` + `order_access_link`) is intentionally org-unscoped — the opaque token *is* the authorization, and the resolver loads the order strictly by `grant.order_id`.

**Deal funnel stages scope model** (`deal_funnel_stage`):
- Same `is_system = true` / `owner_organization_id = <orgId>` split as `source`. Seeded as 7 system rows (Qualification 0.05 → Closed 1.0 / Rejected 0.0) via `scripts/seed-deal-funnel-stages.ts`.
- `listDealFunnelStages()` resolves with **org-or-system fallback** (not union): if any active org-scoped stage rows exist, only those are returned; otherwise the system bucket. Lets each org customise its funnel later without a migration of existing deals.
- See `src/app/CLAUDE.md` § "Deals" for the full picture.

**Sources scope model** (`source` + `source_item`):
- Every source row carries either `is_system = true` (platform-wide singleton, currently unused) or `owner_organization_id = <orgId>` (per-org). After the org-scoping refactor, all five seeded sources (Emails / Google Chat / Google Meet / Google Drive / Files Drop Off) are per-org.
- `source_item.organization_id` is denormalised from `source.owner_organization_id` at upsert / parse-time so org-filtered queries don't have to join `source`.
- API routes for sources (`/api/sources/*`) gate on `session.session.activeOrganizationId` and verify per-row tenant scope via `assertSourceInScope` / `assertSourceItemInScope` in `src/server/{sources,source-items}.ts`. AI chat tools (`/api/chat`'s `searchSourceItems` / `getSourceItemContent` / `showSourceItemsInPanel`) take the active org id from the session and pass it through `listSourceItems({ organizationId })` + `getSourceItemMarkdown(id, { requireOrganizationId })`.
- See `src/app/CLAUDE.md` § "Sources scope, tabs & permissions" for the full picture.

### Daily Orchestration (sync → parse → upload pipeline)

Scheduled batch processing of the Sources subsystem. Three layers, deliberately split so the Vercel Workflow SDK can be ripped out and replaced (BullMQ / Trigger.dev / VPS cron) without touching business logic.

- **`src/server/orchestration/`** — engine-agnostic. `runDailyPipeline({ trigger })` is the single callable entry point: runs `runFullSync()`, then loops `parseSourceItem()` over `listPendingParseIds()`, then loops `uploadSourceItem()` over `listPendingUploadIds()`. Sequential by design (MVP scale; PHASE2 #2). Per-item failures are isolated three layers deep — `parseSourceItem`/`uploadSourceItem` already return-on-error, the loops wrap each call in their own try/catch, and `pipeline_run.errors_json` records every failure without crashing the run. Caps + cron schedule live in `src/server/orchestration/config.ts` (PHASE2 #12 tracks lifting these to system_settings).
- **Per-source automation gate (`source.automated_parsing_is_allowed`)** — boolean column, default `true`. All three orchestration phases filter on it: `runFullSync()` skips sources with the flag off; `listPendingParseIds()` / `listPendingUploadIds()` (and their `count*Total` siblings) inner-join `source` and require the flag to be true, so any items already in the queue under a flagged-off source are also skipped. Manual UI actions (`/api/sources/{sync,items/[id]/parse,items/[id]/reparse,r2/save,dropoff/upload}`) bypass the flag — operator intent overrides the schedule. Org owners flip it from the Sources page "Manage organization sources" tab; platform admins flip it from `/settings`.
- **`src/server/r2/upload-source-item.ts`** — `uploadSourceItem(itemId)` server function extracted from the manual R2 save route. Returns `{ ok, … }` instead of throwing. The manual `/api/sources/r2/save` route is now a thin auth wrapper that calls it; the orchestration layer calls the same function directly.
- **`pipeline_run` table** (`src/db/schema.ts`) — one row per orchestration run with per-phase counts (`syncSourcesSucceeded` / `parseComplete` / `uploadFailed` / etc.) and a bounded `errorsJson: { phase, sourceId?, sourceItemId?, message }[]`. Future Sources-page widget reads from here.
- **`src/workflows/daily-pipeline.workflow.ts`** — the **only** file that imports the Vercel Workflow SDK (`'use workflow'` / `'use step'` directives, `next.config.ts`'s `withWorkflow()` wrapper). Single coarse step that calls `runDailyPipeline({ trigger: 'cron' })`. Replacing this file + the cron route is the entire delete list when migrating off Vercel Workflows. Trade-off: workflow-level retry of the single step would create a second `pipeline_run` row — acceptable since per-item errors are already swallowed; if it becomes an issue, add a stale-run sweep keyed on `status='running' AND started_at < now() - 1h`.
- **`src/app/api/cron/daily/route.ts`** — Vercel Cron Jobs entrypoint. Validates `Authorization: Bearer $CRON_SECRET` in production (Vercel auto-attaches this header on scheduled invocations); skips the check in dev. Calls `start(dailyPipelineWorkflow, [])` from `workflow/api`.
- **`vercel.ts`** — declares `crons: [{ path: "/api/cron/daily", schedule: ORCHESTRATION_CONFIG.cron }]` (replaces the older `vercel.json`). Imports the constants file so cadence is one-edit-in-one-place.
- **`src/app/api/admin/pipeline/run/route.ts`** — admin-gated POST that invokes `runDailyPipeline({ trigger: 'manual' })` synchronously. Lets you exercise the full chain without waiting for cron. `maxDuration = 800` because phase 2 can chew through `maxParsePerRun` items (some of which are videos) — for production-scale runs, prefer the workflow path.
- **Auto-generated routes** at `src/app/.well-known/workflow/v1/{flow,step,webhook}/` are produced by `next build` from the workflow source — gitignored + eslint-ignored. Source of truth is `src/workflows/*.workflow.ts`.

### Component Organization

- `src/components/ui/` — shadcn/ui primitives (includes `chart.tsx` for Recharts).
- `src/components/blocks/` — composed UI blocks (sidebar, theme toggle, ai-chat, cards, timeline).
- `src/components/forms/` — React Hook Form + Zod forms.
- `src/components/tables/` — data table components.
- `src/components/ai-elements/` — Vercel AI Elements UI primitives.
- `src/components/{data-table,json-viewer,code-highlighter,panel-block-wrapper}.tsx` — json-render registry helpers (tanstack table, JSON tree, syntax highlighting, inline-vs-panel wrapper).

### Path Alias

`@/*` maps to `./src/*`

## Environment Variables

Required in `.env`: `DATABASE_URL`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` (the four `*_CLIENT_*` vars are better-auth OAuth client credentials for end-user "Sign in with Google/GitHub" — unrelated to data-source access), `RESEND_API_KEY`, `POLAR_ACCESS_TOKEN`, `POLAR_SUCCESS_URL`, `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_APP_URL` (base URL for invitation email links; also read by the client-side `authClient` in `src/lib/auth-client.ts`), `AI_GATEWAY_API_KEY` (Vercel AI Gateway key — single auth for all LLM calls; replaces the previous per-provider OpenAI / Vertex credentials), `NYLAS_API_KEY`, `NYLAS_API_URI`, `NYLAS_CLIENT_ID`, `NYLAS_CALLBACK_URI` (platform-level Nylas tenant credentials — authenticate Truffalo to Nylas itself; not per-org and not in `credentials_ref`), `CREDENTIALS_ENCRYPTION_KEY` (base64-encoded 32 random bytes — generate with `openssl rand -base64 32`. AES-256-GCM key for encrypting `source.credentials_ref` blobs via `src/lib/credentials-crypto.ts`. **Losing this key permanently bricks every encrypted source credential in the DB** — store as a Vercel encrypted env var, never commit, never rotate without a re-encrypt migration. Wire format now carries a 1-byte version prefix (v1 = `0x01`) so future rotation can land without re-encrypting in a flag day — see `src/lib/CLAUDE.md` § "Credentials encryption"), `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME`, `R2_PUBLIC_URL` (Cloudflare R2 — S3-compatible object storage for parsed-source markdown. `R2_PUBLIC_URL` is the S3 endpoint, e.g. `https://<account>.eu.r2.cloudflarestorage.com` for EU jurisdictional buckets; the lib falls back to constructing `https://<R2_ACCOUNT_ID>.r2.cloudflarestorage.com` if it's unset), `CRON_SECRET` (base64-encoded 32 random bytes — generate with `openssl rand -base64 32`. Auth token for `/api/cron/daily`; Vercel Cron Jobs auto-attach `Authorization: Bearer $CRON_SECRET` to every scheduled invocation when this var is set as a project env var. Production-only check — local dev skips it. Set the same value in `.env` and on Vercel Production. Rotate by generating a new value, updating both places, and the next scheduled run uses the new one).

**Source-credentials env vars (Phase 3 — bootstrap-only):** `NYLAS_GRANT_ID`, `GOOGLE_CHAT_CREDENTIALS` (base64-encoded service account JSON), `GOOGLE_CHAT_IMPERSONATE_USER`, `GOOGLE_CHAT_PROJECT_NUMBER`. After Phase 3 these are read **only** by `scripts/migrate-credentials-to-db.ts` to seed existing rows' `credentials_ref` on first run. Runtime reads come from `credentials_ref` only:
- **nylas** keeps a fallback to `NYLAS_GRANT_ID` (logs a warning when used) so unmigrated rows still bootstrap.
- **gchat / gdrive** have NO fallback — runtime throws `MissingCredentialsError` if `credentials_ref` is null on a row.

Once every row has `credentials_ref` populated in production, these env vars become vestigial. Org owners replace them with their own per-org credentials via Sources → "Manage organization sources" → Configure.

**Telegram bootstrap env vars (optional):** `TELEGRAM_BOT_TOKEN` + `TELEGRAM_WEBHOOK_SECRET_TOKEN`. Telegram bot credentials are **per-org** (`credentials_ref = { botToken, webhookSecret }`, configured via Sources → Configure). These two env vars are a **nylas-style fallback**: `getTelegramCredentials` reads them (logs a warning) only when a telegram source's `credentials_ref` is null — a single bootstrap bot before the UI is used. `webhookSecret` is a high-entropy string YOU generate (Telegram echoes it in `X-Telegram-Bot-Api-Secret-Token` for forgery rejection). **`NEXT_PUBLIC_APP_URL` must be the public HTTPS origin on Vercel** or webhook auto-registration on credential-save is skipped (then the webhook must be registered manually — error-prone, see `PHASE2.md` #20). `TELEGRAM_BOT_USERNAME` is unused at runtime today (botUsername lives in `provider_config`); reserved for Phase 3 group @-mention detection.

Optional email-delivery env vars: `EMAIL_PROVIDER` (`"nylas"` default | `"resend"`) selects the provider used by `sendEmails`; `RESEND_FROM` (e.g. `"Truffalo <noreply@yourdomain.com>"`) overrides the Resend sender (defaults to `onboarding@resend.dev` which can only deliver to the Resend account owner's email — fine for local testing, useless in production until a domain is verified).

**In production (Vercel)**: `BETTER_AUTH_URL` and `NEXT_PUBLIC_APP_URL` must be the real deployed origin (e.g. `https://app.truffalo.ai`). `NEXT_PUBLIC_*` is baked into the client bundle at build — changes require a fresh deploy. Also set `NEXT_PUBLIC_BASE_URL` / `NEXT_PUBLIC_PRODUCTION_URL` so the `oAuthProxy` plugin routes preview-deployment callbacks through production. The `.env.vercel` file in the repo root is **reference-only**, not auto-synced to Vercel. The `GOOGLE_CLIENT_ID` on Vercel Production may differ from the one in local `.env` (they're separate OAuth clients) — always verify which client is actually live by reading the `client_id` query param in the `accounts.google.com/o/oauth2/v2/auth?...` redirect during sign-in; redirect URIs must be registered on *that* client.
