// BL-680: pure decision/transform logic backing the specifier's
// consolidation authority - N intakes merged into one ticket, or one intake
// split into N tickets. The specifier itself (an LLM following
// specifier.prompt) performs the real reads/writes against
// `backlog/paused/` and `.swarmforge/operator/`; this module carries no I/O
// at all. It exists so the two traceability invariants BL-680 declares -
// no consolidation drops a human sentence, and the intake-to-ticket mapping
// is total in both directions - have a pure, testable surface to encode as
// property tests against, rather than staying prose-only.

export type SourceIntake = {
  intakeId: string;
  // Verbatim-quoted operator directives found in this intake.
  directives: string[];
};

export type MergedTicket = {
  sourceIntakeIds: string[];
  // Union of every source's directives, verbatim, first-seen order, deduped.
  directives: string[];
};

// Invariant 1 (BL-680): "No consolidation drops a human sentence" - every
// operator directive quoted in a source intake appears verbatim in at least
// one resulting ticket. mergeIntakes is the N:1 case, so the one resulting
// ticket must carry the union of every source's directives.
export function mergeIntakes(sources: SourceIntake[]): MergedTicket {
  if (sources.length < 2) {
    throw new Error('mergeIntakes requires at least two source intakes');
  }
  const directives: string[] = [];
  const seen = new Set<string>();
  for (const source of sources) {
    for (const directive of source.directives) {
      if (!seen.has(directive)) {
        seen.add(directive);
        directives.push(directive);
      }
    }
  }
  return { sourceIntakeIds: sources.map((s) => s.intakeId), directives };
}

export type SplitPart = {
  ticketId: string;
  // The separable piece of the source intake this ticket covers.
  mechanism: string;
};

export type SplitResultPart = SplitPart & {
  // Invariant 1 (BL-680), split side: every directive from the source
  // intake, broadcast onto every resulting ticket. A directive shared across
  // mechanisms (e.g. "notify the operator before cutover") can't be safely
  // assigned to just one sub-ticket, so splitIntake carries the full source
  // list on each part rather than guessing an owner - that keeps "appears
  // verbatim in at least one resulting ticket" true no matter which part an
  // auditor reads.
  directives: string[];
  // Invariant 3 (BL-680), split side: the back-reference to the source
  // intake, recorded on EACH resulting ticket independently - not only
  // recoverable by reading the wrapping SplitResult. Mirrors MergedTicket's
  // ticket-names-its-sources direction for the 1:N case.
  sourceIntakeId: string;
};

export type SplitResult = {
  sourceIntakeId: string;
  parts: SplitResultPart[];
};

// Invariant 3 (BL-680): "the intake-to-ticket mapping is total in both
// directions" - every mechanism the source intake proposed is named in
// EXACTLY one resulting ticket, the archived intake (sourceIntakeId) points
// at every resulting ticket id via `parts`, and (see SplitResultPart above)
// every resulting ticket names the intake it came from on its own.
export function splitIntake(sourceIntakeId: string, directives: string[], parts: SplitPart[]): SplitResult {
  if (parts.length < 2) {
    throw new Error('splitIntake requires at least two resulting tickets');
  }
  const mechanisms = parts.map((p) => p.mechanism);
  if (new Set(mechanisms).size !== mechanisms.length) {
    throw new Error('splitIntake requires each mechanism to be named in exactly one resulting ticket');
  }
  const ticketIds = parts.map((p) => p.ticketId);
  if (new Set(ticketIds).size !== ticketIds.length) {
    throw new Error('splitIntake requires distinct resulting ticket ids');
  }
  return {
    sourceIntakeId,
    parts: parts.map((p) => ({ ...p, directives: directives.slice(), sourceIntakeId })),
  };
}

// Invariant 2 (BL-680): "Consolidation reads and writes spec-time artifacts
// only ... No ticket in backlog/active/ is ever modified by a consolidation
// pass." Allowlist, not a bare active/ exclusion: epic trackers live under
// `backlog/paused/` alongside ordinary paused tickets (see BL-541), so both
// count as spec-time artifacts; everything else - active, done, hold, or
// unrecognized - does not.
export function isConsolidationTarget(relativePath: string): boolean {
  return relativePath.startsWith('backlog/paused/') || relativePath.startsWith('.swarmforge/operator/INTAKE-');
}
