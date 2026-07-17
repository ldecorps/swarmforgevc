// BL-490: the Expedite verb's own safety posture - the human explicitly
// opts into jumping the coordinator's orthogonality/sequencing triage, but
// the ticket specs that the forced dispatch must still SERIALISE AT THE
// FILE LEVEL: an in-flight build is never preempted. This is the PURE core
// (paths in -> collision or none) - the impure reads (which files an
// in-flight ticket/the expedited ticket touch) live in the thin wiring
// that calls this (telegram-front-desk-bot.ts).

const PATH_TOKEN_PATTERN = /\b[\w-]+(?:\/[\w.-]+)+\.[a-zA-Z]{1,10}\b/g;

// Extracts file-path-like tokens from a ticket's free-text description/notes
// - the same "Scope:"/prose convention the coordinator's own Concurrent Work
// Orthogonality rule already reads by hand (workflow.prompt); this is the
// deterministic, testable equivalent for the Expedite bot path. Dedupes via
// a Set so a path mentioned twice in the same ticket text still counts once,
// preserving first-seen order (never a factor for collision detection, but
// keeps the result stable/testable).
export function extractScopePaths(text: string | undefined): string[] {
  if (!text) {
    return [];
  }
  return Array.from(new Set(text.match(PATH_TOKEN_PATTERN) ?? []));
}

export interface InFlightScope {
  id: string;
  paths: string[];
}

// Pure: the first in-flight ticket (if any) whose own touched-file set
// overlaps the expedited ticket's - never a percentage/fuzzy match, exactly
// one shared path is enough to require serialising (the ticket's own "an
// in-flight coder task cannot be preempted; same-file tickets must be
// serialised" precedent). Returns the colliding ticket's id so the toast
// can name it.
export function findFileCollision(targetPaths: string[], inFlight: InFlightScope[]): string | undefined {
  const targetSet = new Set(targetPaths);
  for (const candidate of inFlight) {
    if (candidate.paths.some((path) => targetSet.has(path))) {
      return candidate.id;
    }
  }
  return undefined;
}

// The stale-safe toast text shown when a forced dispatch collides with an
// in-flight same-file build - the ticket is still approved and promoted
// (never preempting the in-flight build), just not dispatched THIS instant.
export function unsafeDispatchToastText(collidingTicketId: string): string {
  return `Forced dispatch unsafe - queued behind in-flight ${collidingTicketId} (same file), not preempted.`;
}
