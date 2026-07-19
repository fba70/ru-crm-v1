import "server-only"
import { sync as icalSync } from "node-ical"

// iCalendar (.ics) meeting-invite decoder. Pure, server-only, and NEVER
// throws — a malformed invite must not fail the parent email parse. The
// email parsers fold the decoded event into the SAME email's metadata +
// markdown (no new table, no child row). See refs/calendar-invites.md.

export type CalendarPerson = { name: string; email: string }

export type CalendarEvent = {
  summary: string
  description: string
  location: string
  start: Date | null
  end: Date | null
  organizer: CalendarPerson | null
  attendees: CalendarPerson[]
}

// node-ical surfaces text props as `string | { val, params }` (ParameterValue)
// and organizer/attendee as the same shape with a `params` bag carrying CN /
// CUTYPE. Type the helpers loosely and narrow at runtime.
type ParamValue = string | { val?: unknown; params?: unknown } | undefined | null

/** Read the textual value of a node-ical property (`val` or the bare string). */
function pvText(p: ParamValue): string {
  if (p == null) return ""
  if (typeof p === "string") return p
  if (typeof p === "object" && typeof p.val === "string") return p.val
  return ""
}

/** Read one param (e.g. CN, CUTYPE) off a node-ical property's params bag. */
function pvParams(p: ParamValue, key: string): string {
  if (p == null || typeof p !== "object") return ""
  const params = p.params
  if (!params || typeof params !== "object") return ""
  const v = (params as Record<string, unknown>)[key]
  return typeof v === "string" ? v : ""
}

/** mailto:John@Acme.com → john@acme.com. Empty when not a usable address. */
function normaliseEmail(raw: string): string {
  const stripped = raw.replace(/^mailto:/i, "").trim().toLowerCase()
  return stripped.includes("@") ? stripped : ""
}

/** Map a node-ical organizer/attendee property to a {name,email} pair. */
function toPerson(p: ParamValue): CalendarPerson | null {
  const email = normaliseEmail(pvText(p))
  if (!email) return null
  return { name: pvParams(p, "CN").trim(), email }
}

/**
 * True when an email attachment is an iCalendar invite by content-type or
 * filename. `text/calendar` (and the `application/ics` variant) plus a `.ics`
 * extension fallback for misreported content-types.
 */
export function isIcsAttachment(
  contentType: string | null | undefined,
  filename: string | null | undefined,
): boolean {
  const ct = (contentType ?? "").toLowerCase()
  const fn = (filename ?? "").toLowerCase()
  if (ct.includes("text/calendar")) return true
  if (ct.includes("application/ics")) return true
  return fn.endsWith(".ics")
}

/**
 * Decode the first parseable VEVENT in a raw .ics blob. Returns null on
 * anything unparseable (missing VCALENDAR, throw, no VEVENT). Never throws.
 */
export function parseIcsToEvent(raw: string | Uint8Array): CalendarEvent | null {
  let text: string
  try {
    text = typeof raw === "string" ? raw : Buffer.from(raw).toString("utf8")
  } catch {
    return null
  }
  if (!text || !text.includes("BEGIN:VCALENDAR")) return null

  let parsed: Record<string, unknown>
  try {
    parsed = icalSync.parseICS(text) as Record<string, unknown>
  } catch {
    return null
  }

  for (const value of Object.values(parsed)) {
    if (
      !value ||
      typeof value !== "object" ||
      (value as { type?: unknown }).type !== "VEVENT"
    ) {
      continue
    }
    const ev = value as Record<string, unknown>

    const attendeesRaw = ev.attendee
    const attendeeList = Array.isArray(attendeesRaw)
      ? attendeesRaw
      : attendeesRaw != null
        ? [attendeesRaw]
        : []

    const attendees: CalendarPerson[] = []
    for (const a of attendeeList) {
      // Drop meeting rooms / resources / distribution lists — not CRM contacts.
      const cutype = pvParams(a as ParamValue, "CUTYPE").toUpperCase()
      if (cutype === "ROOM" || cutype === "RESOURCE" || cutype === "GROUP") {
        continue
      }
      const person = toPerson(a as ParamValue)
      if (person) attendees.push(person)
    }

    return {
      summary: pvText(ev.summary as ParamValue).trim(),
      description: pvText(ev.description as ParamValue).trim(),
      location: pvText(ev.location as ParamValue).trim(),
      start: ev.start instanceof Date ? ev.start : null,
      end: ev.end instanceof Date ? ev.end : null,
      organizer: toPerson(ev.organizer as ParamValue),
      attendees,
    }
  }

  return null
}

/** Organizer + attendees, deduped by lowercased email (longest name wins). */
export function eventParticipantPairs(ev: CalendarEvent): CalendarPerson[] {
  const byEmail = new Map<string, string>()
  const consider = (p: CalendarPerson | null) => {
    if (!p) return
    const existing = byEmail.get(p.email)
    if (existing === undefined || p.name.length > existing.length) {
      byEmail.set(p.email, p.name)
    }
  }
  consider(ev.organizer)
  for (const a of ev.attendees) consider(a)
  return Array.from(byEmail.entries()).map(([email, name]) => ({ email, name }))
}

/** All participant emails — fed into the participant-domain URL derivation. */
export function eventEmails(ev: CalendarEvent): string[] {
  return eventParticipantPairs(ev).map((p) => p.email)
}

/** Best display label for a person in markdown / prompt text. */
function personLabel(p: CalendarPerson): string {
  return p.name ? `${p.name} <${p.email}>` : p.email
}

/**
 * Compact prompt block describing the invite, injected into the email LLM
 * prompt so organisation/people extraction works even on a body-less invite.
 */
export function buildCalendarContext(ev: CalendarEvent): string {
  const lines: string[] = []
  if (ev.summary) lines.push(`Meeting: ${ev.summary}`)
  if (ev.start) lines.push(`When: ${ev.start.toISOString()}`)
  if (ev.location) lines.push(`Location: ${ev.location}`)
  if (ev.organizer) lines.push(`Organizer: ${personLabel(ev.organizer)}`)
  if (ev.attendees.length > 0) {
    lines.push(`Attendees: ${ev.attendees.map(personLabel).join(", ")}`)
  }
  if (ev.description) lines.push(`Description: ${ev.description}`)
  return lines.join("\n")
}

/** Deterministic `## Meeting` markdown section appended to the email body. */
export function buildMeetingSection(ev: CalendarEvent): string {
  const lines: string[] = ["## Meeting", ""]
  if (ev.summary) lines.push(`**${ev.summary}**`, "")
  const facts: string[] = []
  if (ev.start) {
    const when = ev.end
      ? `${ev.start.toISOString()} → ${ev.end.toISOString()}`
      : ev.start.toISOString()
    facts.push(`- **When:** ${when}`)
  }
  if (ev.location) facts.push(`- **Location:** ${ev.location}`)
  if (ev.organizer) facts.push(`- **Organizer:** ${personLabel(ev.organizer)}`)
  if (ev.attendees.length > 0) {
    facts.push(`- **Attendees:** ${ev.attendees.map(personLabel).join(", ")}`)
  }
  if (facts.length > 0) lines.push(...facts, "")
  if (ev.description) lines.push(ev.description, "")
  return lines.join("\n").trimEnd()
}
