/**
 * BL-1015 — shared types and declared constants for the Boy Scout run. Split
 * out of the single `boyScoutRun.ts` (BL-485 mutation-site size, 517 sites
 * over the 100-site threshold) along the same policy/IO seam BL-1014's
 * `boyScoutScan.ts` split used. No behavior lives here — only the shapes the
 * other modules agree on and the constants they were declared against.
 */

import * as path from 'path';

import type { DebtItem, ScanResult } from '../boyScoutScan';

// ── the declared envelope ─────────────────────────────────────────────────

export interface Envelope {
  files: number;
  lines: number;
}

/** Derived from BL-634's recorded 65-insertion median, not chosen by taste. */
export const SIZE_ENVELOPE: Envelope = { files: 3, lines: 120 };

export type EnvelopeDimension = 'files' | 'lines';

// ── a proposed cleanup ────────────────────────────────────────────────────

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

// ── the repository's existing gate set ────────────────────────────────────

export interface GateCommand {
  name: string;
  command: string;
  args: string[];
  /** Repo-relative directory the repository already runs this gate from. */
  cwd: string;
}

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

// ── the run's outcome ─────────────────────────────────────────────────────

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
