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
