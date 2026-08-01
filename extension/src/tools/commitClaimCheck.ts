/**
 * BL-729: given one commit's message and that commit's own patch text,
 * report which claimed changes the patch does not support. Pure - no git,
 * no fs; extension/src/tools/pilot-acceptance-gate.ts resolves the real
 * commits and patch text and hands them here.
 *
 * Grammar (backlog ticket BL-729, "The fix" section - verb-scoped, measured
 * against 120 real commits before being chosen over the bare rule):
 * 1. Strip trailers (Co-authored-by:, Signed-off-by:, "By <role>.") and
 *    ticket ids (BL-###, GH-###) from the message.
 * 2. Split into sentences on '.' and newlines - never on a bare '!' or '?',
 *    since those characters also close a code-shaped identifier
 *    (`deliver!`) that a real sentence boundary must not sever.
 * 3. A sentence is judged only when it attaches a change verb (restore,
 *    fix, add, remove, delete, drop, rename, revert, correct, replace,
 *    extract, introduce, wire, close, and inflections) to code - "names in
 *    passing" sentences with no such verb are never checked.
 * 4. Within a judged sentence, collect code-shaped tokens: a backticked
 *    span; a lowercase identifier ending `!` or `?`; snake_case; camelCase;
 *    or a path/filename ending in a known source extension.
 * 5. A token absent from the patch text (added, removed and context lines,
 *    plus the diff's changed-path headers - all passed in as one string) is
 *    unsupported.
 */

export interface CommitClaim {
  identifier: string;
  sentence: string;
}

const TRAILER_LINE_RE = /^(Co-authored-by:|Signed-off-by:|By\s+[\w -]+\.)\s*/i;
const TICKET_ID_RE = /\b(?:BL|GH)-\d+\b/g;

const CHANGE_VERB_RE =
  /\b(restor(?:e|es|ed|ing)|fix(?:e[sd]|ing)?|add(?:s|ed|ing)?|remov(?:e|es|ed|ing)|delet(?:e|es|ed|ing)|drop(?:s|ped|ping)?|renam(?:e|es|ed|ing)|revert(?:s|ed|ing)?|correct(?:s|ed|ing)?|replac(?:e|es|ed|ing)|extract(?:s|ed|ing)?|introduc(?:e|es|ed|ing)|wir(?:e|es|ed|ing)|clos(?:e|es|ed|ing))\b/i;

const BACKTICK_RE = /`([^`]+)`/g;
const BANG_QUESTION_RE = /\b[a-z][a-zA-Z0-9_]*[!?]/g;
const SNAKE_CASE_RE = /\b[a-z][a-z0-9]*(?:_[a-z0-9]+)+\b/g;
const CAMEL_CASE_RE = /\b[a-z][a-z0-9]*(?:[A-Z][a-z0-9]*)+\b/g;
const SOURCE_PATH_RE =
  /\b[\w./-]*[\w-]\.(?:ts|tsx|js|jsx|mjs|cjs|py|go|rb|java|json|ya?ml|sh|feature|md)\b/g;

const TOKEN_PATTERNS = [BACKTICK_RE, BANG_QUESTION_RE, SNAKE_CASE_RE, CAMEL_CASE_RE, SOURCE_PATH_RE];

function stripTrailersAndTicketIds(message: string): string {
  const withoutTrailers = message
    .split('\n')
    .filter((line) => !TRAILER_LINE_RE.test(line.trim()))
    .join('\n');
  return withoutTrailers.replace(TICKET_ID_RE, '');
}

// Never '!'/'?': the token grammar above reserves those characters as
// identifier suffixes (`deliver!`), so treating them as sentence-enders
// would sever a claim from the verb that governs it. A '.' only ends a
// sentence when followed by whitespace or end-of-string - a bare '.'
// immediately followed by more identifier characters is a filename or
// method-call dot (`deadCode.ts`, `commitClaimCheck.ts's`), not a boundary.
// ';' does split (independent clauses joined by a semicolon should not let
// a verb in one leak a claim from the other - "Fix the leak; callers of
// runSweep are unaffected" must not treat "runSweep" as claimed).
function splitSentences(text: string): string[] {
  return text
    .split(/\n+|;+\s*|\.(?=\s|$)\s*/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

function collectCodeTokens(sentence: string): string[] {
  const tokens: string[] = [];
  const seen = new Set<string>();
  for (const pattern of TOKEN_PATTERNS) {
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(sentence))) {
      const token = pattern === BACKTICK_RE ? match[1] : match[0];
      if (token && !seen.has(token)) {
        seen.add(token);
        tokens.push(token);
      }
    }
  }
  return tokens;
}

export function findUnsupportedCommitClaims(message: string, patchText: string): CommitClaim[] {
  const cleanedMessage = stripTrailersAndTicketIds(message);
  const unsupported: CommitClaim[] = [];
  for (const sentence of splitSentences(cleanedMessage)) {
    if (!CHANGE_VERB_RE.test(sentence)) {
      continue;
    }
    for (const identifier of collectCodeTokens(sentence)) {
      if (!patchText.includes(identifier)) {
        unsupported.push({ identifier, sentence });
      }
    }
  }
  return unsupported;
}

export interface RunCommitForClaims {
  sha: string;
  message: string;
  patchText: string;
}

export interface UnsupportedRunCommitClaim {
  commit: string;
  identifier: string;
  sentence: string;
}

export interface CommitClaimsEvaluation {
  commitsChecked: number;
  unsupported?: UnsupportedRunCommitClaim;
}

// Walks EVERY commit in order (invariant 2: none skipped, sampled, or
// assumed clean) and stops at the first unsupported claim, so a refusal
// names the earliest offending commit (BL-729 scenario 02) rather than the
// last one found. `commitsChecked` always reports the full list length,
// even on a refusal, because every commit up to and including the refusing
// one was in fact examined - only later commits go unexamined, and only
// because the land is already refused.
export function evaluateCommitClaims(commits: RunCommitForClaims[]): CommitClaimsEvaluation {
  for (const commit of commits) {
    const unsupported = findUnsupportedCommitClaims(commit.message, commit.patchText);
    if (unsupported.length > 0) {
      return {
        commitsChecked: commits.length,
        unsupported: { commit: commit.sha, identifier: unsupported[0].identifier, sentence: unsupported[0].sentence },
      };
    }
  }
  return { commitsChecked: commits.length };
}
