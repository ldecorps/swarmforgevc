/**
 * BL-1015 — Boy Scout slice 2: the ACTING half. It takes the top-ranked item
 * from BL-1014's scan, cleans exactly that one inside a declared size
 * envelope, and stops. Anything bigger is refused whole rather than
 * half-applied.
 *
 * Why it consumes BL-1014's ranking rather than deriving one of its own: a
 * second, private ranking would drift from the one the operator was shown, so
 * the two halves would disagree about what "the most annoying debt" is. The
 * run reaches the scan module by name (`./boyScoutScan`) and never ranks.
 *
 * The envelope (3 files, 120 changed lines) is DERIVED, not invented: BL-634
 * recorded a 65-insertion median for a normal slice, and a Boy Scout cleanup
 * should be smaller than a normal slice, not larger. Roughly twice that median
 * is generous enough for a real refactor and small enough to stay one sitting.
 *
 * Three invariants govern everything below, and the order of the checks in
 * `boyScoutRun` is how two of them are made true by construction:
 *
 *   1. BOUNDED AND VERIFIED. At most ONE item, never over the envelope, and
 *      committed only after the repository's existing gate set passes on the
 *      cleaned result. Both the envelope check and the assertion guard run
 *      BEFORE the first write, so an oversized or unsafe cleanup is refused
 *      with the working tree untouched — never partially applied. A gate
 *      failure restores the tree from a snapshot taken at apply time.
 *   2. TESTS ARE NOT THE THING BEING CLEANED. A cleanup whose only route to
 *      green edits an existing test assertion is a behaviour change wearing a
 *      refactor's clothes. The guard is deliberately conservative: every
 *      assertion line present in a test file before must still be present
 *      after, verbatim, as a multiset. Adding new assertions is fine;
 *      reformatting around them is fine; changing one is not.
 *   3. NEVER SILENTLY EMPTY. Every run that cleans nothing carries a reason
 *      from `NO_CLEAN_REASONS`. A quiet no-op is indistinguishable from a
 *      clean repository, and that ambiguity is the failure to prevent.
 *
 * Scope boundary: this ticket adds no gate and weakens none. `runGates` runs
 * the repository's EXISTING commands, declared once in `DEFAULT_GATE_COMMANDS`.
 *
 * Note for a later split. This module measures 517 mutation sites against
 * BL-485's 100-site starting threshold, so the cleaner may well split it the
 * way it split BL-1014's `boyScoutScan.ts` (7 modules, 8274108c3d). Two things
 * that split has to preserve, both learned from that one:
 *   - `boyScoutRun.ts` stays the entry file and keeps importing
 *     `./boyScoutScan` BY NAME. A second, private ranking is the failure this
 *     import exists to prevent, and BL-1015's `required_wiring` entry 1 pins
 *     that import to this path.
 *   - `required_wiring` resolves a LITERAL file path against the sender's
 *     checkout, so moving this file breaks an entry that was correct when
 *     written. BL-1014 hit exactly that: the fix is a spec-gap `note` to the
 *     specifier re-pointing the entry, not a bounce and not a silent edit.
 */

import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

import { scan, normalizeSubject } from './boyScoutScan';
import type { DebtItem, ScanResult } from './boyScoutScan';

// ── the declared envelope ─────────────────────────────────────────────────

export interface Envelope {
  files: number;
  lines: number;
}

/** Derived from BL-634's recorded 65-insertion median, not chosen by taste. */
export const SIZE_ENVELOPE: Envelope = { files: 3, lines: 120 };

export type EnvelopeDimension = 'files' | 'lines';

/**
 * Every dimension that blew, not just the first — a report naming only "too
 * many files" for a cleanup that is also four times too long would send the
 * reader off to fix the wrong half.
 *
 * The limit is INCLUSIVE: exactly 3 files and exactly 120 lines is inside the
 * envelope (feature scenario 02 pins that boundary from both sides).
 */
export function exceedsEnvelope(measured: Envelope, envelope: Envelope): EnvelopeDimension[] {
  const over: EnvelopeDimension[] = [];
  if (measured.files > envelope.files) over.push('files');
  if (measured.lines > envelope.lines) over.push('lines');
  return over;
}

// ── measuring a proposal ──────────────────────────────────────────────────

export interface FileEdit {
  /** Repo-relative path. */
  path: string;
  /** The file's whole new content, or null to delete it. */
  after: string | null;
}

export interface CleanupProposal {
  /** Must be the top-ranked item; anything else is refused. */
  subject: string;
  summary: string;
  edits: FileEdit[];
}

/** Current content of a repo-relative path, or null when it does not exist. */
export type CurrentContent = (relPath: string) => string | null;

/**
 * Above this many diff cells the LCS is skipped and an upper bound returned
 * instead. Reached only after common prefix and suffix are trimmed, so it
 * takes a genuine whole-file rewrite — which is over the envelope on any
 * measure, so the verdict is the same either way.
 */
const LCS_CELL_CAP = 4_000_000;

function splitLines(text: string): string[] {
  return text.split('\n');
}

function lcsLength(a: string[], b: string[]): number {
  let prev = new Array<number>(b.length + 1).fill(0);
  let curr = new Array<number>(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      curr[j] = a[i - 1] === b[j - 1] ? prev[j - 1] + 1 : Math.max(prev[j], curr[j - 1]);
    }
    const swap = prev;
    prev = curr;
    curr = swap;
    curr.fill(0);
  }
  return prev[b.length];
}

/**
 * Added plus removed lines, the way `git diff --numstat` counts them.
 *
 * Measuring by FILE SIZE instead would refuse every large file on sight, and
 * large files (the CRAP-heavy ones) are exactly what this run exists to clean
 * — that would make the envelope a ban rather than a bound. So common prefix
 * and suffix are trimmed first and only the genuinely differing middle is
 * diffed, which also keeps a small edit inside a 3000-line file cheap.
 */
export function countChangedLines(before: string | null, after: string | null): number {
  if (before === null && after === null) return 0;
  const a = before === null ? [] : splitLines(before);
  const b = after === null ? [] : splitLines(after);

  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }
  const ra = a.slice(start, endA);
  const rb = b.slice(start, endB);
  if (ra.length === 0) return rb.length;
  if (rb.length === 0) return ra.length;
  if (ra.length * rb.length > LCS_CELL_CAP) return ra.length + rb.length;
  const common = lcsLength(ra, rb);
  return ra.length - common + (rb.length - common);
}

/**
 * One edit per path, last one winning. A proposal that names the same file
 * twice describes ONE changed file, and counting it twice would refuse a
 * cleanup that git would call well inside the envelope.
 */
export function normalizeEdits(edits: FileEdit[]): FileEdit[] {
  const byPath = new Map<string, FileEdit>();
  for (const edit of edits) byPath.set(edit.path, edit);
  return [...byPath.values()];
}

/**
 * The size the repository would actually record. An edit that changes nothing
 * is not a changed file — including it would let a proposal pad its file count
 * with no-ops, or report "cleaned" for a run that changed nothing.
 */
export function measureProposal(edits: FileEdit[], currentOf: CurrentContent): Envelope {
  let files = 0;
  let lines = 0;
  for (const edit of normalizeEdits(edits)) {
    const changed = countChangedLines(currentOf(edit.path), edit.after);
    if (changed === 0) continue;
    files += 1;
    lines += changed;
  }
  return { files, lines };
}

// ── invariant 2: tests are not the thing being cleaned ────────────────────

/**
 * Every test lane this repository actually has. Declared rather than inferred:
 * a guard that guessed would be exactly as trustworthy as no guard at all.
 */
export const TEST_PATH_PATTERNS: readonly RegExp[] = [
  /(^|\/)tests?\//,
  /\.test\.(js|mjs|cjs|ts)$/,
  /(^|\/)test_[^/]*\.(sh|bb)$/,
  /_test(_runner)?\.bb$/,
  /_property_runner\.bb$/,
  /(^|\/)specs\/(features|pipeline)\//,
];

export function isTestPath(relPath: string): boolean {
  return TEST_PATH_PATTERNS.some((re) => re.test(relPath));
}

/**
 * What an assertion looks like in each language this repository tests in:
 * node:assert and Vitest in `extension/`, `assert-true`/`is` in Babashka, and
 * `assert_*` shell helpers in `swarmforge/scripts/test/`.
 */
export const ASSERTION_PATTERNS: readonly RegExp[] = [
  /\bassert[-_.\w]*\s*\(/, // assert.equal(...), assert(...), (assert-true ...)
  /^\s*assert[-_\w]*\s+\S/, // assert_elements "a" "b" — the shell command form
  /\bexpect\s*\(/, // expect(x).toBe(1) — Vitest's own matcher form
  /\(\s*is\s+/, // (is (= 1 1)) — clojure.test
];

/** Trimmed assertion lines, in order, duplicates kept — the comparison is a multiset. */
export function assertionLines(text: string): string[] {
  return splitLines(text)
    .map((line) => line.trim())
    .filter((line) => ASSERTION_PATTERNS.some((re) => re.test(line)));
}

/**
 * The offending edit, or null when every existing test assertion survives.
 *
 * Deliberately conservative in one direction: renaming a symbol that appears
 * inside an assertion trips this guard even though the assertion still asserts
 * the same thing. An autonomous editor that got that call wrong would be
 * rewriting the tests that were supposed to be checking it, so the guard errs
 * towards abandoning and saying the item needs its own ticket.
 */
export function assertionsWouldChange(edits: FileEdit[], currentOf: CurrentContent): FileEdit | null {
  for (const edit of normalizeEdits(edits)) {
    if (!isTestPath(edit.path)) continue;
    const before = currentOf(edit.path);
    if (before === null) continue; // a brand-new test file has nothing to preserve
    const had = assertionLines(before);
    if (had.length === 0) continue;

    const remaining = new Map<string, number>();
    for (const line of assertionLines(edit.after ?? '')) {
      remaining.set(line, (remaining.get(line) ?? 0) + 1);
    }
    for (const line of had) {
      const left = remaining.get(line) ?? 0;
      // A multiset, not a set: a test that asserted something twice and now
      // asserts it once HAS had an assertion removed.
      if (left === 0) return edit;
      remaining.set(line, left - 1);
    }
  }
  return null;
}

// ── the repository's existing gate set ────────────────────────────────────

export interface GateCommand {
  name: string;
  command: string;
  args: string[];
  /** Repo-relative directory the repository already runs this gate from. */
  cwd: string;
}

/**
 * The gate set is the repository's own, declared in ONE place. This ticket
 * adds no gate and weakens none — `npm test` in `extension/` is what every
 * role already runs before forwarding, and npm runs from `extension/`, never
 * the repo root (local-engineering.prompt).
 */
export const DEFAULT_GATE_COMMANDS: readonly GateCommand[] = [
  { name: 'unit', command: 'npm', args: ['test'], cwd: 'extension' },
];

export interface GateResult {
  passed: boolean;
  ran: string[];
  failed: string[];
  output?: string;
}

export interface SpawnOutcome {
  status: number | null;
  output?: string;
  error?: Error;
}

export type GateSpawn = (command: string, args: string[], cwd: string) => SpawnOutcome;

function defaultGateSpawn(command: string, args: string[], cwd: string): SpawnOutcome {
  const run = spawnSync(command, args, { cwd, encoding: 'utf8' });
  return {
    status: run.status,
    output: `${run.stdout ?? ''}${run.stderr ?? ''}`,
    error: run.error,
  };
}

/**
 * Runs the declared gates in order and stops at the first failure — the
 * cleanup is already abandoned at that point, and the remaining gates would
 * change neither the verdict nor what the report has to say.
 *
 * A gate that could not be SPAWNED at all fails. "The gate never ran" and "the
 * gate passed" are opposite facts, and collapsing them is how an autonomous
 * committer ends up committing unverified work.
 */
export function runDeclaredGates(
  root: string,
  commands: readonly GateCommand[] = DEFAULT_GATE_COMMANDS,
  spawn: GateSpawn = defaultGateSpawn
): GateResult {
  const ran: string[] = [];
  const failed: string[] = [];
  const output: string[] = [];
  for (const gate of commands) {
    ran.push(gate.name);
    const outcome = spawn(gate.command, gate.args, path.join(root, gate.cwd));
    if (outcome.output) output.push(outcome.output);
    if (outcome.status !== 0 || outcome.error) {
      failed.push(gate.name);
      if (outcome.error) output.push(String(outcome.error.message));
      break;
    }
  }
  return { passed: failed.length === 0, ran, failed, output: output.join('\n') };
}

// ── the run ───────────────────────────────────────────────────────────────

export type RunOutcome = 'cleaned' | 'refused' | 'abandoned' | 'nothing-to-do';

export type NoCleanReason =
  | 'nothing-ranked'
  | 'no-cleanup-proposed'
  | 'wrong-item'
  | 'envelope-exceeded'
  | 'assertion-would-change'
  | 'gate-failed';

/**
 * Invariant 3's declared set. The ticket names four of these; the other two —
 * `no-cleanup-proposed` and `wrong-item` — are states the ticket's four do not
 * cover, and reporting either of them as one of the four would be the silent
 * misattribution invariant 3 exists to forbid. Nothing here is ever reported
 * as a synonym for something else.
 */
export const NO_CLEAN_REASONS: readonly NoCleanReason[] = [
  'nothing-ranked',
  'no-cleanup-proposed',
  'wrong-item',
  'envelope-exceeded',
  'assertion-would-change',
  'gate-failed',
];

export interface RunResult {
  outcome: RunOutcome;
  /** Null if and only if `outcome` is 'cleaned'. */
  reason: NoCleanReason | null;
  /** The top-ranked item this run considered, or null when nothing ranked. */
  subject: string | null;
  summary: string | null;
  measured: Envelope;
  envelope: Envelope;
  exceeded: EnvelopeDimension[];
  editedPaths: string[];
  committed: boolean;
  gate: GateResult | null;
  /** How many items the scan ranked — 0 is the only silent-looking case. */
  ranked: number;
  /** Extra fact the reason needs to be checkable: the offending path, etc. */
  detail: string | null;
}

export interface RunEnvironment {
  scanRepository(root: string): ScanResult;
  /**
   * `readFile` is handed in rather than closed over so a caller who injects a
   * fake tree gets the proposer reading THAT tree. A default proposer that
   * reached the real disk behind an injected reader would propose against
   * files the caller never described.
   */
  propose(item: DebtItem, root: string, readFile: RunEnvironment['readFile']): CleanupProposal | null;
  readFile(root: string, relPath: string): string | null;
  /** `content === null` deletes the file. */
  writeFile(root: string, relPath: string, content: string | null): void;
  runGates(root: string): GateResult;
  /** `paths` is exactly what this run edited; nothing else may be committed. */
  commit(root: string, message: string, paths: string[]): void;
}

/** Where a proposer leaves the cleanup it wants this run to apply. */
export const PROPOSAL_PATH = path.join('.swarmforge', 'boy-scout', 'proposal.json');

/**
 * The default proposer reads a proposal a caller has already written. The run
 * deliberately does not GENERATE cleanups: it is the half that bounds and
 * verifies them, and a generator that invented its own edits would have no
 * bound on it at all. Whatever wrote the file — a person, an agent — still has
 * to get past the envelope, the assertion guard and the gate set below.
 *
 * A missing or malformed file is "no proposal", never a crash and never a
 * silent success.
 */
export function readProposalFile(root: string, readFile: RunEnvironment['readFile']): CleanupProposal | null {
  const raw = readFile(root, PROPOSAL_PATH);
  if (raw === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  const candidate = parsed as Partial<CleanupProposal>;
  if (!candidate || typeof candidate.subject !== 'string' || !Array.isArray(candidate.edits)) return null;
  const edits = candidate.edits.filter(
    (edit): edit is FileEdit =>
      !!edit && typeof edit.path === 'string' && (typeof edit.after === 'string' || edit.after === null)
  );
  return { subject: candidate.subject, summary: candidate.summary ?? candidate.subject, edits };
}

export const defaultEnvironment: RunEnvironment = {
  scanRepository: (root) => scan(root),
  propose: (_item, root, readFile) => readProposalFile(root, readFile),
  readFile: (root, relPath) => {
    const abs = path.join(root, relPath);
    try {
      return fs.readFileSync(abs, 'utf8');
    } catch {
      return null;
    }
  },
  writeFile: (root, relPath, content) => {
    const abs = path.join(root, relPath);
    if (content === null) {
      fs.rmSync(abs, { force: true });
      return;
    }
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
  },
  runGates: (root) => runDeclaredGates(root),
  commit: (root, message, paths) => commitEdits(root, message, paths),
};

/**
 * Commits EXACTLY the paths this run edited, and nothing else.
 *
 * `git add -A` would be shorter and is wrong twice over. It would sweep
 * whatever else happened to be dirty in the checkout into a commit whose
 * message claims it cleaned one debt item — the house rule that an approval
 * authorizes only its own ticket's work, breached by an autonomous committer
 * that nobody is watching. And the run's own proposal file lives under
 * `.swarmforge/`, so `-A` would commit the instruction alongside the result.
 *
 * `git commit -- <paths>` is a partial commit taken through a temporary index,
 * so unrelated content that was ALREADY staged stays staged and uncommitted
 * rather than riding along. The `git add` before it exists only so a path the
 * cleanup created is known to git at all; `commit -- <paths>` alone rejects an
 * untracked pathspec.
 *
 * A non-zero status from either is thrown, never swallowed: "the commit did
 * not happen" and "the cleanup was committed" are opposite facts, and
 * `boyScoutRun` restores the tree on a throw.
 */
export function commitEdits(
  root: string,
  message: string,
  paths: string[],
  spawn: GateSpawn = defaultGateSpawn
): void {
  if (paths.length === 0) {
    // Not "commit nothing": an empty pathspec is the state in which a caller
    // reaches for `-A` to recover, which is the thing this function exists to
    // make impossible.
    throw new Error('refusing to commit with no paths: a boy scout commit names the files it cleaned');
  }
  const add = spawn('git', ['add', '--', ...paths], root);
  if (add.status !== 0 || add.error) {
    throw new Error(`git add failed: ${add.error?.message ?? add.output ?? ''}`);
  }
  const commit = spawn('git', ['commit', '-m', message, '--', ...paths], root);
  if (commit.status !== 0 || commit.error) {
    throw new Error(`git commit failed: ${commit.error?.message ?? commit.output ?? ''}`);
  }
}

export function buildCommitMessage(result: {
  subject: string | null;
  summary: string | null;
  measured: Envelope;
  envelope: Envelope;
  gate: GateResult | null;
}): string {
  const gates = result.gate?.ran.join(', ') || 'none';
  return [
    `BL-1015 boy scout: ${result.summary ?? 'cleanup'}`,
    '',
    `Cleaned the top-ranked debt item from the Boy Scout scan: ${result.subject}.`,
    `Envelope: ${result.measured.files} file(s), ${result.measured.lines} line(s) ` +
      `of ${result.envelope.files}/${result.envelope.lines}.`,
    `Gates passed before commit: ${gates}.`,
  ].join('\n');
}

function blank(ranked: number): RunResult {
  return {
    outcome: 'nothing-to-do',
    reason: null,
    subject: null,
    summary: null,
    measured: { files: 0, lines: 0 },
    envelope: { ...SIZE_ENVELOPE },
    exceeded: [],
    editedPaths: [],
    committed: false,
    gate: null,
    ranked,
    detail: null,
  };
}

/**
 * The whole run. The ORDER of the checks is load-bearing, not stylistic:
 * everything that can refuse happens before the first write, so a refused or
 * abandoned cleanup leaves the working tree exactly as it found it
 * (invariant 1, "never partially applied").
 */
export function boyScoutRun(root: string, overrides: Partial<RunEnvironment> = {}): RunResult {
  const env: RunEnvironment = { ...defaultEnvironment, ...overrides };

  const { ranked } = env.scanRepository(root);
  if (ranked.length === 0) {
    return { ...blank(0), reason: 'nothing-ranked' };
  }

  const top = ranked[0];
  const base = { ...blank(ranked.length), subject: top.subject };
  const proposal = env.propose(top, root, env.readFile);
  if (!proposal || proposal.edits.length === 0) {
    return { ...base, reason: 'no-cleanup-proposed' };
  }

  const edits = normalizeEdits(proposal.edits);
  const withProposal = { ...base, summary: proposal.summary, editedPaths: edits.map((e) => e.path) };

  // Invariant 1, "at most ONE item": the run never touches anything other than
  // the top-ranked one, and a proposal that names something else is refused
  // rather than quietly re-pointed at the right item.
  if (normalizeSubject(proposal.subject) !== normalizeSubject(top.subject)) {
    return {
      ...withProposal,
      outcome: 'refused',
      reason: 'wrong-item',
      detail: `the proposal is for ${proposal.subject}, not the top-ranked ${top.subject}`,
    };
  }
  const others = new Set(ranked.slice(1).map((entry) => normalizeSubject(entry.subject)));
  const trespass = edits.filter((edit) => others.has(normalizeSubject(edit.path)));
  if (trespass.length > 0) {
    return {
      ...withProposal,
      outcome: 'refused',
      reason: 'wrong-item',
      detail: `the proposal would also edit other ranked item(s): ${trespass.map((e) => e.path).join(', ')}`,
    };
  }

  const currentOf: CurrentContent = (relPath) => env.readFile(root, relPath);
  const measured = measureProposal(edits, currentOf);
  if (measured.files === 0) {
    // Applying, gating and committing an empty diff would report "cleaned"
    // for a run that changed nothing — invariant 3's exact ambiguity.
    return { ...withProposal, reason: 'no-cleanup-proposed', detail: 'the proposal changes nothing' };
  }

  const exceeded = exceedsEnvelope(measured, SIZE_ENVELOPE);
  if (exceeded.length > 0) {
    return {
      ...withProposal,
      outcome: 'refused',
      reason: 'envelope-exceeded',
      measured,
      exceeded,
      detail: `the cleanup would change ${measured.files} file(s) and ${measured.lines} line(s)`,
    };
  }

  const offending = assertionsWouldChange(edits, currentOf);
  if (offending) {
    return {
      ...withProposal,
      outcome: 'abandoned',
      reason: 'assertion-would-change',
      measured,
      detail: offending.path,
    };
  }

  // From here on the tree is written to, so every exit restores it first.
  const snapshot = new Map<string, string | null>(edits.map((edit) => [edit.path, currentOf(edit.path)]));
  const restore = () => {
    for (const [relPath, content] of snapshot) env.writeFile(root, relPath, content);
  };

  let gate: GateResult;
  try {
    for (const edit of edits) env.writeFile(root, edit.path, edit.after);
    gate = env.runGates(root);
  } catch (err) {
    restore();
    throw err;
  }

  if (!gate.passed) {
    restore();
    return { ...withProposal, outcome: 'abandoned', reason: 'gate-failed', measured, gate };
  }

  const cleaned: RunResult = { ...withProposal, outcome: 'cleaned', reason: null, measured, gate };
  try {
    env.commit(root, buildCommitMessage(cleaned), cleaned.editedPaths);
  } catch (err) {
    restore();
    throw err;
  }
  return { ...cleaned, committed: true };
}

// ── the report a human reads before accepting the commit ──────────────────

export function renderRunReport(result: RunResult): string {
  const lines: string[] = ['BOY SCOUT RUN — one item, cleaned or refused whole', ''];

  lines.push(`items ranked: ${result.ranked}`);
  lines.push(`top-ranked item: ${result.subject ?? '(none)'}`);
  if (result.summary) lines.push(`proposed cleanup: ${result.summary}`);
  lines.push('');

  if (result.outcome === 'cleaned') {
    lines.push(`outcome: CLEANED — ${result.subject}`);
    lines.push(`  changed ${result.measured.files} file(s), ${result.measured.lines} line(s) ` +
      `within an envelope of ${result.envelope.files} file(s), ${result.envelope.lines} line(s)`);
    lines.push(`  gates passed before commit: ${result.gate?.ran.join(', ') || 'none'}`);
    lines.push(`  files: ${result.editedPaths.join(', ')}`);
    lines.push(`  committed: ${result.committed ? 'yes' : 'no'}`);
    return lines.join('\n') + '\n';
  }

  // Invariant 3: nothing below is ever reachable without a stated reason.
  const banner = result.outcome === 'refused' ? 'REFUSED' : result.outcome === 'abandoned' ? 'ABANDONED' : 'NOTHING CLEANED';
  lines.push(`outcome: ${banner} — ${result.reason}`);
  lines.push(`  ${explain(result)}`);
  if (result.exceeded.length > 0) {
    lines.push(
      `  the envelope is ${result.envelope.files} file(s) and ${result.envelope.lines} line(s); ` +
        `exceeded: ${result.exceeded.join(' and ')}`
    );
  }
  lines.push('  nothing was committed; the working tree is unchanged.');
  return lines.join('\n') + '\n';
}

function explain(result: RunResult): string {
  switch (result.reason) {
    case 'nothing-ranked':
      return 'the scan ranked no debt at all, so there was no top item to clean.';
    case 'no-cleanup-proposed':
      return `no cleanup was proposed for ${result.subject}${result.detail ? ` (${result.detail})` : ''}.`;
    case 'wrong-item':
      return `${result.detail}; a run cleans the top-ranked item or nothing.`;
    case 'envelope-exceeded':
      return `${result.detail}, which is bigger than one sitting.`;
    case 'assertion-would-change':
      return (
        `the cleanup could only reach green by changing an existing assertion in ${result.detail}. ` +
        'That is a behaviour change wearing a refactor\'s clothes, so it is abandoned: this item needs its own ticket.'
      );
    case 'gate-failed':
      return `the repository gate set failed on the cleaned result (failed: ${result.gate?.failed.join(', ') || 'unknown'}).`;
    default:
      // Unreachable by construction — every no-clean path above sets a reason.
      return 'no reason was recorded, which is itself a defect: a run must never be silently empty.';
  }
}

// ── CLI ───────────────────────────────────────────────────────────────────

/**
 * Thin wrapper over the exported helpers above: resolve a root, run, print.
 * Exit 0 whenever the run produced a RESULT — a refusal is a successful run
 * that reported a reason — and 1 only when the run could not complete at all.
 */
export function main(
  argv: string[] = process.argv.slice(2),
  cwd: string = process.cwd(),
  overrides: Partial<RunEnvironment> = {}
): number {
  const root = argv[0] ? path.resolve(cwd, argv[0]) : cwd;
  try {
    process.stdout.write(renderRunReport(boyScoutRun(root, overrides)));
    return 0;
  } catch (err) {
    process.stderr.write(`boy scout run failed: ${(err as Error).message}\n`);
    return 1;
  }
}

if (require.main === module) {
  process.exitCode = main();
}
