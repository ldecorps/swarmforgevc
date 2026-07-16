// BL-454: best-effort extraction of structured attribution out of the free-
// text backlog/evidence/*.md corpus, so the one-time backfill can seed the
// same qa_bounces log the go-forward writer appends to. The corpus predates
// this ticket and was hand-written by whichever role found the defect, so
// there is no single consistent format - this module tries a small,
// deliberately layered set of extraction strategies and falls back to
// rejecting the file (returning null) rather than guessing, matching the
// engineering article's "never a bare passthrough" posture: an
// unrecognized/ambiguous value must not be recorded as if it were real data.
import { isKnownFailureClass, isKnownProducingRole, QaBounceFailureClass, QaBounceProducingRole } from './qaBounce';

// The evidence corpus's own prose spells the hardener role the natural
// English way ("hardener") even though this codebase's worktree/role-prompt
// name carries a baked-in typo ("hardender" - swarmforge/roles/hardender.prompt,
// .worktrees/hardender/). Normalize the alias before validating against the
// closed set, rather than teaching the closed set two spellings.
const PRODUCING_ROLE_ALIASES: Record<string, string> = {
  hardener: 'hardender',
};

function normalizeProducingRole(candidate: string): string {
  const lower = candidate.toLowerCase();
  return PRODUCING_ROLE_ALIASES[lower] ?? lower;
}

export function parseTicketIdFromFilename(filename: string): string | null {
  const match = filename.match(/^bl-?(\d+)/i);
  return match ? `BL-${match[1]}` : null;
}

export function parseDateFromFilename(filename: string): string | null {
  const match = filename.match(/(\d{4})(\d{2})(\d{2})/);
  return match ? `${match[1]}-${match[2]}-${match[3]}` : null;
}

function extractFirstWord(line: string): string | null {
  const stripped = line.replace(/^[`*\s]+/, '');
  const match = stripped.match(/[a-z]+/i);
  return match ? match[0].toLowerCase() : null;
}

const FAILURE_CLASS_HEADING = /^#+\s*(?:\d+\.\s*)?failure\s*class\b/i;
const FAILURE_CLASS_INLINE = /\*\*failure\s*class:?\*\*:?\s*/i;
const HEADING_SCAN_WINDOW = 5;
const BOUNCE_TO_PATTERN = /bounces?(?:d)?\s*(?:back\s*)?to\s+(coder|cleaner|architect|hardener|hardender|documenter)/i;

// A "resolved" search step - split out of parseFailureClassFromEvidence below
// to keep that function's own branch count at or below the project's CRAP
// threshold (same "extract so branch count stays low" reasoning the front-desk
// bot files already apply throughout). `done: true` means the caller must
// return `value` immediately (a value found within the known set, OR a value
// found but rejected as unknown - either way, decisive); `done: false` means
// "nothing conclusive on this line, keep scanning."
interface FailureClassSearchStep {
  done: boolean;
  value: QaBounceFailureClass | null;
}

const NOT_FOUND: FailureClassSearchStep = { done: false, value: null };

function resolveCandidate(candidate: string | null): FailureClassSearchStep {
  if (!candidate) {
    return NOT_FOUND;
  }
  return { done: true, value: isKnownFailureClass(candidate) ? candidate : null };
}

// The inline shape: a bold label on the same line as the value ("4. **Failure
// class**: `compile`.").
function matchInlineFailureClass(line: string): FailureClassSearchStep {
  const inlineMatch = line.match(FAILURE_CLASS_INLINE);
  if (!inlineMatch || typeof inlineMatch.index !== 'number') {
    return NOT_FOUND;
  }
  return resolveCandidate(extractFirstWord(line.slice(inlineMatch.index + inlineMatch[0].length)));
}

// The heading shape: a heading ("## Failure class" / "## 4. Failure Class")
// followed within a few lines by the value (bare, backtick-quoted, or bold).
function matchHeadingFailureClass(lines: string[], headingIndex: number): FailureClassSearchStep {
  for (let j = headingIndex + 1; j < lines.length && j <= headingIndex + HEADING_SCAN_WINDOW; j++) {
    const step = resolveCandidate(extractFirstWord(lines[j]));
    if (step.done) {
      return step;
    }
  }
  return NOT_FOUND;
}

// Two shapes cover the corpus, tried per line via matchInlineFailureClass/
// matchHeadingFailureClass above. A value present but outside the closed set
// (e.g. a real file's own "scope" - not one of compile/unit/integration/
// acceptance/behavior) is treated as NOT FOUND, never recorded raw. A THIRD
// shape has no dedicated field at all: a design/correctness bounce whose only
// classification is an explicit "bounce(d) to <role>" verdict line - every
// real example of this shape found in the corpus is a correctness/design
// defect (never a compile error or a failing test), so it defaults to
// 'behavior', the SAME catch-all class every other file in the corpus
// already uses for "not a compile/unit/integration/acceptance failure."
export function parseFailureClassFromEvidence(content: string): QaBounceFailureClass | null {
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const inline = matchInlineFailureClass(lines[i]);
    if (inline.done) {
      return inline.value;
    }
    if (FAILURE_CLASS_HEADING.test(lines[i])) {
      const heading = matchHeadingFailureClass(lines, i);
      if (heading.done) {
        return heading.value;
      }
    }
  }
  return BOUNCE_TO_PATTERN.test(content) ? 'behavior' : null;
}

// A role named in a filename/heading (e.g. "BL-259-...-hardener.md", "(QA)",
// "(cleaner, 2026-07-10)") almost always names WHO WROTE the evidence - the
// role that was reviewing the parcel and found the defect - NOT who
// introduced it. Confirmed against the real corpus: BL-233's cleaner-
// authored file bounces a COMPILE ERROR the coder's own commit introduced;
// BL-259's hardener-suffixed file is the hardener's own coverage-gap finding
// in code it did not write. So the reporting role is only useful once
// mapped to the pipeline stage whose forwarded work it was reviewing - the
// stage immediately before it in the chain. QA is a special case: per this
// pipeline's own convention (constitution/handoff-protocol.md), a QA bounce
// is always routed back to the coder first, regardless of which stage
// actually introduced the defect.
const PRODUCING_ROLE_BEFORE_REPORTER: Record<string, string | null> = {
  qa: 'coder',
  documenter: 'hardender',
  hardener: 'architect',
  hardender: 'architect',
  architect: 'cleaner',
  cleaner: 'coder',
  coder: null,
};

const REPORTER_TOKEN_PATTERN = /\b(coder|cleaner|architect|hardener|hardender|documenter)\b|\bqa\d*\b/i;

function detectReporterRole(text: string): string | null {
  const match = text.match(REPORTER_TOKEN_PATTERN);
  if (!match) {
    return null;
  }
  const token = match[0].toLowerCase();
  return token.startsWith('qa') ? 'qa' : normalizeProducingRole(token);
}

// The most authoritative signal when present: an explicit "bounce(d) to
// <role>" verdict line names who must act on the defect directly, not who
// merely reported it, so it is used AS the producing role with no further
// mapping. Split out of parseProducingRoleFromEvidence below for the same
// CRAP-budget reason as the failure-class helpers above.
function explicitProducingRole(content: string): QaBounceProducingRole | null {
  const explicit = content.match(BOUNCE_TO_PATTERN);
  if (!explicit) {
    return null;
  }
  const normalized = normalizeProducingRole(explicit[1]);
  return isKnownProducingRole(normalized) ? normalized : null;
}

// Fallback signal: the reporting role named in the filename, or failing that
// the document's own first line/heading, mapped to the pipeline stage
// immediately before it via PRODUCING_ROLE_BEFORE_REPORTER above. A role
// mentioned only deep in prose (not the verdict, filename, or heading) is NOT
// trusted - too easy to pick up an unrelated mention (e.g. an
// ancestry/lineage list naming every role).
function inferredProducingRoleFromReporter(content: string, filename: string): QaBounceProducingRole | null {
  const firstLine = content.split('\n', 1)[0] ?? '';
  const reporter = detectReporterRole(filename) ?? detectReporterRole(firstLine);
  if (!reporter) {
    return null;
  }
  const produced = PRODUCING_ROLE_BEFORE_REPORTER[reporter];
  return produced && isKnownProducingRole(produced) ? produced : null;
}

export function parseProducingRoleFromEvidence(content: string, filename: string): QaBounceProducingRole | null {
  return explicitProducingRole(content) ?? inferredProducingRoleFromReporter(content, filename);
}

const COMMIT_HASH_PATTERN = /\b[0-9a-f]{10,40}\b/i;

// Best-effort only: the record shape carries `commit` for audit/traceability,
// but it is NOT part of the closed-set validation or the idempotency key -
// a file whose commit can't be confidently extracted still seeds a bounce
// record (with an empty commit) rather than being dropped over a field nobody
// aggregates on.
export function parseCommitFromEvidence(content: string): string {
  const match = content.match(COMMIT_HASH_PATTERN);
  return match ? match[0].slice(0, 10).toLowerCase() : '';
}

export interface ParsedBounceEvidence {
  ticket: string;
  producingRole: QaBounceProducingRole;
  failureClass: QaBounceFailureClass;
  commit: string;
  at: string;
}

// Returns null for a file that is not a genuine, attributable bounce record:
// no ticket id in the filename, no failure class found (or found but outside
// the closed set - e.g. the real corpus's own "-scope-gap-" findings), or no
// producing role found (or found but outside the closed set). This is the
// SAME gate that keeps a non-bounce evidence file (an audit, a postmortem, an
// "already-shipped" finding) from being counted as a bounce - it simply has
// none of these fields to find.
export function parseBounceEvidenceFile(filename: string, content: string): ParsedBounceEvidence | null {
  const ticket = parseTicketIdFromFilename(filename);
  if (!ticket) {
    return null;
  }
  const failureClass = parseFailureClassFromEvidence(content);
  if (!failureClass) {
    return null;
  }
  const producingRole = parseProducingRoleFromEvidence(content, filename);
  if (!producingRole) {
    return null;
  }
  const date = parseDateFromFilename(filename);
  const at = date ? `${date}T00:00:00.000Z` : new Date(0).toISOString();
  return { ticket, producingRole, failureClass, commit: parseCommitFromEvidence(content), at };
}
