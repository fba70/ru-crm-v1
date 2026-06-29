# Phase 2 — Deferred concerns for the Sources / source_item pipeline

A running list of things explicitly scoped out of the current iteration but
that need to land before the sync → parse → upload flow can run unattended
(cron, queues, AI agents). Order roughly reflects priority — the first few
block any kind of batch automation, the rest are quality-of-life or
architectural.

---

## 1. Sync-time deletion / change detection

The current sync uses `max(sourceCreatedAt) - overlap` cursors with
provider time-window queries (`receivedAfter`, `createTime > X`,
`modifiedTime > X`). These miss **deletes** entirely and only pick up
edits if the edit advances the timestamp.

**Upgrade paths.**

- **Drive** has a proper [Changes API](https://developers.google.com/workspace/drive/api/guides/manage-changes):
  `changes.list({ pageToken })` returns adds / edits / deletes / moves /
  trashings / restorations since the last token. We'd store the page
  token per source row (new column `sync_cursor_token TEXT` or stash in
  `provider_config`) and reconcile against `source_item`.
- **Nylas** has [delta sync via webhooks](https://developer.nylas.com/docs/v3/notifications/webhooks/) and a polling [delta endpoint](https://developer.nylas.com/docs/v3/email/delta-sync/).
  Pick one based on whether we want push or pull.
- **Google Chat** has [event subscriptions](https://developers.google.com/workspace/chat/events-overview)
  for spaces. Webhook-based.

**When to do this.** When the cost of "stale rows that turn out to be
404 at parse time" becomes annoying, or when we need true mirror
semantics (e.g. compliance: "if it's deleted upstream, delete our copy
within X hours"). Until then, item 1's parse-time handling is enough to
keep batches running.

---

## 2. Drive re-edit → reset parseStatus

Today `gdrive.ts` upserts on `(sourceId, externalId)` and refreshes
metadata, but `parseStatus` stays at whatever it was — so an
already-parsed file that's been edited keeps showing as Done in the
Processed table even though its parsed content is stale.

**Fix.** In `upsertSourceItem`, accept an optional
`resetParseOnContentChange: boolean`. The Drive sync passes `true`; the
upsert compares incoming `sourceCreatedAt` (= `modifiedTime`) against
the existing row's value and sets `parseStatus = 'pending'` +
`r2UploadStatus = 'pending'` when it advances. Email and chat bodies are
immutable, so they pass `false` and never trigger.

**Note.** This conflicts with Phase 2 item 1 — if Drive resets status to
pending, the next batch will try to re-parse a file that may have been
deleted. Item 1's classifier needs to land first or simultaneously.

---

## 3. Per-org sources + encrypted credentials_ref

> **✅ Source ownership LANDED.** All five seeded sources are now
> per-org rows (`is_system = false`, `owner_organization_id = <orgId>`),
> not platform-wide singletons. WhatsApp Archive added as a sixth
> per-org provider. `source_item.organization_id` is denormalised
> from `source.owner_organization_id` at upsert + parse time. API
> routes / AI chat tools / orchestration all enforce tenant scope.
> Org owners can flip `automatedParsingIsAllowed` and `status` from
> the new "Manage organization sources" tab on `/sources`. Admins
> retain full source CRUD on `/settings`. Details in
> `src/app/CLAUDE.md` § "Sources scope, tabs & permissions".
>
> **🟡 Encrypted `credentials_ref` reads NOT yet wired.** Source rows
> can carry encrypted credentials (the admin form accepts them, the
> column persists them via AES-256-GCM), but the parsers and sync
> functions still read auth from `.env`. So adding a per-org row with
> a custom Nylas grant doesn't yet mean that grant gets used —
> everyone's email sync still goes through the shared `NYLAS_GRANT_ID`.
> Wiring `credentials_ref` reads into the per-provider sync /
> attachment-download paths is the remaining work.

---

## 4. Migrate live-fetch routes to read provider_config

`/api/emails/route.ts` reads `NYLAS_GRANT_ID` from `process.env` directly.
`/api/chats/route.ts` has `SPACE_ID` hardcoded as a const.
`/api/drive/route.ts` accepts `driveId` as a query param and trusts it.

After Phase 2 these routes can either:

- Take a `sourceId` query param and look up `provider_config` server-side
  (cleanest, but requires updating any remaining callers).
- Be deleted outright (item 5) if all consumers move to `source_item`-backed
  reads.

Keep until item 3 happens.

---

## 5. Sync pagination (multi-page per call)

`SYNC_PAGE_LIMIT = 100` per call. If a source falls more than 100 items
behind the cursor, the next sync picks up the next 100 (cursor
advances naturally from the inserted rows). This is fine for cron but
awkward for first-time backfill (admin clicks Sync Emails 50 times to
catch up).

**Options.**

- Loop internally until either the page returns empty or a wall-clock
  budget is hit (e.g. 60s of the route's 120s `maxDuration`). Keeps the
  API surface simple.
- Add a `?fullSync=true` flag that uncaps and uses background work
  (Vercel Queues, etc.).

---

## 6. Auto-sync on first visit

When the Sources page loads and both Pending + Processed are empty for
all four syncable providers, optionally fire one Sync per provider
automatically. Pro: no empty-state confusion. Con: surprise provider
API calls on every cold-cache page load. Cron makes this moot.

**Safer middle ground**: a single "Sync all sources" button next to the
per-provider ones, so the user opts in.

---

## 7. Sync observability

Today sync writes `source.last_synced_at` but not _what happened_.
Useful to add:

- `source_sync_log` table: `(id, sourceId, startedAt, finishedAt,
fetched, inserted, updated, error)` rows per sync run. One row per
  invocation, kept for ~30 days.
- Settings page widget showing per-source last sync time / count /
  error.
- Handles the "did cron actually run last night?" question without
  digging through Vercel function logs.

> **Partially landed** for the orchestration side: `pipeline_run` rows
> are written by `runDailyPipeline` (one per cron / manual run) with
> per-phase counts + an `errors_json` array. A Sources-page widget that
> reads them is the remaining piece. A `source_sync_log` per-source row
> is still nice-to-have if we want sub-pipeline drilldown.

---

## 8. Pipeline tuning (schedule + caps)

Pipeline cadence + caps live in `src/server/orchestration/config.ts`
as hardcoded constants:

- `cron` — schedule expression read by `vercel.ts` at build time.
- `maxParsePerRun` — items past the cap stay `pending` for next run.
- `maxUploadPerRun` — same idea, separately tunable.
- `maxErrorsPerRun` — bounds `pipeline_run.errors_json` size.

Changing any of these requires a redeploy. **Move to a system_settings
dictionary (or .env) when an admin needs to tune without a deploy.**

When that lift happens, `vercel.ts` will need to either:

- Keep the cron expression in env (`process.env.PIPELINE_CRON`) — but
  Vercel evaluates `vercel.ts` at build time, so env-driven cron means
  rebuilding to change the schedule, which defeats the point.
- Or: fix the cron at e.g. hourly and let the runtime pipeline check
  whether it's "due to run" against a DB-stored schedule. More flexible,
  one extra check per hour.

Caps are runtime constants and lift cleanly into either source.

---

## 9. AI chat: synthesize multi-result search hits into one brief

`src/app/api/chat/route.ts` exposes two internal-sources tools today:
`searchSourceItems` and `getSourceItemContent`. The chat UI renders
search results as a single "Found Source(s)" card stack
(`<FoundSourcesCard>`) with per-card Preview + Open-in-panel
buttons — content display is now user-driven via those buttons rather
than model-driven via tool calls. (The earlier `showSourceItemsInPanel`
tool was removed when this UX landed.)

For dense result sets (10+ hits across multiple emails / chats) it
would still be more useful to fold them into a **single synthesized
markdown brief** with cross-references back to the originals. Add a
third tool `summarizeSourceItems({ sourceItemIds, focus })` that
fetches the markdowns, runs a second Gemini pass with a "synthesis"
prompt, and returns a single coherent brief. The chat could either
render the brief directly inline OR push it as a new card above the
source list.

Trade-offs to settle when this lands:

- Cost: one extra LLM call per request — bound it with a hit-count
  threshold (e.g. only auto-call when ≥4 items are returned).
- Faithfulness: the synthesis pass should quote/cite, not paraphrase
  away the detail — system prompt must enforce direct attributions.
- UX: probably want a toggle so the user can choose "show me each one"
  vs "give me the summary".

---

## 10. AI chat: replace ILIKE source search with FTS / pgvector

`searchSourceItems` currently delegates to `listSourceItems()` which
runs `ILIKE '%query%'` on `filename` + `metadataJson::text`. Works for
MVP but:

- Misses morphological variants ("invoice" doesn't match "invoices",
  "kostenvoranschlag" doesn't match "kostenvoranschläge").
- No relevance ranking — just `ORDER BY sourceCreatedAt DESC`.
- Can't do semantic queries ("emails feeling tense about Q2").
- Sequential scan once the table grows past a few thousand rows.

Two upgrade paths, can layer:

**a) Postgres full-text search (tsvector + GIN index).** Cheap, no
new infra, native ranking via `ts_rank`. Add a generated column
`fts tsvector GENERATED ALWAYS AS (to_tsvector('english', filename ||
' ' || metadataJson::text)) STORED` plus a GIN index. Multilingual
needs `'simple'` config or per-row language detection (we already
classify language during parse — store it on the row and pick the
config dynamically). Good for keyword precision.

**b) Embeddings + pgvector.** Generate embeddings of `parsed_markdown`
(via Gateway) at parse time, store in `vector(1024)`, query by cosine
similarity. Catches semantic matches FTS misses. Adds embedding cost
per parse + a vector index, but Neon supports pgvector natively so no
new database. Good for "find me anything about X" style queries.

Most useful sequence: land FTS first (small change, big precision win),
evaluate whether semantic search is worth the embedding cost based on
real query patterns.

---

## 11. Batch-controls — server-side rate-limit handling

The "Parse all" + "Upload all to R2" controls (Pending and Processed
tables, plus Stored Content) drive client-side parallel chunk loops
against the existing per-row endpoints. Slow Mode (1-wide + 4 s
delay) is the user-facing knob for staying under AI Gateway free-tier
RPM caps. Two follow-ups when scale increases:

- **Server-side 429 detection + reset to `pending`.** Today, when
  the LLM call returns 429 (rate-limited), `parseSourceItem` catches
  the error and sets `parseStatus = 'failed'` with the rate-limit
  message. The user can then re-run "Parse all" (which now picks up
  failed rows alongside pending) and the rows retry. Cleaner: detect
  rate-limit errors in the catch arm and revert to `parseStatus =
  'pending'` (instead of `'failed'`) so the cron pipeline AND batch
  control automatically pick them up next tick without flagging them
  as user-actionable failures. Pattern-match the error string for
  "rate limit" / "429" / "quota" / "too many requests".
- **Move the loop server-side.** Each chunk is currently N parallel
  POSTs from the browser, which means the browser tab has to stay
  open. For 500-row batches in slow mode (≥30 minutes), that's
  brittle. Move to a queue: client POSTs `{ ids[] }`, server enqueues,
  worker drains. Vercel Queues fits cleanly here once we're off the
  free tier.

---

## 12. WhatsApp — additional providers + per-conversation sources

Today there's exactly one "WhatsApp Archive" source per org, seeded
via `scripts/seed-whatsapp-source.ts`. If an operator has multiple
WhatsApp chats they want to track separately (e.g. one per major
client), they currently can't — every archive lands in the same
source.

Two upgrade paths:

- **Multiple per-org WhatsApp sources** — admin Settings page already
  supports adding new `provider = whatsapp` rows; the upload route
  needs to be widened to accept a `sourceId` so the dialog can pick
  WHICH WhatsApp source to ingest into. Today the route hardcodes
  `LIMIT 1` on the source lookup.
- **Per-conversation source on first import** — the dialog could
  auto-create a new WhatsApp source per archive (named by the chat
  participant or thread), so the operator never manages source rows
  manually. Probably overkill until there's a clear product need.

---

## 13. WhatsApp — chat-history change detection on re-import

Re-uploading the same archive folder is idempotent thanks to
content-hash + group-key dedup, but it doesn't catch **edited
messages**. WhatsApp's text export doesn't carry edit timestamps, so
an edited message just reads as new text under the same timestamp.
Our group-key hash uses (firstISO, lastISO, authorsJoined) so
content edits within a stable group window don't change the key —
the row stays the same, but its `metadataJson.rawText` is now stale.

Options when this becomes annoying:

- Add `messageBodyHash` to the group-key calculation so an edited
  group inserts as a new row. Loses idempotency for benign re-exports.
- On every re-import, compare each existing group's `rawText` against
  the freshly-parsed transcript and only update when they differ;
  reset `parseStatus = 'pending'` so the LLM metadata gets re-derived.
  More complex, more correct.

## 14. Contact discovery from non-Nylas sources

Originally: the discover-from-sources flow only scanned Nylas rows
because they were the only provider whose `metadata_json` carried
structured `{email, name}` participant pairs. Two waves have since
generalised this — both **SHIPPED**:

- **Wave 1 — sync-time per-provider participants.** `gchat` / `gdrive`
  sync now write a canonical `metadata_json.participants: {email,
  name}[]` (Chat space-member resolution of the sender; Drive
  owners + last-modifying user). Discovery's `extractParticipants`
  reads this for any provider, with the Nylas envelope as a fallback.
  See `src/app/CLAUDE.md` § "Per-provider participant extraction".
- **Wave 2 — LLM body-mention extraction.** Every parser's existing
  Gemini call now also emits `metadata_json.mentionedPeople: {name,
  email, organization, confidence}[]` — third parties referenced
  *inside* the body (e.g. "John Donn (john.donn@acme.com) handles
  that"). Persisted to high-confidence + non-empty email only
  (`filterMentionedPeople`). Discovery reads it as the third
  participant source. See `src/app/CLAUDE.md` § "LLM-extracted
  `metadata_json.mentionedPeople`".

### Open follow-ups

★ **Medium-confidence body mentions.** The LLM already emits
`confidence: "medium"` entries (org inferred from the author's
affiliation — the "my colleague Jane" case the user originally asked
about); the v1 `filterMentionedPeople` drops them. Highest-ROI
follow-up. Requires either relaxing the filter or splitting into
`mentionedPeopleHigh` / `mentionedPeopleMedium`, plus a new review
section in `<DiscoverDialog>`.

★ **Email-less mentioned people.** A separate surface for high-value
names with no email (the v1 filter requires an email because contact
discovery dedups by it). Options: (1) make `contact.email` nullable +
add a `(name, organization)` dedup key, or (2) a new `mentioned_person`
table linked to source items, read-only until promoted to a real
contact. (2) is probably the right call — these are leads, not
contacts yet.

Smaller remaining items under this umbrella: **WhatsApp
phone-as-contact-channel** (authors have phone numbers, not emails —
needs a `phone` column + phone-keyed dedup) and a **regex body-scan
safety net** (`Name <email@…>` / bare `email@…` over parsed markdown,
as a fallback where the provider/LLM doesn't expose emails).

---

## 15. Clean up debug `console.log`s in LLM pipelines

Both `src/server/cards-generation.ts` and `src/server/deals-discovery.ts`
emit verbose per-item logs (`[generate-cards] …`, `[generate-deals] …`)
plus batch-start / batch-end summaries. The matching client dialogs
(`<ExploreSourcesDialog>`, `<DiscoverDealsDialog>`) also `console.log`
the full server response on every run for DevTools inspection.

These were intentional for the bring-up phase — letting the operator
see per-item LLM verdicts and skip reasons in the browser console
while tuning the rule prompt. Once the rules stabilise:

- Drop the per-item `[generate-deals] <id> · …` logs (the result
  counters + `errors[]` array already carry the same info in a more
  digestible shape).
- Drop the dialog-side `console.log("[discover-deals] server response:", data)`
  + the equivalent in `<ExploreSourcesDialog>`.
- Keep the start / done batch summary lines — they're the one-liner
  that lets you grep production logs for "what did the last run do?"
  without expanding the response object.

Affected files:
- `src/server/cards-generation.ts`
- `src/server/deals-discovery.ts`
- `src/components/blocks/explore-sources-dialog.tsx`
- `src/components/blocks/discover-deals-dialog.tsx`

Trivial cleanup; mostly a one-pass deletion. Worth a single PR after
both rules have been validated by enough real runs that per-item
debug output stops earning its keep.

---

## 16. Deal discovery — tuning + future enhancements

Tracked together so the next iteration on `src/server/deals-discovery.ts`
has a single punch list.

- **Rule-prompt enforcement is operator-owned.** The forward-only stage
  move guard, the "no Known Client → SKIP not CREATE" rule, and the
  "no signal → SKIP not no-op UPDATE_STAGE" rule all live in the rule
  prompt today (see `refs/deals-rule.md`). If discovery pollutes the
  pipeline often enough, lift these into server-side enforcement:
  - Stage-direction guard in `generateDeals()`: reject any UPDATE_STAGE
    whose `newStageProbability < currentStageProbability` (except a
    move to a stage with probability 0, i.e. Rejected). Counted as
    `skippedBackwardMove` rather than `stageUpdates`.
- **Preview-then-apply variant.** Auto-apply was the right call for
  parity with Cards, but for high-stakes orgs you may want a "preview"
  mode that returns the decisions without committing. Schema is
  already shaped for this — just need a `commit: boolean` flag on
  the API request and a small UI surface to render proposals with
  per-row checkboxes (mirror `<DiscoverContactsDialog>`).
- **Deal-value extraction confidence.** Today `newDealValue` is a
  bare number with no signal of how confident the model is. A deal
  silently created with `value = 0` blends into the "value not
  stated" bucket. Add a `newDealValueConfidence: "stated" | "inferred"
  | "unknown"` enum so the operator can spot inferred guesses on
  the kanban (e.g. an icon on the deal card).
- **Multi-deal source items.** A single source item can plausibly
  describe two unrelated deal signals (e.g. an email touching two
  clients). The current schema is single-action per item — adopting
  an array would multiply LLM-side complexity for a rare case.
  Defer until a real example hits the floor.
- **Stage-only vs. value+description drift.** UPDATE_STAGE today only
  changes `funnel_stage_id`. If the source contains updated description
  or value (e.g. "they're now quoting €120k for the Acme renewal"),
  that signal is dropped. Could extend the schema with optional
  UPDATE_STAGE fields (`updatedValue`, `updatedDescription`) and let
  the server merge them into the existing deal. Same Gemini sentinel
  pattern applies (use 0 / "" for "no change").
- **Org-customised funnel — UI for editing stages.** Today an org
  customises stages by re-pointing the system rows in the DB (set
  `is_system = false` + `owner_organization_id`) and re-running
  `seed-deal-funnel-stages.ts` to bootstrap fresh system rows. No
  UI for it. Build a Settings panel that:
  - Clones system stages into org-scoped rows on first edit.
  - Lets owners rename / re-probability / re-order them.
  - Detects when an existing deal's stage row would be archived and
    offers a remap.
- **Deal detail page.** `client-detail-shell.tsx` exists; the deal
  equivalent doesn't. Open-button on the deal card, page at
  `/deals/[id]`, shows the deal + linked client + linked contacts +
  attached tasks (filter on `task.dealId`) + activity history (which
  source items contributed to which stage moves — would need a
  per-update audit log to surface).
- **Deal-context task creation.** `task.dealId` exists but the task
  edit form doesn't expose a deal picker. Land alongside the deal
  detail page so the natural entry point is "create task in this
  deal's context", which auto-fills `dealId`.
- **Per-deal currency in the funnel-value summary.** Today the headline
  number is hard-coded `€` and sums values numerically regardless of
  stored currency — fine while every deal is EUR, but blends silently
  if currencies start mixing. When that happens: bucket the sum per
  currency and render as `€105k · $42k · £18k`, or with FX rates
  normalise to a primary currency and show conversion notes on hover.
- **Bootstrap cutoff is a constant in code.** `DEAL_DISCOVERY_BOOTSTRAP_CUTOFF`
  in `scripts/backfill-deal-discovery-cutoff.ts` is hard-coded
  (`2026-05-05`). Re-runs of the script use the same date. If the
  cutoff needs to move (e.g. you onboard a new org with a different
  history depth), this becomes a per-org policy that should live in
  `system_settings` or a per-org column. Today: edit-and-redeploy.
- **Discovery provenance + bulk discard (for massive rule testing).**
  Today's rule-testing loop is: dry-run to preview, then commit, then —
  if the committed deals were junk — open each one and set
  `status = 'deleted'` by hand (which excludes them from a fresh
  re-scan, so re-running re-creates cleanly thanks to the create-side
  dedup keyed on non-deleted deals). That hand-cleanup is the bottleneck
  once you're testing many rules against a large window. When that pain
  shows up:
  - Stamp provenance on auto-created deals: `discovery_rule_id`
    (FK → `rule`, `set null`) and ideally `discovery_source_item_id`
    (FK → `source_item`, `set null`) — set only by `generateDeals` CREATE,
    null for manual + UPDATE_STAGE.
  - Add a "Discard all deals from this run/rule" bulk action that flips
    every matching deal to `status = 'deleted'` in one call (server fn +
    a button on the Deals tab or the discover dialog's result panel).
    Pairs with the existing dedup so the very next dry-run/run re-creates
    a clean set.
  - Optional: a `discovery_run_id` (uuid minted per `generateDeals` call,
    returned in the result) for run-level — not just rule-level — discard
    granularity. Defer unless rule-level proves too coarse.
  This was explicitly scoped out of the dry-run + `deleted`-status
  iteration that introduced `deal_status`; dry-run already covers the
  "test without writing" need, so provenance/bulk-discard only matters
  once committed-then-cleanup becomes routine at scale.
- **Same-run create-side dedup keyed on `clientId` only.** Today the
  in-memory dedup at [src/server/deals-discovery.ts:359](src/server/deals-discovery.ts#L359)
  uses `(clientId, normaliseName(dealName))`. The LLM can — and does —
  reword the same opportunity into two different names within a single
  batch, slipping past the name half of the key. Observed incident
  (2026-05-28): deals `525e730d…` and `3beba6be…` were both created in
  the same run for client "Вектор" at the same Qualification stage,
  fed by the same 4-email Nylas thread, with names "Запрос на
  демонстрацию платформы" vs. "Решение для управления клиентами с
  помощником". Fix: keep the DB-seeded set as-is so distinct existing
  deals across runs are still respected, but add a `createdThisRun:
  Map<clientId, { dealId, stageProb }>`. The first CREATE for a
  `clientId` in the run wins; any subsequent CREATE for the same
  client converts to UPDATE_STAGE on the just-created deal (if the
  LLM's proposed stage probability is higher) or SKIP (otherwise).
  Cost: small change to the CREATE branch in `generateDeals()`, no
  schema migration, no extra LLM calls. Trade-off: if two genuinely
  distinct opportunities for one client arrive in the same scan batch,
  the second gets folded — rare, and recoverable by hand.
- **Deal ↔ source_item provenance join table.** Sibling to the dedup
  fix above, and overlaps with "Discovery provenance + bulk discard".
  Deals carry no FK to the source items that produced them — the only
  way to answer "which emails created this deal" is to query
  `source_item.dealAnalysisScannedAt` in a ±N-minute window around the
  deal's `createdAt` (which is how the 2026-05-28 incident was traced).
  Land a `deal_source_item (deal_id, source_item_id, kind: 'create' |
  'stage_move', created_at)` join table written by `generateDeals` on
  both CREATE and UPDATE_STAGE. Unlocks: trivial provenance audit on
  the deal detail page, cross-run dedup by `threadExternalId` (a new
  source item whose thread matches an open deal's evidence routes to
  UPDATE_STAGE instead of CREATE), and the activity-history surface
  already listed under "Deal detail page". Schema is additive; the
  same-run dedup above stands alone and doesn't depend on this.

---

## 17. Org-scoped outbound email (split system mail from org mail)

Current state in MVP: `sendEmails` always uses the platform's own
`NYLAS_GRANT_ID` (e.g. `hello@truffalo.ai`). It's appropriate for
**system / platform** mail — invitations, OTP codes, password reset,
verification — and intentionally not appropriate for anything else.
The read side of Nylas integration is per-org (each `source` row has
its own `credentials_ref.grantId`); the write side is platform-wide.
That asymmetry is fine for MVP because no feature today wants to send
on behalf of an org or user. As soon as one does, this needs to land.

**Triggering features.** Any of these tip the scales:
- Reply-from-CRM ("compose & send an email to a contact from my
  connected mailbox").
- Operator-initiated outreach ("Send the contract draft to
  alice@acme.com from this org's grant").
- Workflow-driven sends (a Rule that emits a follow-up email per deal
  stage transition).
- Per-org / per-user transactional notifications that should look
  like they came from that customer's own domain (e.g. white-label).

**Design sketch.**
- New dispatcher: `sendOrgEmail({ organizationId, sourceId?, … })` in
  `src/lib/email.ts` (or a new `src/lib/email-org.ts`). Resolves the
  outbound grant via:
  1. `sourceId` (explicit) → load that source's `credentials_ref.grantId`.
  2. Otherwise pick the org's default Nylas source (the one with
     `provider = 'nylas' AND owner_organization_id = orgId AND
     status = 'active'`); if there's >1 the call must be explicit.
- `sendEmails` (the existing function) stays as the **system-mail-only**
  path. Rename to `sendSystemEmail` for clarity once the org path
  exists; keep a deprecation shim under the old name during migration.
- Extend `nylasCredentialsSchema` to require a `gmail.send` scope (or
  equivalent) for any source flagged as send-capable. Today the schema
  only validates the grantId is present, not its capabilities.
- Add a per-source `capabilities` flag (or piggyback on
  `provider_config`) like `canSendOnBehalfOf: boolean` so an org can
  connect a read-only mailbox without accidentally exposing it as a
  send identity.

**Auth + compliance considerations** (each is a reason to NOT rush this):
- Sending from a customer's mailbox means our service has authority
  over their outbound brand. SPF/DKIM/DMARC alignment, reply-handling,
  and unsubscribe semantics all become per-org concerns.
- Bounce / reject / spam-flag handling needs to feed back into the
  source's health (today bounces aren't surfaced anywhere).
- Audit log of org-scoped outbound mail (who sent what from where) —
  invites a new `outbound_message` table or extends `source_item`.

**Until it lands.** Do NOT add new call sites that dispatch through
`sendEmails` for non-system mail. The pattern in `src/lib/CLAUDE.md`
§ "MVP limitation: outgoing mail is platform-scoped" is the rule:
system mail → `sendEmails`; everything else → defer or build a
separate per-org dispatcher.

---

## 18. Per-source Nylas API_KEY (multi-Application support)

Today the Nylas integration assumes a single Nylas Application: every
source row uses the platform-wide `process.env.NYLAS_API_KEY` /
`process.env.NYLAS_API_URI` to authenticate to Nylas, and only the
per-mailbox `grantId` lives in `source.credentials_ref`. That's correct
as long as every customer mailbox is connected as a grant under the
same Nylas Application.

**When this needs to change.** If/when:
- The Nylas free tier's 5-grants-per-Application limit becomes a
  blocker and the workaround is splitting customers across multiple
  Nylas Applications (each App has its own free 5 grants).
- A customer asks for total OAuth-client-identity isolation (different
  "Connect with…" branding per App).
- Compliance / billing wants per-customer Nylas Apps.

**What to change.**
- Extend `nylasCredentialsSchema` in `src/server/providers/handlers.ts`
  to optionally accept `apiKey` + `apiUri` alongside `grantId`. When
  absent, callers fall back to the env vars (current behaviour).
- Update `getNylasCredentials` in `src/server/providers/credentials.ts`
  to thread the per-source API_KEY through.
- Replace the singleton `nylas` client in `src/lib/nylas.ts` with a
  factory `getNylasClient(apiKey, apiUri)` that callers instantiate
  per-source. Cache by `apiKey` to avoid rebuilding per call.
- Update the credentials form (`<FormSourceCredentials>`) to expose
  optional API_KEY + API_URI fields under an "Advanced — different
  Nylas Application" disclosure. Default state: hidden, fall back
  to env.

**Reference**: see `src/lib/CLAUDE.md` § "Email Delivery" and the
Nylas-confirmation walkthrough in chat / commit history. The current
single-App assumption is documented in
`src/components/forms/form-source-credentials.tsx`'s Nylas help text.

---

## 19. Contact identification edge cases — body signer ≠ envelope sender

Discovered while testing on a small Russian-language email dataset.
Both cases are real but marginal; parked together because a single
design decision (what does `name_native` actually mean?) determines
the fix for both. Re-trace via the source items / contact rows called
out below.

### Case A — body signer is a *different person* from the envelope sender

The parser pairs a body-signature name to the envelope From address
(via `participantDetails` in `src/server/parsers/text.ts` +
`_shared.ts`), and discovery writes that as `contact.name_native` /
`contact.phone` on the envelope owner's contact. When the body is
genuinely signed by someone else who happens to be using that mailbox
(shared inbox, reply-on-behalf, family Gmail), the envelope owner ends
up wearing the signer's identity.

Concrete example in the test org `1dNkC4rBtl9FEvnK95Svlfs63oSU57Ni`:

- Contact `72f5fb03-60b4-407e-8d03-5d17da50fdf3` — name
  `Margarita Amalitskaya`, name_native `Алексей Смирнов`,
  phone `+7 (999) 123-45-67`. Sourced from source_item
  `206161c1-421b-4480-af5c-f25f6ef1c29b` (subject
  `Re: Демо для ООО «Вектор»`, parsed 2026-05-22) — envelope From
  `amalitskaya@gmail.com`, body signed `Алексей` with that phone.
- Same pattern on `121146a8…` (`Маргарита Амалицкая` /
  `Елена Воробьёва`) and `a824b2ea…` (`margo@crmexpert.team` /
  `Игорь Кравцов`). Three of the org's seven non-deleted contacts.

The prompt in `_shared.ts:169-178` (`PARTICIPANT_DETAILS_PROMPT`)
explicitly tells the LLM the From sender "signs the message" — that
assumption is the leak point. The LLM dutifully attached the body
signature to whichever envelope address looked closest, with no
escape hatch for "obvious mismatch".

### Case B — body author has no envelope address at all

Contact discovery is **email-keyed end-to-end**. A person who appears
only inside the body (signature, contact block, "Я Анна, …") with
name + phone + organization but no email has no insertion key, no
dedup key, and no way to attach `name_native` / `phone` after the
fact. They land in `metadata_json.mentions` (the freeform string array
used for search), but `extractParticipants` never reads `mentions` —
it reads `participants`, envelope from/to/cc/bcc, and
`mentionedPeople` only. `filterMentionedPeople` additionally strips
any entry that's `confidence !== 'high'` OR `email === ''`, so emailless
body people are dropped before persist by design.

Concrete example: source_item
`acb5f983-9d11-4d42-8b77-32ef2ecbb8c9` — envelope From
`alexander.bobrowski@gmail.com`, body opens
"Приветствую! Я Анна, руководитель отдела продаж в «Альфа-Маркет»",
signs off with name + phone `+7 (903) 222-33-44`. After discovery:
client `Альфа-Маркет` was created (good), `mentions` includes
`Анна Петрова` (good for search), but no contact for Анна (and
Alexander's existing contact got no `name_native` / `phone`
backfill either, because `participantDetails` came back empty —
the LLM correctly refused to pair `Анна Петрова` with Alexander's
address under the current strict prompt).

### The semantic question to settle first

What does `contact.name_native` mean?

- **Option A** — "the name this mailbox's body identifies with,
  regardless of envelope display name". Cheap to implement:
  - Relax `PARTICIPANT_DETAILS_PROMPT` to drop the "who signs the
    message" assumption; tell the LLM to record the outer body's
    signer (skip quoted / forwarded) attributed to the sending
    envelope address even when they're plainly different people.
  - `filterParticipantDetails` already handles dedup
    (longest-name-wins) — no change needed.
  - Re-parse to backfill. The three "wrong" `name_native` rows
    above immediately become correct-by-new-definition; Анна's
    name + phone backfills onto Alexander's contact.
  - **Trade-off:** if the same mailbox is used by multiple distinct
    body signers over time, only the longest name survives (history
    of signers is lost on the contact — still preserved in source
    items for search). For genuine shared mailboxes you can't
    distinguish "Анна today, Алексей tomorrow" from "same person,
    name updated".

- **Option B** — "Анна is a separate contact". Heavier — breaks the
  email-keyed invariant:
  - New parser field: `bodySigners: [{ name, phone, organization }]`,
    separate from `participantDetails` (envelope-keyed) and
    `mentionedPeople` (third-party body mentions).
  - New contact-keying path: `(name + organization)` or phone, since
    email is missing. Dedup gets fuzzy: `Анна П.` / `Анна Петрова` /
    `Anna Petrova` all need to collapse. Risk of duplicates is real.
  - New section in `<DiscoverDialog>` ("People mentioned without an
    email") with per-row Create-contact buttons. Linkage to inferred
    client when org name matches an existing client.
  - Operator has to add the email later when known, or the same
    body person re-surfaces on every re-parse (name dedup is
    fuzzier than email dedup).

### Suggested decision when revisiting

Probably ship Option A first — minimal-risk, retroactively reframes
the three already-misattributed rows as correct, and matches what the
existing `name_native` column + UI already imply. Park Option B until
operators specifically ask "I need to assign tasks to Анна as her
own person, not as a hint on Alexander's card". The two are
compatible: A first, B later as a separate review surface, no schema
collision.

### What changes if/when we ship this

- Prompt text in `src/server/parsers/_shared.ts` —
  `PARTICIPANT_DETAILS_PROMPT` (Option A) and possibly a new
  `BODY_SIGNERS_PROMPT` (Option B).
- `MetadataAnalysis` shape — optional new field for Option B.
- `extractParticipants` / `previewDiscovery` / `applyDiscovery` in
  `src/server/discovery.ts` — new aggregation map for Option B; for
  Option A the existing `nativeByEmail` / `phoneByEmail` already
  cover the path, just with looser source data.
- `<DiscoverDialog>` (`src/components/blocks/discover-dialog.tsx`) —
  new section for Option B only.
- Re-parse + re-scan to backfill. The existing
  "Re-scan already-reviewed items" checkbox is enough; soft-delete
  any rows whose attribution we want to overwrite (see CLAUDE.md
  §"Discover from sources" for the test-iterate loop).

### Until it lands

Operators should treat `name_native` on a contact as "what the body
of an email from this address said" rather than "the same person's
real name in their native script". The contact card already shows
`name_native` as a subtitle (after the recent swap, as the title
with `name` muted underneath) — visually flags the mismatch even
when the attribution semantics are still ambiguous.

---

## 20. Telegram bot ingestion — Phase 2/3 + hardening

Phase 1 (DM text ingestion) shipped and is verified in production: per-org
bot, token in `credentials_ref`, push-ingested via
`POST /api/webhooks/telegram/[sourceId]`, rendered + LLM-analysed by
`src/server/parsers/telegram.ts` (WhatsApp-style — body in
`metadata_json.rawText`, no remote re-fetch). grammY, NOT Vercel Chat SDK;
NO deep-link tenant binding (the bot IS the tenant). See `src/app/CLAUDE.md`
§ "Telegram Bot (Sources)" and the spec in
`refs/telegram-bot-ingestion-spec.md`. Deferred work, roughly by priority:

### Phase 2 — Attachments (the big one)

- Photos / documents / voice / video / audio sent or forwarded to the bot.
  Each Telegram message carries `file_id`s; resolve via `getFile` → download
  from `https://api.telegram.org/file/bot<token>/<file_path>` → route the
  bytes through the **existing** per-format parsers (`parseDropoffFile` /
  PDF / image / audio / video / office) and insert as `attachment` child
  rows of the parent `chat_message` row — exactly the dropoff/whatsapp
  child-linkage convention.
- **Fast-ack constraint:** attachment download + parse can blow past the
  webhook function's `maxDuration`. Do verify → resolve tenant → enqueue
  synchronously and return 200 fast; offload the heavy work to **Vercel
  Workflows** (durable, longer timeout). The webhook should NOT block on
  the parse. (Phase 1's synchronous path is fine because text ingest is
  trivial; attachments are not.)
- **20 MB cap:** the standard Bot API caps downloads at ~20 MB. Larger
  files need a self-hosted Bot API server (`TELEGRAM_API_BASE_URL`). Decide
  whether to skip-with-reason (mirror the parsers' oversize `skipped`
  semantics) or stand one up. Probably skip-with-reason for v1.
- **Media groups:** multiple photos/files sent together arrive as
  **separate updates** sharing a `media_group_id`. They must be regrouped
  before ingestion (buffer by `media_group_id` with a short window, keyed in
  Redis/Upstash or a transient table). Until then each lands as its own row.

### Phase 3 — Groups, rate limiting, polish

- **Group @-mention ingestion** (privacy ON): the webhook currently ignores
  non-private chats. Handle group messages that @-mention the bot — needs
  `botUsername` (already in `provider_config`) to detect the mention, and
  `allowed_updates` widened. `setTelegramWebhook` currently registers only
  `["message"]`; widen to include what group handling needs.
- **Per-user identity binding (optional).** v1 attributes ingested items at
  the source/org level only (sender captured in `metadata_json.telegram.from`
  but not mapped to a Truffalo user). If per-user attribution is wanted
  later, add a `telegram_user_id → user_id` map via a deep-link
  `/start <token>` onboarding — but ONLY the per-user layer; org resolution
  stays structural (per-org bot). This is the one piece of the original
  spec's §B5 we deliberately did NOT build.
- **Rate limiting** per Telegram user/chat to prevent ingestion-flooding a
  tenant (spec §7). Deferred with the rest of the project's rate-limit work
  (no Upstash wired yet — see #11).
- **Command menu** (`/start`, `/help`, `/connect`) via BotFather
  `/setcommands` for discoverability; `edited_message` handling (re-ingest
  edits as updates to the same `external_id`).

### Hardening / quality

- **Idempotency via `update_id`.** Today idempotency rides purely on
  `UNIQUE(source_id, external_id)` (`<chat_id>:<message_id>`), which is
  correct for retries of the SAME message. A belt-and-braces `update_id`
  dedupe (Redis set / short-TTL table) would also swallow duplicate
  *updates*, but isn't strictly needed given the unique key.
- **"Re-register webhook" affordance.** Webhook (re)registration only fires
  on credential-save AND only when `NEXT_PUBLIC_APP_URL` is a public HTTPS
  origin. A per-source "Re-register webhook" button (calls
  `registerTelegramWebhookForSource`) would let operators re-trigger it
  after an env/URL change without re-typing credentials. (We hit exactly
  this in prod bring-up: the bare `/api/webhooks/telegram` URL was
  registered manually and 404'd until the `/<sourceId>` segment was added.)
- **Webhook health surfacing.** Surface Telegram `getWebhookInfo`
  (`url`, `pending_update_count`, `last_error_message`) in the source row /
  admin view so a misconfigured webhook is visible in-app instead of via
  curl. This is the single most useful diagnostic and is currently
  out-of-band.
- **`drop_pending_updates` on re-register.** `setTelegramWebhook` passes
  `drop_pending_updates: true`, so re-registering discards queued messages.
  Fine for setup; revisit if operators expect a backlog to replay.
- **Manual-fetch (`getUpdates`) is dev-only by design.** The per-source
  "Fetch" button 409s whenever a webhook is active (surfaced as a "webhook
  active" toast). Keep it OFF the cron (`supportsRemoteSync: false`,
  `supportsManualFetch: true`). If a no-webhook polling deployment is ever
  wanted, a `deleteWebhook` action + a cron poll would be the seam.
- **Self-hosted Bot API server** (`TELEGRAM_API_BASE_URL`) — only if the
  20 MB cap or higher throughput becomes a real constraint.
