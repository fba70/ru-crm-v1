# src/lib — logic & infrastructure notes

> ## ⛔ CRITICAL — Git & version control (overrides every other instruction)
>
> - **NEVER run `git push`. Ever. Under any circumstances.** The user pushes and deploys themselves.
> - **NEVER run `git commit` or `git add`** unless the user explicitly requests that exact action in their current message. Approval is per-action and does not persist across turns.
> - **Only make code modifications that have been explicitly discussed and approved.** When work is ready, stop and report; let the user commit and push.

Scoped notes for code under `src/lib/`. High-level architecture lives in the root `CLAUDE.md`; user-facing flows live in `src/app/CLAUDE.md`.

## Email Delivery (provider abstraction)

- `src/lib/email.ts` exposes three functions: `sendEmailsViaResend`, `sendEmailsViaNylas`, and a `sendEmails` dispatcher. All internal flows (password reset, email verification, OTP, organization invitations) call `sendEmails` — switching providers is a one-line env change with zero call-site edits.
- Provider is selected by `EMAIL_PROVIDER` env var: `"nylas"` (default) or `"resend"`.
- **Nylas (default)**: sends via `nylas.messages.send({ identifier: NYLAS_GRANT_ID, … })`, meaning emails go out from the Gmail mailbox connected to that grant (`hello@truffalo.ai`). The connected grant must have a send scope (`gmail.send` or broader) — read-only grants will fail. Outgoing messages appear in that mailbox's Sent folder and thread naturally on reply.
- **Resend (legacy / fallback)**: preserved intact. Reads `RESEND_FROM` for the sender (defaults to `onboarding@resend.dev`). The shared `onboarding@resend.dev` sender can **only** deliver to the Resend account owner's email — for real recipients you need a domain verified in Resend and `RESEND_FROM="Truffalo <noreply@yourdomain.com>"`.
- Both implementations inspect the provider's response and log + throw on failure, so errors surface in the server console instead of being swallowed.

### MVP limitation: outgoing mail is platform-scoped, not org-scoped

`sendEmails` is intentionally limited to **system / platform-level transactional mail** — invitation emails, password-reset / verification links, OTP codes, etc. — and always sends from the platform's own mailbox via `process.env.NYLAS_GRANT_ID` (or the equivalent Resend sender). It does **not** read per-org credentials.

This is an asymmetry with the read side of Nylas integration:

| Direction          | Identity                                                                                   | Org-scoped?   |
| ------------------ | ------------------------------------------------------------------------------------------ | ------------- |
| **Read (sync/parse)** | per-source `credentials_ref.grantId` — different mailbox per org (or none if not configured) | ✅ Yes        |
| **Write (sendEmails)** | platform-wide `NYLAS_GRANT_ID` (e.g. `hello@truffalo.ai`)                              | ❌ No (MVP)   |

**Consequence in MVP**: any feature that wants to send mail "from the user's own mailbox" or "from this org's connected Nylas grant" can't use `sendEmails` today. That's a deliberate scope cut: the only outgoing mail the platform produces in MVP is system mail, and system mail should never originate from a customer's mailbox. If an org-initiated outbound flow is ever introduced (e.g. "draft & send an email to a contact from my mailbox"), it must build its own dispatcher that resolves credentials per source — see PHASE2.md item 17.

**Practical guardrails for new code in MVP**:
1. If you're adding a transactional system email (auth flow, account notification) → call `sendEmails`. Correct path.
2. If you're tempted to use `sendEmails` to send something on behalf of an org or a specific user → **don't**. That's the line the MVP doesn't cross. Either defer the feature or open a separate code path that reads `source.credentials_ref` for the right org's grantId.

## Google Infrastructure

- **Shared auth helper**: `src/lib/google-auth.ts` exposes `getGoogleAuth(scopes, subject?)` — decodes the base64-encoded service-account JSON from `GOOGLE_CHAT_CREDENTIALS` (shared across Chat and Drive) and returns a `google.auth.GoogleAuth` client with the requested scopes. **Optional `subject`**: when provided, the client impersonates that Workspace user via domain-wide delegation (DWD) — required for Chat-media download and any other endpoint that only accepts user-auth scopes. Always prefer this helper to re-reading env vars elsewhere.
- **Chat client**: `src/lib/google-chat.ts` — `googleapis` with app-auth scopes `chat.bot`, `chat.app.messages.readonly`. Used by the Chats API (see `src/app/CLAUDE.md`).
- **Drive client**: `src/lib/google-drive.ts` — `getDriveClient()` calls `getGoogleAuth(["https://www.googleapis.com/auth/drive.readonly"])` and returns `google.drive({ version: "v3" })`.
- **Nylas client**: `src/lib/nylas.ts` — Nylas SDK initialized with `NYLAS_API_KEY` + `NYLAS_API_URI`. Per-mailbox grant id moves to `source.credentials_ref` (Phase 3) — see "Per-source credentials" below.
- **Google clients**: `src/lib/google-{auth,chat,drive}.ts` — `getGoogleAuth(serviceAccountJson, scopes, subject?)` accepts a parsed service-account object, returns a `GoogleAuth` client. Per-source JSON comes from `credentials_ref`; the env-resident `GOOGLE_CHAT_CREDENTIALS` is no longer read at runtime (only by the migration script — see below).

## Per-source credentials (Phase 3)

The Sources subsystem stores per-source secrets in `source.credentials_ref` (AES-256-GCM ciphertext, base64) and reads them via the typed accessors in `src/server/providers/credentials.ts` (`getNylasCredentials` / `getGchatCredentials` / `getGdriveCredentials`). Each accessor:

1. Decrypts `credentials_ref` via `credentials-crypto.ts`.
2. Validates the decoded payload against the per-provider zod schema declared in `src/server/providers/handlers.ts` (`nylasCredentialsSchema` / `gchatCredentialsSchema` / `gdriveCredentialsSchema`).
3. Returns the typed credentials or throws `MissingCredentialsError` / `InvalidCredentialsError`.

**Env fallback policy:**
- **nylas** — keeps a fallback to `process.env.NYLAS_GRANT_ID` so bootstrap flows on un-migrated rows still work. Logs a warning when the fallback fires so production drift is visible.
- **gchat / gdrive** — NO env fallback. After the migration runs, every row carries its own service-account JSON. If `credentials_ref` is null at runtime, the handler throws an actionable error directing the operator to `/sources` → "Manage organization sources" → Configure.
- **imap** — `getImapCredentials` decrypts `{ host, port, secure, user, password }` (`imapCredentialsSchema`). **NO env fallback** — IMAP is strictly per-org (mirrors gchat/gdrive); throws `MissingCredentialsError` if `credentials_ref` is null. The non-secret mailbox folder lives in `provider_config.mailbox`. See `src/app/CLAUDE.md` § "IMAP email".
- **telegram** — `getTelegramCredentials` decrypts `{ botToken, webhookSecret }`, with a nylas-style fallback to `process.env.TELEGRAM_BOT_TOKEN` + `TELEGRAM_WEBHOOK_SECRET_TOKEN` (BOTH required) when `credentials_ref` is null — a single bootstrap bot before the per-org UI is used. Logs a warning when the fallback fires. Per-org is the norm: each org's admin pastes their own bot's token. See `src/app/CLAUDE.md` § "Telegram Bot (Sources)".

**What stays in `.env` permanently:**
- `NYLAS_API_KEY`, `NYLAS_API_URI` — platform-level Nylas tenant credentials. Authenticate Truffalo to Nylas; not per-org.
- `NYLAS_CLIENT_ID`, `NYLAS_CALLBACK_URI` — only consulted at OAuth grant-creation time.
- `CREDENTIALS_ENCRYPTION_KEY` — the master key for `credentials_ref`.
- `GOOGLE_CHAT_CREDENTIALS`, `GOOGLE_CHAT_IMPERSONATE_USER`, `NYLAS_GRANT_ID` — used ONLY by the migration script to seed existing rows. Once every row has `credentials_ref`, these env vars become vestigial (deletion safe).
- `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` / `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` — better-auth OAuth client credentials for end-user "Sign in with Google/GitHub". Unrelated to data-source access.

## Credentials encryption

- `src/lib/credentials-crypto.ts` — AES-256-GCM `encryptCredentials(plain) → string` / `decryptCredentials(packed) → T`. Used to seal `source.credentials_ref` (per-source provider secrets) before they touch the DB.
- Wire format: `base64( 0x01 | iv(12) | tag(16) | ciphertext )`. The 1-byte version prefix (currently always `0x01` = v1) is the foundation for future key rotation. Fresh IV per call, so identical plaintexts produce different ciphertexts.
- Reader dispatches: first byte `0x01` → v1, anything else → v0 legacy (no prefix). 1/256 chance a v0 blob's IV starts with `0x01` and the v1 reader is invoked by mistake — surfaces as a loud GCM auth-tag failure (not silent corruption), resolved by re-saving the row through the credentials form.
- Key comes from `CREDENTIALS_ENCRYPTION_KEY` env var (base64 of 32 bytes — `openssl rand -base64 32`), lazy-loaded on first use so Drizzle migrations don't crash when the var isn't set.
- **Future rotation (v2+):** add `CREDENTIALS_ENCRYPTION_KEY_V2`, bump VERSION_WRITE to `0x02`, add a `decryptV2()` reader. Decoder already dispatches by byte — no API change for callers. Lazy migration on next save, or a one-shot script for active migration.

## Phase 3 migration script

- `scripts/migrate-credentials-to-db.ts` — one-shot migration that copies env-resident credentials into encrypted `credentials_ref` blobs.
- Per provider:
  - **nylas** — encrypts `{ grantId: $NYLAS_GRANT_ID }`. Also strips any `grantId` field out of `providerConfig` (it was a leak of secrets into a non-secret column; new rows go to `credentials_ref` only).
  - **gchat** — encrypts `{ serviceAccountJson: $GOOGLE_CHAT_CREDENTIALS_decoded, impersonateUser: $GOOGLE_CHAT_IMPERSONATE_USER }`.
  - **gdrive** — encrypts `{ serviceAccountJson: $GOOGLE_CHAT_CREDENTIALS_decoded }`. Today gchat + gdrive share one Workspace SA; per-org isolation is achieved later by org owners pasting their own SA via the credentials form.
  - **dropoff / whatsapp / aichat** — no credentials needed, skipped.
- Idempotent: skips rows whose `credentials_ref` is already non-null.
- Inlines the crypto + zod schemas (instead of importing from `src/lib/credentials-crypto.ts`) because `import "server-only"` blocks tsx CLI execution. Wire format must stay identical to the runtime module — both write v1 (`0x01` prefix).
- Usage: `pnpm tsx scripts/migrate-credentials-to-db.ts` (dry run), `--apply` to commit, `--provider=nylas` to target one provider.

## Per-provider credentials form UI

- `src/components/forms/form-source-credentials.tsx` — schema-driven dialog. Branches by provider; each branch is a small zod-shape-aligned form (Nylas: 1 input; gchat: textarea + email; gdrive: textarea). Submits `PUT { sourceId, credentials }` to a configurable `endpoint` so both surfaces (org-owner + admin) can reuse it.
- **Write-only**: the dialog never displays existing values. The list response carries a `credentialsConfigured: boolean` projection so the row can show "Configured ✓" / "Not configured" without ever fetching plaintext. Re-opening the dialog opens with an empty form. To rotate, paste a fresh value and save.
- **Endpoints**: `PUT /api/sources/org/credentials` (owner) and `PUT /api/admin/sources/credentials` (admin). Both encrypt server-side via `credentials-crypto.ts`, validate against the provider's zod schema, return zod issues as a structured `issues[]` array on 400 so the form can surface field-level errors.

## AI Chat

- Main component: `src/components/blocks/ai-chat.tsx` (`useChat` from `@ai-sdk/react`). API route: `src/app/api/chat/route.ts` — `streamText()` with dynamic model routing + `pipeJsonRender()` to split text from JSONL patches, returns `createUIMessageStreamResponse()`.
- Models: GPT-5 Mini (`openai/gpt-5-mini`) and Gemini 2.5 Flash (`google/gemini-2.5-flash`), both routed through the Vercel AI Gateway by passing plain `provider/model` strings to `streamText`. Auth via `AI_GATEWAY_API_KEY` (no per-provider keys needed). Web search: conditional `google_search` tool via `google.tools.googleSearch()` from `@ai-sdk/google` (the tool factory returns a static descriptor and needs no provider credentials — the gateway forwards it to Gemini), toggled per-request with `enableSearch`.
- Streamdown renders AI markdown in `MessageResponse` and `Reasoning` components with plugins: code (Shiki), math, CJK, mermaid. Supports file uploads (images + text, 10MB max), speech input, suggestion pills.
- **"Thinking..." indicator**: universal shimmer shown in `ChatMessage` while the assistant message is streaming but has no visible content yet (no text, reasoning, tool, file, or json-render spec). Model-agnostic — works for Gemini which doesn't emit AI-SDK reasoning parts by default.
- **Internal search tools** (toggled per-request with `enableSources`): `searchEverything` + `getSourceItemContent`, both built by `buildSourceTools(organizationId)` server-side. The route registers the tools only when an authenticated session AND an active org are both present — `organizationId = session.session.activeOrganizationId`. **`searchEverything(query, dateFrom?, dateTo?)` is a single-call aggregator** (replaced the old two-step `findClients/findContacts/findDeals` + `getClientContent/getContactContent/getDealContent` + `searchSourceItems` chain): it resolves the query into matched `clients` (name match), `contacts` (name/native-name match OR belonging to a matched client), `deals` (name match OR matched client), and `sources` (union of each matched client's `listClientContent` curated hits + a free-text `listSourceItems` scan, deduped by id), returning all four arrays + a `counts` object. Per-section caps (12 entities, 15 sources, 5 clients expanded into content) keep the payload small. All tenant-scoped via `organizationId`; `getSourceItemContent` passes `requireOrganizationId` into `getSourceItemMarkdown` so a forged id from another org returns null. `enableSources` is mutually exclusive with `enableSearch` on Gemini (Google's built-in search tool doesn't mix cleanly with custom function tools); the client UI enforces this and the server guards too. The system prompt drives a **single-turn** flow: call `searchEverything` once → read 1-3 top source bodies via `getSourceItemContent` for grounding → write ONE concise summary referencing the counts (no disambiguation step, no follow-up turn). See `src/app/CLAUDE.md` § "Sources scope, tabs & permissions" for the full trust boundary.
- **`<SearchResultsCard>` rendering** (`src/components/blocks/search-results-card.tsx`): renders the `searchEverything` output as a **search-results view** — a deterministic count header (`клиентов: N · контактов: N · сделок: N · источников: N`, built from the tool's `counts`, never model-invented) followed by up to four sections (**Клиенты / Контакты / Сделки / Источники**). Each result card carries exactly **one** button ("Открыть") that opens the full detail in the right-side panel: entity cards fetch `/api/{clients,contacts,deals}?id=` and build a Markdown spec (client = header + facts + contacts roster; contact/deal = header + facts); source cards fetch `/api/sources/items/[id]/markdown`. All four wrap content in the single-element json-render spec (`{ root: "root", elements: { root: { type: "Markdown", props: { content, displayMode: "inline" } } } }`) and push it via `usePanelContext().openPanel(...)`. **Render ordering is decoupled from tool-call order**: `ChatMessage` extracts the `searchEverything` part and renders `<SearchResultsCard>` *after* the prose summary (and skips it in the inline part map), so the summary always reads first even though the tool runs before the text streams. `getSourceItemContent` tool calls stay hidden (`return null`). The old `<EntityCandidatesCard>` (click-to-summarize disambiguation) + `<FoundSourcesCard>` (two-button source cards) were removed.

## Structured AI Rendering (json-render)

- **Catalog**: `src/lib/catalog.ts` — defines all allowed component types with Zod schemas (charts, tables, metrics, code blocks, JSON views, key-value pairs, layout containers, **Markdown** via Streamdown, etc.). The AI is constrained to only generate components from this catalog. Zod v4 requires `z.record(z.string(), valueSchema)` — the single-argument form is invalid.
- **Registry**: `src/lib/registry.tsx` — maps each catalog component to a React implementation using shadcn/ui Charts (Recharts), DataTable, JsonViewer, CodeHighlighter, Streamdown (for Markdown), etc. `defineRegistry` requires both `components` and `actions` — built-in actions (`openPanel`, `copyToClipboard`, `navigate`) are registered here. The registry wrapper defaults `DataTable.rows`/`columns` to `[]` so tanstack-table doesn't crash when a `$state` binding resolves to `undefined`.
- **Panel context**: `src/lib/chat-panel-context.tsx` — `PanelProvider` + `usePanelContext` for managing the detail panel state (open/close, history, back navigation).
- **Integration flow**: AI generates text + JSONL patches inline → `pipeJsonRender()` on server separates them → client `useJsonRenderMessage()` extracts specs → inline preview in chat with click-to-expand into detail panel.
- **Detail panel (Rendered/Source tabs)**: uses shadcn `Tabs` to switch between the live `<Renderer>` output and a pretty-printed JSON source view (via `CodeHighlighter` with `language="json"`). Markdown content authored by the AI via the `Markdown` catalog component is rendered by Streamdown in Rendered and shown raw in Source.
- **Inline preview** (`InlinePreview` in `ai-chat.tsx`): `max-h-96 overflow-auto` so multi-element previews scroll; dispatches a `window` `resize` event via `requestAnimationFrame` after mount / when `loading` flips to `false` so Recharts' `ResponsiveContainer` re-measures correctly. Click-to-expand still opens the detail panel (scroll via wheel doesn't trigger click).
- **State bindings**: specs may include a top-level `state` object that chart/table props reference via `{"$state": "/path"}`. Both the inline preview and the detail panel must pass `initialState={spec.state ?? {}}` to `JSONUIProvider` for these bindings to resolve; otherwise they return `undefined` and charts render empty.
- **Streaming warnings**: pass `loading={isStreaming}` to `<Renderer>` to suppress `[json-render] Missing element ... will not render` warnings emitted while incremental specs are still being built.
- **System prompt**: auto-generated from `catalog.prompt({ mode: "inline" })` — tells the AI what components exist, their props, and when to use each.
- **Renderer providers**: `Renderer` must be wrapped in `JSONUIProvider` (bundles State, Visibility, Action, Validation providers). `RendererErrorBoundary` catches malformed specs.
- **Supporting components**: `src/components/data-table.tsx` (tanstack table), `src/components/json-viewer.tsx` (collapsible JSON tree), `src/components/code-highlighter.tsx` (syntax highlighting), `src/components/panel-block-wrapper.tsx` (inline/panel display mode).
- **Adding new component types**: add schema to `src/lib/catalog.ts`, add React implementation to `src/lib/registry.tsx`. The system prompt auto-updates.
