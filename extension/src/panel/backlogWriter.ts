import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { parseBacklogYaml } from './backlogReader';
import { atomicWrite } from '../util/atomicWrite';

const ASSIGNED_TO_LINE = /^assigned_to:\s*.+$/m;

function findMatchingBacklogFile(dir: string, itemId: string): string | null {
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.yaml'))) {
    const filePath = path.join(dir, file);
    try {
      const item = parseBacklogYaml(fs.readFileSync(filePath, 'utf8'));
      if (item && item.id === itemId) {
        return filePath;
      }
    } catch {
      continue;
    }
  }
  return null;
}

function findBacklogFilePathIn(targetPath: string, folder: 'active' | 'paused' | 'hold', itemId: string): string | null {
  const dir = path.join(targetPath, 'backlog', folder);
  try {
    return findMatchingBacklogFile(dir, itemId);
  } catch {
    return null;
  }
}

// Only the assigned_to field is writable from the panel (BL-034); every
// other line is left byte-identical, so this edits the field in place with
// a targeted regex rather than regenerating the file from parsed structure.
export function setAssignedTo(targetPath: string, itemId: string, assignedTo: string): boolean {
  const filePath = findBacklogFilePathIn(targetPath, 'active', itemId);
  if (!filePath) {
    return false;
  }
  const content = fs.readFileSync(filePath, 'utf8');
  if (!ASSIGNED_TO_LINE.test(content)) {
    return false;
  }
  atomicWrite(filePath, content.replace(ASSIGNED_TO_LINE, `assigned_to: ${assignedTo}`));
  return true;
}

export interface BacklogMoveResult {
  moved: boolean;
  destination?: string;
  /**
   * BL-1083: set when the promotion gates REFUSED, carrying the gate's own
   * words. Distinct from a plain `moved: false`, which still means "there was
   * nothing in paused/ to promote" - an operator told only "false" learns
   * nothing, and a refused promotion that looks like a no-op is the silent
   * failure invariant 2 forbids.
   */
  refusal?: { gate: string; reason: string };
}

// Shared by markDone and promoteToActive: both are a find-then-rename into
// a destination folder, differing only in how that folder is computed.
function moveBacklogFileTo(filePath: string, destDir: string): BacklogMoveResult {
  fs.mkdirSync(destDir, { recursive: true });
  const destination = path.join(destDir, path.basename(filePath));
  fs.renameSync(filePath, destination);
  return { moved: true, destination };
}

// Moves the file only - it never rewrites the status field. The done/
// folder is the authoritative signal (BL-033), matching readBacklog's own
// override of done-folder items regardless of their YAML status.
export function markDone(targetPath: string, itemId: string): BacklogMoveResult {
  const filePath = findBacklogFilePathIn(targetPath, 'active', itemId);
  if (!filePath) {
    return { moved: false };
  }
  const item = parseBacklogYaml(fs.readFileSync(filePath, 'utf8'));
  const destDir = item?.milestone
    ? path.join(targetPath, 'backlog', 'done', item.milestone)
    : path.join(targetPath, 'backlog', 'done');
  return moveBacklogFileTo(filePath, destDir);
}

/**
 * BL-1083: the shared promotion-gates chokepoint, reached through its one
 * shell-callable entry point.
 *
 * This module is TypeScript and the gate rules are Babashka; no import crosses
 * that boundary. So the verdict is TAKEN, never recomputed - restating "which
 * gates, in what order, against which cap" here would pass every test and
 * drift within weeks, which is the BL-897 shape this very ticket is a case of.
 * There is deliberately no knowledge here of depends_on, hold, human_approval
 * or the depth cap: this function knows only ALLOW, REFUSE and NOT_FOUND.
 */
function promotionGatesCliPath(targetPath: string): string {
  return path.join(targetPath, 'swarmforge', 'scripts', 'promotion_gates_cli.bb');
}

type GateVerdict =
  | { kind: 'allow' }
  | { kind: 'not-found' }
  | { kind: 'refuse'; gate: string; reason: string };

// The CLI's raw stdout, or a signal that it could not be reached at all
// (bb missing, the script crashing, any exit code other than the two the
// CLI documents as real verdicts). Split from consultPromotionGates so each
// half - "did we hear back" vs. "what did it say" - carries its own small
// complexity instead of one function carrying both.
type GateCliOutcome = { stdout: string } | { crashed: true };

function runGateCli(cli: string, targetPath: string, itemId: string): GateCliOutcome {
  try {
    return { stdout: execFileSync('bb', [cli, 'gate-promotion', targetPath, itemId], { encoding: 'utf8' }) };
  } catch (err) {
    const e = err as { status?: number; stdout?: string };
    // exit 1 = NOT_FOUND, exit 2 = REFUSE: both are real verdicts the CLI
    // prints on stdout before exiting non-zero. Anything else - bb absent,
    // the CLI missing, a crash - is NOT an allowance: a gate that fails open
    // is not a gate, and this one exists because a bypass promoted BL-1078
    // onto an unlanded dependency.
    if (e.status === 1 || e.status === 2) {
      return { stdout: typeof e.stdout === 'string' ? e.stdout : '' };
    }
    return { crashed: true };
  }
}

function parseGateVerdict(stdout: string, cli: string): GateVerdict {
  const line = stdout.split('\n').map((l) => l.trim()).filter(Boolean).pop() ?? '';
  if (line.startsWith('ALLOW')) {
    return { kind: 'allow' };
  }
  if (line === 'NOT_FOUND') {
    return { kind: 'not-found' };
  }
  if (line.startsWith('REFUSE|')) {
    const [, gate, ...reason] = line.split('|');
    return { kind: 'refuse', gate, reason: reason.join('|') };
  }
  return {
    kind: 'refuse',
    gate: 'promotion_gates',
    reason: `unrecognised verdict from ${path.basename(cli)}: ${line || '(no output)'}`,
  };
}

function consultPromotionGates(targetPath: string, itemId: string): GateVerdict {
  const cli = promotionGatesCliPath(targetPath);
  // Named explicitly rather than discovered by a failed exec: "the gate CLI is
  // not here" and "the gate refused" are different facts, and an operator
  // shown the second when the first is true would go looking for a dependency
  // that is not the problem.
  if (!fs.existsSync(cli)) {
    return {
      kind: 'refuse',
      gate: 'promotion_gates',
      reason: `the promotion gates could not be consulted (${cli} is missing); refusing rather than promoting ungated`,
    };
  }
  const outcome = runGateCli(cli, targetPath, itemId);
  if ('crashed' in outcome) {
    return {
      kind: 'refuse',
      gate: 'promotion_gates',
      reason: `the promotion gates could not be consulted (${cli}); refusing rather than promoting ungated`,
    };
  }
  return parseGateVerdict(outcome.stdout, cli);
}

// BL-490: the Expedite verb's promote step - no paused->active mover existed
// before this (the only prior mover was markDone's active->done above;
// promotion was otherwise the coordinator's exclusive manual duty).
// backlog/active/ is flat (unlike backlog/done/, never split by milestone), so
// the destination is always a plain rename into that directory. An item that
// is not a promotion candidate - it does not exist, or is already active - is
// reported as moved: false rather than an error, so the Expedite effect can
// call this unconditionally and skip promotion for an already-active ticket
// (BL-490 acceptance scenario 05) with no separate check.
//
// BL-1083: it consults the gates FIRST, and the check lives HERE rather than
// in either caller. Both live callers - the Telegram Expedite verb and the
// paused-pager endpoint, whose own comment called the semantics
// "force-promote" - walked straight past depends_on, hold and the depth cap,
// and on 2026-08-22 promoted BL-1078, BL-1079, BL-1080 and BL-1081 in one
// pass; BL-1078 declared depends_on: [BL-713] with BL-713 still active. A
// check placed in one caller would have left the other, and every future one,
// ungated - which is this defect exactly, with one caller fewer.
export function promoteToActive(targetPath: string, itemId: string): BacklogMoveResult {
  const verdict = consultPromotionGates(targetPath, itemId);
  if (verdict.kind === 'not-found') {
    return { moved: false };
  }
  if (verdict.kind === 'refuse') {
    // The ticket stays exactly where it was, and the caller gets the gate's
    // own words to show the operator (invariant 2: never a silent no-op).
    return { moved: false, refusal: { gate: verdict.gate, reason: verdict.reason } };
  }
  const filePath = findBacklogFilePathIn(targetPath, 'paused', itemId);
  if (!filePath) {
    return { moved: false };
  }
  const destDir = path.join(targetPath, 'backlog', 'active');
  return moveBacklogFileTo(filePath, destDir);
}

/** BL-698: park a live ticket into backlog/hold/ (active preferred, else paused). */
export function parkToHold(targetPath: string, itemId: string): BacklogMoveResult {
  const filePath =
    findBacklogFilePathIn(targetPath, 'active', itemId) ??
    findBacklogFilePathIn(targetPath, 'paused', itemId);
  if (!filePath) {
    return { moved: false };
  }
  const destDir = path.join(targetPath, 'backlog', 'hold');
  return moveBacklogFileTo(filePath, destDir);
}

/** BL-698: reinstate from backlog/hold/ back to paused. */
export function reinstateFromHold(targetPath: string, itemId: string): BacklogMoveResult {
  const filePath = findBacklogFilePathIn(targetPath, 'hold', itemId);
  if (!filePath) {
    return { moved: false };
  }
  const destDir = path.join(targetPath, 'backlog', 'paused');
  return moveBacklogFileTo(filePath, destDir);
}

// BL-490-VIOLATION: locates a ticket's CURRENT file regardless of which live
// folder it sits in - active checked first (the common case, and where a
// just-promoted ticket now lives), paused second, hold third (BL-672: a
// human-held item is still a legal write target for the make-top-priority
// verb). Exists so a caller that just wrote/moved a ticket (e.g. the
// Expedite verb's durable-commit step) can resolve the right repo-relative
// path to commit without duplicating findBacklogFilePathIn's own scan logic.
export function findBacklogFilePath(targetPath: string, itemId: string): string | null {
  return (
    findBacklogFilePathIn(targetPath, 'active', itemId) ??
    findBacklogFilePathIn(targetPath, 'paused', itemId) ??
    findBacklogFilePathIn(targetPath, 'hold', itemId)
  );
}
