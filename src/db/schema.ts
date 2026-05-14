import { relations, sql } from "drizzle-orm"
import {
  pgTable,
  text,
  timestamp,
  boolean,
  index,
  integer,
  bigint,
  jsonb,
  numeric,
  uniqueIndex,
  pgEnum,
  primaryKey,
  AnyPgColumn,
} from "drizzle-orm/pg-core"

export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").default(false).notNull(),
  image: text("image"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at")
    .defaultNow()
    .$onUpdate(() => /* @__PURE__ */ new Date())
    .notNull(),
  role: text("role").default("user"),
  banned: boolean("banned").default(false),
  banReason: text("ban_reason"),
  banExpires: timestamp("ban_expires"),
})

export const session = pgTable(
  "session",
  {
    id: text("id").primaryKey(),
    expiresAt: timestamp("expires_at").notNull(),
    token: text("token").notNull().unique(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    activeOrganizationId: text("active_organization_id"),
    activeOrganizationName: text("active_organization_name"),
    activeOrganizationLogo: text("active_organization_logo"),
    activeOrganizationSlug: text("active_organization_slug"),
    impersonatedBy: text("impersonated_by"),
  },
  (table) => [index("session_userId_idx").on(table.userId)]
)

export const account = pgTable(
  "account",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at"),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at"),
    scope: text("scope"),
    password: text("password"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [index("account_userId_idx").on(table.userId)]
)

export const verification = pgTable(
  "verification",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: timestamp("expires_at").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [index("verification_identifier_idx").on(table.identifier)]
)

export const organization = pgTable(
  "organization",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    slug: text("slug").notNull().unique(),
    logo: text("logo"),
    createdAt: timestamp("created_at").notNull(),
    metadata: text("metadata"),
  },
  (table) => [uniqueIndex("organization_slug_uidx").on(table.slug)]
)

export const role = pgEnum("role", ["member", "admin", "owner"])

export type Role = (typeof role.enumValues)[number]

export const member = pgTable(
  "member",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    role: text("role").default("member").notNull(),
    createdAt: timestamp("created_at").notNull(),
  },
  (table) => [
    index("member_organizationId_idx").on(table.organizationId),
    index("member_userId_idx").on(table.userId),
  ]
)

export const invitation = pgTable(
  "invitation",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    role: text("role"),
    status: text("status").default("pending").notNull(),
    expiresAt: timestamp("expires_at").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    inviterId: text("inviter_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
  },
  (table) => [
    index("invitation_organizationId_idx").on(table.organizationId),
    index("invitation_email_idx").on(table.email),
  ]
)

export const ruleType = pgEnum("rule_type", ["System", "Custom"])

export type RuleType = (typeof ruleType.enumValues)[number]

export const rule = pgTable(
  "rule",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    content: text("content").notNull().default(""),
    type: ruleType("type").notNull().default("Custom"),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    isDeleted: boolean("is_deleted").default(false).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    index("rule_userId_idx").on(table.userId),
    index("rule_organizationId_idx").on(table.organizationId),
    index("rule_type_idx").on(table.type),
  ],
)

export const funnelPhase = pgEnum("funnel_phase", [
  "awareness",
  "interest",
  "decision",
  "action",
  "retention",
])

export type FunnelPhase = (typeof funnelPhase.enumValues)[number]

// `initial` is reserved for clients auto-created by the company-discovery
// scan on /clients — flags them for human review before activation. The
// existing manual "New client" form keeps creating with `active`.
export const entityStatus = pgEnum("entity_status", [
  "active",
  "suspended",
  "initial",
])

export type EntityStatus = (typeof entityStatus.enumValues)[number]

export const client = pgTable(
  "client",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    phone: text("phone"),
    email: text("email"),
    address: text("address"),
    webUrl: text("web_url"),
    funnelPhase: funnelPhase("funnel_phase").notNull().default("awareness"),
    status: entityStatus("status").notNull().default("active"),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    index("client_organizationId_idx").on(table.organizationId),
    index("client_userId_idx").on(table.userId),
    index("client_status_idx").on(table.status),
  ],
)

export const contact = pgTable(
  "contact",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    phone: text("phone"),
    email: text("email"),
    position: text("position"),
    clientId: text("client_id").references(() => client.id, {
      onDelete: "set null",
    }),
    status: entityStatus("status").notNull().default("active"),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    index("contact_organizationId_idx").on(table.organizationId),
    index("contact_userId_idx").on(table.userId),
    index("contact_clientId_idx").on(table.clientId),
    index("contact_status_idx").on(table.status),
  ],
)

export const taskType = pgEnum("task_type", [
  "meet",
  "call",
  "email",
  "offer",
  "docs",
  "other",
])

export type TaskType = (typeof taskType.enumValues)[number]

export const taskPriority = pgEnum("task_priority", ["low", "medium", "high"])

export type TaskPriority = (typeof taskPriority.enumValues)[number]

export const taskStatus = pgEnum("task_status", [
  "todo",
  "in_progress",
  "done",
  "closed",
])

export type TaskStatus = (typeof taskStatus.enumValues)[number]

export const task = pgTable(
  "task",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    description: text("description"),
    type: taskType("type").notNull().default("other"),
    priority: taskPriority("priority").notNull().default("medium"),
    status: taskStatus("status").notNull().default("todo"),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    assigneeId: text("assignee_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    clientId: text("client_id").references(() => client.id, {
      onDelete: "set null",
    }),
    contactId: text("contact_id").references(() => contact.id, {
      onDelete: "set null",
    }),
    // Optional Deal link. Tasks can be created in a deal context — losing
    // the deal (defensive `set null`; under the no-hard-delete policy this
    // never fires in practice) leaves the task standalone.
    dealId: text("deal_id").references((): AnyPgColumn => deal.id, {
      onDelete: "set null",
    }),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    dueDate: timestamp("due_date").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    index("task_organizationId_idx").on(table.organizationId),
    index("task_userId_idx").on(table.userId),
    index("task_assigneeId_idx").on(table.assigneeId),
    index("task_clientId_idx").on(table.clientId),
    index("task_contactId_idx").on(table.contactId),
    index("task_dealId_idx").on(table.dealId),
    index("task_status_idx").on(table.status),
  ],
)

// ── Deals ──────────────────────────────────────────────────────────────
//
// `deal_funnel_stage` is the platform-wide funnel dictionary today
// (`is_system = true`, `owner_organization_id = null` on every seeded row).
// The `is_system` + `owner_organization_id` columns mirror the source-scope
// pattern so a future "let each org tune their own funnel" iteration is
// purely additive — insert per-org stage rows with `is_system = false` and
// `owner_organization_id = <orgId>`, and the listing query becomes
// `WHERE is_system = true OR owner_organization_id = $orgId`. Existing deals
// keep referencing whatever stage row they were created with — no migration.
//
// `closure_probability` is `numeric(4,3)` to fit values in [0.000, 1.000]
// without floating-point drift; Drizzle returns it as a string, the API
// layer parses to number on read.
export const dealFunnelStage = pgTable(
  "deal_funnel_stage",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    closureProbability: numeric("closure_probability", {
      precision: 4,
      scale: 3,
    }).notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
    isSystem: boolean("is_system").notNull().default(true),
    ownerOrganizationId: text("owner_organization_id").references(
      () => organization.id,
      { onDelete: "cascade" },
    ),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    index("deal_funnel_stage_ownerOrganizationId_idx").on(
      table.ownerOrganizationId,
    ),
    index("deal_funnel_stage_isSystem_idx").on(table.isSystem),
    index("deal_funnel_stage_isActive_idx").on(table.isActive),
  ],
)

export const deal = pgTable(
  "deal",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    description: text("description"),
    // `restrict` rather than `cascade` / `set null`: stages and clients are
    // never hard-deleted in this app (soft-delete via flags). Restrict makes
    // an accidental hard-delete fail loudly instead of orphaning deals.
    funnelStageId: text("funnel_stage_id")
      .notNull()
      .references(() => dealFunnelStage.id, { onDelete: "restrict" }),
    clientId: text("client_id")
      .notNull()
      .references(() => client.id, { onDelete: "restrict" }),
    // Nullable — operators often create a deal before a value is quoted.
    value: numeric("value", { precision: 14, scale: 2 }),
    currency: text("currency").notNull().default("USD"),
    // Soft-delete: `Cancelled` is the user's intentional opt-out and is
    // distinct from the funnel `Rejected` stage (which is a sales outcome).
    isCancelled: boolean("is_cancelled").notNull().default(false),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    index("deal_organizationId_idx").on(table.organizationId),
    index("deal_userId_idx").on(table.userId),
    index("deal_clientId_idx").on(table.clientId),
    index("deal_funnelStageId_idx").on(table.funnelStageId),
    index("deal_isCancelled_idx").on(table.isCancelled),
  ],
)

// Many-to-many: deal ↔ contact. Composite PK doubles as the dedup index
// on (dealId, contactId). Cascading on either side keeps the join table
// clean if a parent is ever hard-deleted (not expected today).
export const dealContact = pgTable(
  "deal_contact",
  {
    dealId: text("deal_id")
      .notNull()
      .references(() => deal.id, { onDelete: "cascade" }),
    contactId: text("contact_id")
      .notNull()
      .references(() => contact.id, { onDelete: "cascade" }),
  },
  (table) => [
    primaryKey({ columns: [table.dealId, table.contactId] }),
    index("deal_contact_contactId_idx").on(table.contactId),
  ],
)

export const cardPriority = pgEnum("card_priority", ["normal", "high"])

export type CardPriority = (typeof cardPriority.enumValues)[number]

export const cardCategory = pgEnum("card_category", [
  "client_activity",
  "colleagues_activity",
  "business_info",
])

export type CardCategory = (typeof cardCategory.enumValues)[number]

export const card = pgTable(
  "card",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    priority: cardPriority("priority").notNull().default("normal"),
    category: cardCategory("category").notNull(),
    // { analysis: string, recommendation: string } — produced by the
    // analysis pipeline that emits the card. Stored as JSON so the
    // shape can grow (e.g. supporting evidence links) without a
    // migration.
    message: jsonb("message").notNull().default({}),
    accepted: boolean("accepted").notNull().default(false),
    rejectionReason: text("rejection_reason"),
    // Source item whose analysis produced this card. ON DELETE SET NULL
    // so card history survives if the underlying item is purged.
    sourceItemId: text("source_item_id").references(() => sourceItem.id, {
      onDelete: "set null",
    }),
    // Rule that fired to produce this card.
    ruleId: text("rule_id").references(() => rule.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    index("card_organizationId_idx").on(table.organizationId),
    index("card_priority_idx").on(table.priority),
    index("card_category_idx").on(table.category),
    index("card_accepted_idx").on(table.accepted),
    index("card_sourceItemId_idx").on(table.sourceItemId),
    index("card_ruleId_idx").on(table.ruleId),
  ],
)

// Many-to-many: clients identified by the analysis that produced the
// card. Composite PK doubles as the dedup index on (cardId, clientId).
export const cardClient = pgTable(
  "card_client",
  {
    cardId: text("card_id")
      .notNull()
      .references(() => card.id, { onDelete: "cascade" }),
    clientId: text("client_id")
      .notNull()
      .references(() => client.id, { onDelete: "cascade" }),
  },
  (table) => [
    primaryKey({ columns: [table.cardId, table.clientId] }),
    index("card_client_clientId_idx").on(table.clientId),
  ],
)

// Many-to-many: users identified by the analysis. Note this is not the
// "creator" of the card — cards are produced by the system pipeline,
// not by an org member.
export const cardUser = pgTable(
  "card_user",
  {
    cardId: text("card_id")
      .notNull()
      .references(() => card.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
  },
  (table) => [
    primaryKey({ columns: [table.cardId, table.userId] }),
    index("card_user_userId_idx").on(table.userId),
  ],
)

export const sourceType = pgEnum("source_type", ["external", "internal"])

export type SourceType = (typeof sourceType.enumValues)[number]

// Provider dictionary — extend as new integrations land. Postgres enums
// can be appended via `ALTER TYPE … ADD VALUE`, which Drizzle Kit emits as
// a separate migration step.
export const sourceProvider = pgEnum("source_provider", [
  "nylas",
  "gchat",
  "gdrive",
  "dropoff",
  "whatsapp",
  // Internal-type provider for AI chat sessions saved from /dashboard via
  // the "Save Chat" button. No remote sync — items arrive pre-parsed at
  // save time. Lazy-provisioned per-org on first save (`getOrCreateAiChatSource`).
  "aichat",
])

export type SourceProvider = (typeof sourceProvider.enumValues)[number]

export const sourceStatus = pgEnum("source_status", ["active", "inactive"])

export type SourceStatus = (typeof sourceStatus.enumValues)[number]

// ── Source template (Phase 2 — dictionary table) ────────────────────
//
// Catalogue of source variants an admin curates. Per-org `source` rows
// are instantiated from a template via `instantiateFromTemplate(orgId,
// templateId)`. Templates carry no credentials — those are per-org by
// definition (each org's own Workspace SA / Nylas grant) and live on
// the instance row's `credentials_ref`. Soft-delete only via `status`;
// hard-deleting a template would orphan the instances that reference it
// (kept consistent by the FK's `set null` on delete).
export const sourceTemplate = pgTable(
  "source_template",
  {
    id: text("id").primaryKey(),
    type: sourceType("type").notNull().default("external"),
    provider: sourceProvider("provider").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    // Default non-secret connection routing copied into a new instance
    // at creation time. Empty `{}` for every provider in the initial
    // seed — each org has its own driveId/spaceId, so per-org override
    // is the norm. Future templates can carry hints (e.g. a default
    // mailbox label).
    defaultProviderConfig: jsonb("default_provider_config").notNull().default({}),
    defaultAutomatedParsingIsAllowed: boolean("default_automated_parsing_is_allowed")
      .notNull()
      .default(true),
    // True → bootstrap hook auto-instantiates this template into every
    // newly-created organisation. Default behavior in Phase 2 is
    // conservative: only Files Drop Off + AI Chat are `is_default`.
    // Owners add Email/GChat/GDrive themselves.
    isDefault: boolean("is_default").notNull().default(false),
    // True → template appears in the org-owner "Add source" picker.
    // Decoupled from `is_default` so an admin can hide a template from
    // owners without breaking auto-instantiation, or vice versa.
    isVisibleToOrgs: boolean("is_visible_to_orgs").notNull().default(true),
    status: sourceStatus("status").notNull().default("active"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    index("source_template_provider_idx").on(table.provider),
    index("source_template_status_idx").on(table.status),
    index("source_template_isDefault_idx").on(table.isDefault),
  ],
)

export const source = pgTable(
  "source",
  {
    id: text("id").primaryKey(),
    // Lineage: which template this row was instantiated from. Null for
    // legacy rows that pre-date Phase 2 (until backfilled) and for
    // any future custom-instance rows that don't trace to a template.
    // ON DELETE SET NULL keeps instances alive if a template is hard-
    // removed, though in practice we soft-delete (status='inactive').
    templateId: text("template_id").references(() => sourceTemplate.id, {
      onDelete: "set null",
    }),
    type: sourceType("type").notNull().default("external"),
    provider: sourceProvider("provider").notNull(),
    // Provider-specific connection config — non-secret. e.g.
    //   gchat   → { spaceId: "spaces/AAQA…" }
    //   gdrive  → { driveId: "0ADu…" }
    //   nylas   → { grantId: "…" }
    //   dropoff → {}
    providerConfig: jsonb("provider_config").notNull().default({}),
    // Nullable when isSystem = true (platform-wide source visible to every
    // org). When isSystem = false this MUST be set — enforced at the server
    // layer.
    ownerOrganizationId: text("owner_organization_id").references(
      () => organization.id,
      { onDelete: "cascade" },
    ),
    isSystem: boolean("is_system").notNull().default(false),
    // When true, the daily orchestration cron is allowed to sync /
    // parse / upload items belonging to this source. When false, the
    // source is invisible to all three pipeline phases — manual UI
    // actions (Sync / Parse / Re-parse / Upload) still work, since
    // those represent an explicit operator intent. Org owners flip
    // this from the Sources page; admins flip it from /settings.
    automatedParsingIsAllowed: boolean("automated_parsing_is_allowed")
      .notNull()
      .default(true),
    name: text("name").notNull(),
    description: text("description"),
    // AES-256-GCM ciphertext (base64). Encrypted/decrypted via
    // `src/lib/credentials-crypto.ts`. Null when the provider needs no
    // per-source secret (e.g. dropoff, or gchat using the shared service
    // account).
    credentialsRef: text("credentials_ref"),
    status: sourceStatus("status").notNull().default("active"),
    createdByUserId: text("created_by_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    lastSyncedAt: timestamp("last_synced_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    index("source_ownerOrganizationId_idx").on(table.ownerOrganizationId),
    index("source_provider_idx").on(table.provider),
    index("source_status_idx").on(table.status),
    index("source_isSystem_idx").on(table.isSystem),
    index("source_templateId_idx").on(table.templateId),
  ],
)

export type SourceTemplate = typeof sourceTemplate.$inferSelect

// Kinds of items a source can yield. `attachment` covers any file attached
// to a parent (email/chat); the actual format lives in `mime_type`.
// `inline_image` is the data-URI image extracted from an email body.
// `derived_audio` is the audio track our video parser produces alongside
// the video block — its `parent_source_item_id` points to the video item.
export const sourceItemKind = pgEnum("source_item_kind", [
  "email",
  "chat_message",
  "drive_file",
  "dropoff_file",
  "attachment",
  "inline_image",
  "derived_audio",
  // Saved AI chat session — root row for an entire conversation snapshot
  // taken via the Save Chat button on /dashboard. File parts attached to
  // the conversation become `attachment` children pointing at this row.
  "aichat_session",
])

export type SourceItemKind = (typeof sourceItemKind.enumValues)[number]

export const parseStatus = pgEnum("parse_status", [
  "pending",
  "processing",
  "complete",
  "failed",
  "skipped",
])

export type ParseStatus = (typeof parseStatus.enumValues)[number]

export const r2UploadStatus = pgEnum("r2_upload_status", [
  "pending",
  "complete",
  "failed",
])

export type R2UploadStatus = (typeof r2UploadStatus.enumValues)[number]

export const sourceItem = pgTable(
  "source_item",
  {
    id: text("id").primaryKey(),
    sourceId: text("source_id")
      .notNull()
      .references(() => source.id, { onDelete: "cascade" }),
    // Denormalised from `source.ownerOrganizationId` for fast org-scoped
    // queries and for tenant-isolation indexes. Null only for items that
    // belong to a system source. Kept in sync at insert time by the server
    // layer (the source is fetched first, its org copied to the item).
    organizationId: text("organization_id").references(() => organization.id, {
      onDelete: "cascade",
    }),
    externalId: text("external_id").notNull(),
    externalType: sourceItemKind("external_type").notNull(),
    externalUrl: text("external_url"),
    // Raw provider payload + any per-kind extras (subject, from/to,
    // participants, original creation timestamp, …). Frozen snapshot at
    // fetch time — re-fetching overwrites.
    metadataJson: jsonb("metadata_json").notNull().default({}),
    parentSourceItemId: text("parent_source_item_id").references(
      (): AnyPgColumn => sourceItem.id,
      { onDelete: "cascade" },
    ),
    // Provider-side thread/conversation grouping (Gmail threadId, Chat
    // thread name, …). Indexed so "show me this thread" is a column lookup
    // rather than a JSON probe.
    threadExternalId: text("thread_external_id"),
    filename: text("filename"),
    mimeType: text("mime_type"),
    // Bytes — never MB. Display layer formats. bigint mode "number" works
    // up to 2^53; far beyond any practical attachment size.
    sizeBytes: bigint("size_bytes", { mode: "number" }),
    // The provider's own creation timestamp (Nylas `date`, Chat
    // `createTime`, Drive `modifiedTime`). Drives "items from last week"
    // queries and incremental-sync cursors.
    sourceCreatedAt: timestamp("source_created_at"),
    fetchedAt: timestamp("fetched_at").defaultNow().notNull(),
    parseStatus: parseStatus("parse_status").notNull().default("pending"),
    parsedAt: timestamp("parsed_at"),
    parseError: text("parse_error"),
    // Bumped when a parser's prompt / schema / pipeline changes — lets the
    // re-parse job find rows produced by older versions.
    parserVersion: text("parser_version"),
    // Model that produced the markdown, e.g. `google/gemini-2.5-flash`.
    parserModel: text("parser_model"),
    // Parsed markdown body — lives here between Parse and Upload so the
    // Show modal can render it before R2 has the canonical copy. Cleared
    // (set to NULL) on a successful R2 upload; the Show modal then falls
    // back to fetching from R2 by `markdown_r2_key`. Skipped attachments
    // (unsupported / oversize / deletion) leave this NULL.
    parsedMarkdown: text("parsed_markdown"),
    r2UploadStatus: r2UploadStatus("r2_upload_status")
      .notNull()
      .default("pending"),
    r2UploadedAt: timestamp("r2_uploaded_at"),
    // Convention: `org_<orgId>/source_<sourceId>/item_<itemId>.md` — see
    // `src/app/CLAUDE.md`. Stable across re-parses (overwrite in place).
    markdownR2Key: text("markdown_r2_key"),
    markdownR2SizeBytes: bigint("markdown_r2_size_bytes", { mode: "number" }),
    // Stamped by `applyDiscoveredClients` after the user applies a client-
    // discovery preview. Subsequent runs only consider rows where this is
    // null OR `parsed_at > client_discovery_scanned_at` (so re-parses
    // re-trigger discovery for that row). Cleared by `reparseSourceItem`.
    clientDiscoveryScannedAt: timestamp("client_discovery_scanned_at"),
    // Same shape as clientDiscoveryScannedAt but for the parallel contact-
    // discovery flow on the Contacts tab. Independent timestamps because
    // running one feature shouldn't lock out the other.
    contactDiscoveryScannedAt: timestamp("contact_discovery_scanned_at"),
    // Stamped by `generateCards()` after the analysis pipeline has
    // considered this row (whether or not it produced a card). The
    // pipeline's default eligibility filter is
    //   `cardAnalysisScannedAt IS NULL OR parsedAt > cardAnalysisScannedAt`
    // so re-parses re-trigger analysis naturally. Cleared by
    // `reparseSourceItem`. The "Re-analyze already-processed items"
    // checkbox in <ExploreSourcesDialog> bypasses this filter for ad-hoc
    // re-runs.
    cardAnalysisScannedAt: timestamp("card_analysis_scanned_at"),
    // Same shape as cardAnalysisScannedAt but for the deal-discovery
    // pipeline (`generateDeals()`). Backfilled to `now()` on items whose
    // `sourceCreatedAt < 2026-05-05` so the bootstrap doesn't try to
    // process the entire historical archive — see
    // `scripts/backfill-deal-discovery-cutoff.ts`. Independent timestamp
    // because card analysis and deal discovery are orthogonal — running
    // one shouldn't lock out the other.
    dealAnalysisScannedAt: timestamp("deal_analysis_scanned_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    // Re-fetching the same provider item must update, not insert. Strict
    // unique on (source, externalId).
    uniqueIndex("source_item_source_external_uidx").on(
      table.sourceId,
      table.externalId,
    ),
    index("source_item_sourceId_idx").on(table.sourceId),
    index("source_item_organizationId_idx").on(table.organizationId),
    index("source_item_parentSourceItemId_idx").on(table.parentSourceItemId),
    index("source_item_threadExternalId_idx").on(table.threadExternalId),
    // Listing query: org's items ordered by provider creation time.
    index("source_item_org_sourceCreatedAt_idx").on(
      table.organizationId,
      table.sourceCreatedAt,
    ),
    // Worker queue: only rows that need attention. Partial index keeps it
    // tiny even as the table grows.
    index("source_item_parseStatus_pending_idx")
      .on(table.parseStatus)
      .where(sql`${table.parseStatus} in ('pending', 'failed')`),
    index("source_item_r2UploadStatus_pending_idx")
      .on(table.r2UploadStatus)
      .where(sql`${table.r2UploadStatus} in ('pending', 'failed')`),
  ],
)

// One row per orchestration run (cron-fired or manually triggered from
// the admin "Run pipeline now" button). Counts per phase + a JSON array
// of per-item failures gives the future Sources-page widget everything
// it needs without joining back to source_item. Populated by the
// engine-agnostic `runDailyPipeline()` so observability stays portable
// even if we swap Vercel Workflows for a different scheduler later.
export const pipelineRunTrigger = pgEnum("pipeline_run_trigger", [
  "cron",
  "manual",
])
export const pipelineRunStatus = pgEnum("pipeline_run_status", [
  "running",
  "success",
  "failed",
])

export type PipelineRunTrigger = (typeof pipelineRunTrigger.enumValues)[number]
export type PipelineRunStatus = (typeof pipelineRunStatus.enumValues)[number]

export const pipelineRun = pgTable(
  "pipeline_run",
  {
    id: text("id").primaryKey(),
    startedAt: timestamp("started_at").defaultNow().notNull(),
    finishedAt: timestamp("finished_at"),
    trigger: pipelineRunTrigger("trigger").notNull(),
    // 'running' on insert, set to 'success' or 'failed' at the end. A
    // cron run that crashed mid-loop will stay 'running' until the next
    // run hard-resets it — acceptable for MVP, can add a stale-run sweep
    // later.
    status: pipelineRunStatus("status").notNull().default("running"),

    // Sync phase
    syncSourcesTotal: integer("sync_sources_total").notNull().default(0),
    syncSourcesSucceeded: integer("sync_sources_succeeded")
      .notNull()
      .default(0),
    syncSourcesFailed: integer("sync_sources_failed").notNull().default(0),
    syncItemsInserted: integer("sync_items_inserted").notNull().default(0),
    syncItemsUpdated: integer("sync_items_updated").notNull().default(0),

    // Parse phase
    parseAttempted: integer("parse_attempted").notNull().default(0),
    parseComplete: integer("parse_complete").notNull().default(0),
    parseSkipped: integer("parse_skipped").notNull().default(0),
    parseFailed: integer("parse_failed").notNull().default(0),
    // Items not attempted because the per-run cap was hit. They stay
    // 'pending' and will be picked up next run.
    parseCapped: integer("parse_capped").notNull().default(0),

    // Upload phase
    uploadAttempted: integer("upload_attempted").notNull().default(0),
    uploadSucceeded: integer("upload_succeeded").notNull().default(0),
    uploadFailed: integer("upload_failed").notNull().default(0),

    // Per-failure detail. Each entry: { phase, sourceId?, sourceItemId?,
    // message }. Bounded in code to ~200 entries to keep the column
    // sane on a catastrophically bad run.
    errorsJson: jsonb("errors_json").notNull().default([]),
  },
  (table) => [
    // Default ordering for the future widget.
    index("pipeline_run_startedAt_idx").on(table.startedAt),
  ],
)

export type PipelineRun = typeof pipelineRun.$inferSelect

export const apikey = pgTable(
  "apikey",
  {
    id: text("id").primaryKey(),
    configId: text("config_id").notNull().default("default"),
    name: text("name"),
    start: text("start"),
    prefix: text("prefix"),
    key: text("key").notNull(),
    referenceId: text("reference_id").notNull(),
    refillInterval: integer("refill_interval"),
    refillAmount: integer("refill_amount"),
    lastRefillAt: timestamp("last_refill_at"),
    enabled: boolean("enabled").default(true),
    rateLimitEnabled: boolean("rate_limit_enabled").default(true),
    rateLimitTimeWindow: integer("rate_limit_time_window").default(86400000),
    rateLimitMax: integer("rate_limit_max").default(10),
    requestCount: integer("request_count").default(0),
    remaining: integer("remaining"),
    lastRequest: timestamp("last_request"),
    expiresAt: timestamp("expires_at"),
    createdAt: timestamp("created_at").notNull(),
    updatedAt: timestamp("updated_at").notNull(),
    permissions: text("permissions"),
    metadata: text("metadata"),
  },
  (table) => [
    index("apikey_key_idx").on(table.key),
    index("apikey_configId_idx").on(table.configId),
    index("apikey_referenceId_idx").on(table.referenceId),
  ]
)

export const userRelations = relations(user, ({ many }) => ({
  sessions: many(session),
  accounts: many(account),
  members: many(member),
  invitations: many(invitation),
  apikeys: many(apikey),
}))

export const sessionRelations = relations(session, ({ one }) => ({
  user: one(user, {
    fields: [session.userId],
    references: [user.id],
  }),
}))

export const accountRelations = relations(account, ({ one }) => ({
  user: one(user, {
    fields: [account.userId],
    references: [user.id],
  }),
}))

export const organizationRelations = relations(organization, ({ many }) => ({
  members: many(member),
  invitations: many(invitation),
}))

export const memberRelations = relations(member, ({ one }) => ({
  organization: one(organization, {
    fields: [member.organizationId],
    references: [organization.id],
  }),
  user: one(user, {
    fields: [member.userId],
    references: [user.id],
  }),
}))

export const invitationRelations = relations(invitation, ({ one }) => ({
  organization: one(organization, {
    fields: [invitation.organizationId],
    references: [organization.id],
  }),
  user: one(user, {
    fields: [invitation.inviterId],
    references: [user.id],
  }),
}))

export const apikeyRelations = relations(apikey, ({ one }) => ({
  user: one(user, {
    fields: [apikey.referenceId],
    references: [user.id],
  }),
}))

export type User = typeof user.$inferSelect
export type Session = typeof session.$inferSelect
export type Account = typeof account.$inferSelect
export type Verification = typeof verification.$inferSelect
export type Organization = typeof organization.$inferSelect
export type Member = typeof member.$inferSelect
export type Invitation = typeof invitation.$inferSelect
export type ApiKey = typeof apikey.$inferSelect
export type Rule = typeof rule.$inferSelect
export type Client = typeof client.$inferSelect
export type Contact = typeof contact.$inferSelect
export type Task = typeof task.$inferSelect
export type Deal = typeof deal.$inferSelect
export type DealContact = typeof dealContact.$inferSelect
export type DealFunnelStage = typeof dealFunnelStage.$inferSelect
export type Source = typeof source.$inferSelect
export type SourceItem = typeof sourceItem.$inferSelect
export type Card = typeof card.$inferSelect
export type CardClient = typeof cardClient.$inferSelect
export type CardUser = typeof cardUser.$inferSelect

export const ruleRelations = relations(rule, ({ one }) => ({
  user: one(user, {
    fields: [rule.userId],
    references: [user.id],
  }),
  organization: one(organization, {
    fields: [rule.organizationId],
    references: [organization.id],
  }),
}))

export const clientRelations = relations(client, ({ one, many }) => ({
  user: one(user, {
    fields: [client.userId],
    references: [user.id],
  }),
  organization: one(organization, {
    fields: [client.organizationId],
    references: [organization.id],
  }),
  contacts: many(contact),
}))

export const contactRelations = relations(contact, ({ one }) => ({
  user: one(user, {
    fields: [contact.userId],
    references: [user.id],
  }),
  organization: one(organization, {
    fields: [contact.organizationId],
    references: [organization.id],
  }),
  client: one(client, {
    fields: [contact.clientId],
    references: [client.id],
  }),
}))

export const taskRelations = relations(task, ({ one }) => ({
  user: one(user, {
    fields: [task.userId],
    references: [user.id],
    relationName: "task_creator",
  }),
  assignee: one(user, {
    fields: [task.assigneeId],
    references: [user.id],
    relationName: "task_assignee",
  }),
  organization: one(organization, {
    fields: [task.organizationId],
    references: [organization.id],
  }),
  client: one(client, {
    fields: [task.clientId],
    references: [client.id],
  }),
  contact: one(contact, {
    fields: [task.contactId],
    references: [contact.id],
  }),
  deal: one(deal, {
    fields: [task.dealId],
    references: [deal.id],
  }),
}))

export const dealFunnelStageRelations = relations(
  dealFunnelStage,
  ({ one, many }) => ({
    organization: one(organization, {
      fields: [dealFunnelStage.ownerOrganizationId],
      references: [organization.id],
    }),
    deals: many(deal),
  }),
)

export const dealRelations = relations(deal, ({ one, many }) => ({
  user: one(user, {
    fields: [deal.userId],
    references: [user.id],
  }),
  organization: one(organization, {
    fields: [deal.organizationId],
    references: [organization.id],
  }),
  client: one(client, {
    fields: [deal.clientId],
    references: [client.id],
  }),
  funnelStage: one(dealFunnelStage, {
    fields: [deal.funnelStageId],
    references: [dealFunnelStage.id],
  }),
  contacts: many(dealContact),
  tasks: many(task),
}))

export const dealContactRelations = relations(dealContact, ({ one }) => ({
  deal: one(deal, {
    fields: [dealContact.dealId],
    references: [deal.id],
  }),
  contact: one(contact, {
    fields: [dealContact.contactId],
    references: [contact.id],
  }),
}))

export const sourceRelations = relations(source, ({ one, many }) => ({
  organization: one(organization, {
    fields: [source.ownerOrganizationId],
    references: [organization.id],
  }),
  createdBy: one(user, {
    fields: [source.createdByUserId],
    references: [user.id],
  }),
  items: many(sourceItem),
}))

export const sourceItemRelations = relations(sourceItem, ({ one, many }) => ({
  source: one(source, {
    fields: [sourceItem.sourceId],
    references: [source.id],
  }),
  organization: one(organization, {
    fields: [sourceItem.organizationId],
    references: [organization.id],
  }),
  parent: one(sourceItem, {
    fields: [sourceItem.parentSourceItemId],
    references: [sourceItem.id],
    relationName: "source_item_parent",
  }),
  children: many(sourceItem, {
    relationName: "source_item_parent",
  }),
}))

export const cardRelations = relations(card, ({ one, many }) => ({
  organization: one(organization, {
    fields: [card.organizationId],
    references: [organization.id],
  }),
  sourceItem: one(sourceItem, {
    fields: [card.sourceItemId],
    references: [sourceItem.id],
  }),
  rule: one(rule, {
    fields: [card.ruleId],
    references: [rule.id],
  }),
  clients: many(cardClient),
  users: many(cardUser),
}))

export const cardClientRelations = relations(cardClient, ({ one }) => ({
  card: one(card, {
    fields: [cardClient.cardId],
    references: [card.id],
  }),
  client: one(client, {
    fields: [cardClient.clientId],
    references: [client.id],
  }),
}))

export const cardUserRelations = relations(cardUser, ({ one }) => ({
  card: one(card, {
    fields: [cardUser.cardId],
    references: [card.id],
  }),
  user: one(user, {
    fields: [cardUser.userId],
    references: [user.id],
  }),
}))

export const schema = {
  user,
  session,
  account,
  verification,
  organization,
  member,
  invitation,
  apikey,
  rule,
  client,
  contact,
  task,
  deal,
  dealContact,
  dealFunnelStage,
  source,
  sourceItem,
  pipelineRun,
  card,
  cardClient,
  cardUser,
}
