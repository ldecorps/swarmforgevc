// BL-454: "which agent bounces most from QA?" was unanswerable - attribution
// lived only as prose/filename across the backlog/evidence/*.md corpus, with
// no structured counter. This module is the pure core: the closed-set
// attribution vocabulary (engineering.prompt's Gherkin load-bearing-column
// rule - every value is validated against an explicit KNOWN_VALUES lookup,
// never a passthrough), the record shape, its idempotency natural key, and
// the tally aggregator. The impure store (qaBounceStore.ts) and the evidence
// parser (qaBounceEvidenceParser.ts) both depend on this module, not the
// other way around.

export const KNOWN_PRODUCING_ROLES = ['coder', 'cleaner', 'architect', 'hardender', 'documenter'] as const;
export type QaBounceProducingRole = (typeof KNOWN_PRODUCING_ROLES)[number];

// BL-608: the role DOING the bouncing, distinct from producingRole (the role
// held responsible). Only QA runs record-qa-bounce.js today (out of scope:
// wiring sibling reviewer roles' own bounce rituals to the recorder is a
// follow-up ticket) - closed to that one value now rather than accepting any
// string, so the set only grows with a deliberate schema change.
export const KNOWN_BOUNCING_ROLES = ['QA'] as const;
export type QaBounceBouncingRole = (typeof KNOWN_BOUNCING_ROLES)[number];

export const KNOWN_TICKET_TYPES = ['feature', 'bug', 'defect', 'chore', 'docs', 'enhancement', 'epic'] as const;
export type QaBounceTicketType = (typeof KNOWN_TICKET_TYPES)[number];

export const KNOWN_FAILURE_CLASSES = ['compile', 'unit', 'integration', 'acceptance', 'behavior'] as const;
export type QaBounceFailureClass = (typeof KNOWN_FAILURE_CLASSES)[number];

function isKnownValue<T extends string>(known: readonly T[], value: string): value is T {
  return (known as readonly string[]).includes(value);
}

export function isKnownProducingRole(value: string): value is QaBounceProducingRole {
  return isKnownValue(KNOWN_PRODUCING_ROLES, value);
}

export function isKnownBouncingRole(value: string): value is QaBounceBouncingRole {
  return isKnownValue(KNOWN_BOUNCING_ROLES, value);
}

export function isKnownTicketType(value: string): value is QaBounceTicketType {
  return isKnownValue(KNOWN_TICKET_TYPES, value);
}

export function isKnownFailureClass(value: string): value is QaBounceFailureClass {
  return isKnownValue(KNOWN_FAILURE_CLASSES, value);
}

export interface QaBounceRecord {
  ticket: string;
  producingRole: QaBounceProducingRole;
  ticketType: QaBounceTicketType;
  failureClass: QaBounceFailureClass;
  commit: string;
  at: string; // ISO 8601 timestamp
}

// BL-635: the full pipeline vocabulary for the GENERALISED recorder's
// required --by flag - every reviewing stage that can send work back, not
// just QA. Kept separate from KNOWN_BOUNCING_ROLES above (that stays
// QA-only forever: it is the OLD record-qa-bounce CLI's own locked
// contract, still exercised by its own BL-454/BL-608 tests) rather than
// widening it in place and risking those tests' negative assertions.
export const KNOWN_BOUNCE_ROLES = ['specifier', 'coder', 'cleaner', 'architect', 'hardender', 'documenter', 'QA'] as const;
export type BounceRole = (typeof KNOWN_BOUNCE_ROLES)[number];

export function isKnownBounceRole(value: string): value is BounceRole {
  return isKnownValue(KNOWN_BOUNCE_ROLES, value);
}

// BL-635: identical to QaBounceRecord plus `by` - optional on the TYPE
// (the 53 legacy qa_bounces records predate --by reaching the JSONL line
// at all) even though the generalised CLI makes the flag REQUIRED going
// forward. A record with `by` absent reads as unattributed
// (bounceAttribution below), never silently folded into QA or any other
// role (record-bounce-by-role-06).
export interface BounceRecord extends QaBounceRecord {
  by?: BounceRole;
}

export function bounceAttribution(record: Pick<BounceRecord, 'by'>): string {
  return record.by ?? 'unattributed';
}

// BL-635: the generalised store's own dedup key - ticket + date + failure
// class + commit + by. Deliberately finer than qaBounceNaturalKey above
// (which this ticket leaves untouched - it is the OLD store's own locked
// idempotency contract, and bounceHistory.ts's ticket-YAML merge key stays
// date+class only for the same reason). The whole point of the by-role
// generalisation is that the SAME ticket can legitimately bounce more than
// once in a single day (BL-590: four architect send-backs in one day),
// each citing its own commit - none of those may collapse into the others.
export function bounceNaturalKey(record: Pick<BounceRecord, 'ticket' | 'failureClass' | 'at' | 'commit' | 'by'>): string {
  const dateOnly = record.at.slice(0, 10);
  return `${record.ticket}|${dateOnly}|${record.failureClass}|${record.commit}|${bounceAttribution(record)}`;
}

export function hasBounceRecord(existing: BounceRecord[], candidate: BounceRecord): boolean {
  const key = bounceNaturalKey(candidate);
  return existing.some((r) => bounceNaturalKey(r) === key);
}

// Idempotency key: ticket + the DATE portion of `at` (not the exact
// timestamp) + failure class. Two recordings of the same bounce made
// seconds apart on the same day - a live write racing a backfill, or a
// re-run of either - must collapse to one entry (BL-454's own idempotency
// constraint), so the key deliberately ignores producingRole/ticketType
// (they do not vary for the same ticket+day+class) and the time-of-day.
export function qaBounceNaturalKey(record: Pick<QaBounceRecord, 'ticket' | 'failureClass' | 'at'>): string {
  const dateOnly = record.at.slice(0, 10);
  return `${record.ticket}|${dateOnly}|${record.failureClass}`;
}

export function hasQaBounceRecord(existing: QaBounceRecord[], candidate: QaBounceRecord): boolean {
  const key = qaBounceNaturalKey(candidate);
  return existing.some((r) => qaBounceNaturalKey(r) === key);
}

export interface QaBounceRoleTally {
  role: string;
  count: number;
}

export interface QaBounceTally {
  byRole: QaBounceRoleTally[];
  byTicketType: Record<string, number>;
  total: number;
}

// Pure aggregator - the unit/acceptance seam the ticket calls out
// explicitly. Ranks roles by bounce count, most first; ties break
// alphabetically by role so the ranking is deterministic for a fixed input.
export function computeQaBounceTally(records: QaBounceRecord[]): QaBounceTally {
  const roleCounts = new Map<string, number>();
  const typeCounts: Record<string, number> = {};
  for (const record of records) {
    roleCounts.set(record.producingRole, (roleCounts.get(record.producingRole) ?? 0) + 1);
    typeCounts[record.ticketType] = (typeCounts[record.ticketType] ?? 0) + 1;
  }
  const byRole = [...roleCounts.entries()]
    .map(([role, count]) => ({ role, count }))
    .sort((a, b) => b.count - a.count || a.role.localeCompare(b.role));
  return { byRole, byTicketType: typeCounts, total: records.length };
}

// BL-635 (record-bounce-by-role-14): who did the BOUNCING, distinct from
// computeQaBounceTally's byRole above (whose work bounced). A legacy
// by-less record attributes as unattributed (bounceAttribution) - never
// silently folded into QA, the role every one of the 53 pre-BL-635 records
// happened to come from.
export function computeBounceTallyByBouncingRole(records: BounceRecord[]): QaBounceRoleTally[] {
  const counts = new Map<string, number>();
  for (const record of records) {
    const role = bounceAttribution(record);
    counts.set(role, (counts.get(role) ?? 0) + 1);
  }
  return [...counts.entries()].map(([role, count]) => ({ role, count })).sort((a, b) => b.count - a.count || a.role.localeCompare(b.role));
}
