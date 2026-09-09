"use server"

import { db } from "@/db/drizzle"
import { client, contact, deal, dealFunnelStage, order } from "@/db/schema"
import {
  and,
  desc,
  eq,
  notInArray,
  or,
  sql,
  type AnyColumn,
  type SQL,
} from "drizzle-orm"
import { getServerSession } from "@/lib/get-session"

async function requireOrgContext() {
  const session = await getServerSession()
  if (!session) throw new Error("Unauthorized")
  const activeOrgId = session.session.activeOrganizationId
  if (!activeOrgId) throw new Error("No active organization")
  return { activeOrgId }
}

const HITS_PER_ENTITY = 8
const MIN_QUERY_LENGTH = 2

// ── Normalised, fuzzy matching (Search V2 pipeline) ─────────────────
//
// This search used to be `ILIKE '%' || q || '%'` on the raw columns, which
// fails the way every raw-substring search over this data fails: «АСТ» never
// finds the stored «AST – Российская Алкогольная Компания», «НТехЛаб» never
// finds «NTechLab», and a query typed with an em-dash never finds a name
// stored with an en-dash. Measured on real org data, four of six realistic
// queries returned nothing at all.
//
// Both sides now go through the SAME pipeline products use (see
// refs/search-v2-plan.md and scripts/search-v2/01-foundation.ts, which
// installed these functions): `lower(immutable_unaccent(translit_cyr_lat(x)))`.
// On top of that, a pg_trgm `word_similarity >= 0.3` arm recovers typos and
// romanisation drift the exact form can't — the same retriever and the same
// threshold as the product engine, so the two agree about what "matches".
//
// The JS twin of this lives in `src/lib/entity-search.ts` (used by the AI
// chat's `searchEverything` and the deals-board client picker, which match
// against lists already in memory). Keep the two in step: same normalisation,
// same 0.3 gate.
const FUZZY_THRESHOLD = 0.3

// Fuzzy matching is enabled only from 3 characters up. `word_similarity`
// against a 2-character query scores high on far too much text; the exact
// (substring) arm still runs at MIN_QUERY_LENGTH, so short queries keep
// working — they just stay literal.
const MIN_FUZZY_QUERY_LENGTH = 3

export type ClientSearchHit = {
  kind: "client"
  id: string
  name: string
  status: string
  email: string | null
}

export type ContactSearchHit = {
  kind: "contact"
  id: string
  name: string
  clientName: string | null
  email: string | null
}

export type DealSearchHit = {
  kind: "deal"
  id: string
  name: string
  funnelStageName: string
  clientName: string | null
}

export type OrderSearchHit = {
  kind: "order"
  id: string
  orderDate: string
  clientName: string | null
  status: string
}

export type GlobalSearchResult = {
  query: string
  clients: ClientSearchHit[]
  contacts: ContactSearchHit[]
  deals: DealSearchHit[]
  orders: OrderSearchHit[]
}

const EMPTY_RESULT = (query: string): GlobalSearchResult => ({
  query,
  clients: [],
  contacts: [],
  deals: [],
  orders: [],
})

export async function searchAcrossEntities(
  rawQuery: string,
): Promise<GlobalSearchResult> {
  const { activeOrgId } = await requireOrgContext()
  const q = rawQuery.trim()
  if (q.length < MIN_QUERY_LENGTH) return EMPTY_RESULT(q)

  const fuzzy = q.length >= MIN_FUZZY_QUERY_LENGTH

  // The query, normalised by the SAME SQL functions applied to the columns —
  // deliberately not normalised in JS, so the two sides can never drift.
  const qNorm = sql`lower(immutable_unaccent(translit_cyr_lat(${q})))`

  /** A column, normalised. NULL collapses to '' so it simply never matches. */
  const norm = (col: AnyColumn): SQL =>
    sql`lower(immutable_unaccent(translit_cyr_lat(coalesce(${col}, ''))))`

  /**
   * A `text[]` column, normalised. Joined with spaces rather than cast to
   * text so the array's own `{`, `}` and `,` punctuation can't wedge itself
   * between a query and the alias it should match.
   */
  const normArray = (col: AnyColumn): SQL =>
    sql`lower(immutable_unaccent(translit_cyr_lat(coalesce(array_to_string(${col}, ' '), ''))))`

  /** Exact (substring) arm + fuzzy arm for one normalised expression. */
  const matches = (expr: SQL): SQL =>
    fuzzy
      ? sql`(${expr} LIKE '%' || ${qNorm} || '%' OR word_similarity(${qNorm}, ${expr}) >= ${FUZZY_THRESHOLD})`
      : sql`(${expr} LIKE '%' || ${qNorm} || '%')`

  /**
   * Relevance for ordering: the best fuzzy score across the entity's
   * identifying fields. Ranked results matter more here than in the old
   * version — the fuzzy arm widens the candidate set, so the best match has
   * to lead rather than merely be present. `updatedAt` stays the tiebreak.
   */
  const relevance = (exprs: SQL[]): SQL =>
    sql`greatest(${sql.join(
      exprs.map((e) => sql`word_similarity(${qNorm}, ${e})`),
      sql`, `,
    )})`

  const clientFields = [
    norm(client.name),
    norm(client.namePhys),
    normArray(client.aliases),
  ]
  const contactFields = [
    norm(contact.name),
    norm(contact.nameNative),
    normArray(contact.aliases),
  ]
  const dealFields = [norm(deal.name), norm(deal.description)]

  const [clientRows, contactRows, dealRows, orderRows] = await Promise.all([
    db
      .select({
        id: client.id,
        name: client.name,
        status: client.status,
        email: client.email,
      })
      .from(client)
      .where(
        and(
          eq(client.organizationId, activeOrgId),
          notInArray(client.status, ["deleted", "blocked"]),
          or(
            ...clientFields.map(matches),
            // Email and phone stay literal: normalising them buys nothing
            // (both are already ASCII) and a fuzzy address match is noise.
            matches(norm(client.email)),
            matches(norm(client.phone)),
          ),
        ),
      )
      .orderBy(desc(relevance(clientFields)), desc(client.updatedAt))
      .limit(HITS_PER_ENTITY),

    db
      .select({
        id: contact.id,
        name: contact.name,
        email: contact.email,
        clientName: client.name,
      })
      .from(contact)
      .leftJoin(client, eq(contact.clientId, client.id))
      .where(
        and(
          eq(contact.organizationId, activeOrgId),
          notInArray(contact.status, ["deleted", "blocked"]),
          or(
            ...contactFields.map(matches),
            matches(norm(contact.email)),
            matches(norm(contact.phone)),
          ),
        ),
      )
      .orderBy(desc(relevance(contactFields)), desc(contact.updatedAt))
      .limit(HITS_PER_ENTITY),

    db
      .select({
        id: deal.id,
        name: deal.name,
        funnelStageName: dealFunnelStage.name,
        clientName: client.name,
      })
      .from(deal)
      .innerJoin(dealFunnelStage, eq(deal.funnelStageId, dealFunnelStage.id))
      .leftJoin(client, eq(deal.clientId, client.id))
      .where(
        and(
          eq(deal.organizationId, activeOrgId),
          eq(deal.status, "active"),
          or(...dealFields.map(matches)),
        ),
      )
      .orderBy(desc(relevance(dealFields)), desc(deal.updatedAt))
      .limit(HITS_PER_ENTITY),

    // `order` has no name/number field — search matches the order's own
    // description or its client's name. This is a real limitation, not an
    // oversight: there's nothing else human-identifying to match on.
    db
      .select({
        id: order.id,
        orderDate: order.orderDate,
        status: order.status,
        clientName: client.name,
      })
      .from(order)
      .innerJoin(client, eq(order.clientId, client.id))
      .where(
        and(
          eq(order.organizationId, activeOrgId),
          or(matches(norm(order.description)), matches(norm(client.name))),
        ),
      )
      .orderBy(desc(order.orderDate))
      .limit(HITS_PER_ENTITY),
  ])

  return {
    query: q,
    clients: clientRows.map((r) => ({ kind: "client", ...r })),
    contacts: contactRows.map((r) => ({ kind: "contact", ...r })),
    deals: dealRows.map((r) => ({ kind: "deal", ...r })),
    orders: orderRows.map((r) => ({
      kind: "order",
      id: r.id,
      orderDate:
        r.orderDate instanceof Date
          ? r.orderDate.toISOString()
          : String(r.orderDate),
      clientName: r.clientName,
      status: r.status,
    })),
  }
}
