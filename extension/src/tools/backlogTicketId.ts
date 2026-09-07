/**
 * BL-1452: the ONE definition of what a backlog ticket id is on the
 * TypeScript side - `BL-<n>` (human-authored) and `GH-<n>` (GitHub-seeded,
 * BL-114) both count. Anchored at both ends (a task name's leading id is a
 * DIFFERENT question - swarmMetrics.ts's own unanchored `TICKET_ID_PATTERN`
 * answers that one; this predicate must never be widened into it, or a
 * validator that is supposed to REJECT a malformed id would start accepting
 * one with trailing garbage). Case-insensitive, matching every other
 * ticket-id reader in this codebase (bb and TS alike).
 *
 * Every TypeScript tool that validates a ticket id argument imports this,
 * never a private copy - bounceArgsCore.ts's and qa-sibling-check.ts's own
 * former `^BL-\d+$` copies were exactly this hazard: a GH-seeded ticket's
 * bounce silently went unrecorded because the pattern only knew one
 * namespace (2026-09-06, GH-24).
 */
export const BACKLOG_TICKET_ID_PATTERN = /^(BL|GH)-\d+$/i;

export function isBacklogTicketId(value: string | undefined): value is string {
  return !!value && BACKLOG_TICKET_ID_PATTERN.test(value);
}
