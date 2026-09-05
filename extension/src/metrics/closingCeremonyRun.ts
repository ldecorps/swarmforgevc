// BL-820: the closing-ceremony orchestrator - what "the shift-close path
// reaches its lean step" actually runs. Composed from already-shipping
// pieces (leanLedgerStore.ts's ledger, closingCeremony.ts's pure fold),
// never a second ledger. `sendNote` is an injected side-effect seam
// (coder.prompt / engineering.prompt: "inject side effects, not
// *_FORCE_RESULT env bypasses") so this function is fully unit-testable
// without shelling to the real swarm_handoff.sh - the CLI wrapper
// (tools/closing-ceremony-run.ts) supplies the real one.
import * as fs from 'fs';
import * as path from 'path';
import { readLeanLedgerEvents } from './leanLedgerStore';
import { readPersistedRitualLedger } from './ritualLedgerProducer';
import { determinismCandidatesFromLedger } from './ritualLedger';
import { readCeremonyRun, writeCeremonyRun, findOpenCeremonyRunsBefore, finalizeCeremonyRunAsFailed, ceremonyRunFilePath } from './closingCeremonyStore';
import {
  CeremonyRun,
  buildClosingCeremonyPacket,
  isEmptyCeremonyPacket,
  buildClosingCeremonyNoteDraft,
  buildCeremonyFailureNoteDraft,
  parseWindowModelsFromConf,
} from '../quality/closingCeremony';
import { parseSwarmIdentityConfPath } from '../util/swarmforgeConfig';

export interface ClosingCeremonyRunDeps {
  sendNote: (targetPath: string, draft: string) => void;
  /**
   * BL-1365: the open-ticket texts that suppress a candidate (invariant 2).
   * Injected so a test can state "this class is already ticketed" without
   * writing backlog files.
   */
  readOpenTicketTexts?: (targetPath: string) => string[];
  /** BL-1119: role → window --model from effective pack conf (injectable). */
  readWindowModels?: (targetPath: string) => Record<string, string>;
}

export type ClosingCeremonyRunStatus = 'created' | 'already_exists' | 'auto_no_change';

export interface ClosingCeremonyRunResult {
  shiftKey: string;
  status: ClosingCeremonyRunStatus;
  run: CeremonyRun;
  finalizedFailed: string[];
}

function readPackConfText(targetPath: string): string | null {
  try {
    const identityPath = path.join(targetPath, '.swarmforge', 'swarm-identity');
    const persisted = parseSwarmIdentityConfPath(fs.readFileSync(identityPath, 'utf8'));
    if (persisted) {
      const confPath = path.isAbsolute(persisted) ? persisted : path.join(targetPath, persisted);
      return fs.readFileSync(confPath, 'utf8');
    }
  } catch {
    // fall through
  }
  try {
    return fs.readFileSync(path.join(targetPath, 'swarmforge', 'swarmforge.conf'), 'utf8');
  } catch {
    return null;
  }
}

/**
 * BL-1365 default loader: every open ticket's raw text. `active/` and
 * `paused/` only - a ticket in `done/` is finished work and must not go on
 * suppressing its class forever, and `hold/` is a human's parking space, not
 * a commitment to do the work.
 */
export function readOpenTicketTextsFromTarget(targetPath: string): string[] {
  const texts: string[] = [];
  for (const dir of ['active', 'paused']) {
    const dirPath = path.join(targetPath, 'backlog', dir);
    let names: string[];
    try {
      names = fs.readdirSync(dirPath);
    } catch {
      continue;
    }
    for (const name of names) {
      if (!name.endsWith('.yaml')) {
        continue;
      }
      try {
        texts.push(fs.readFileSync(path.join(dirPath, name), 'utf8'));
      } catch {
        // An unreadable ticket suppresses nothing. Failing open here is the
        // safe direction: the cost is one candidate the specifier has to
        // dismiss, against silently hiding a real one.
      }
    }
  }
  return texts;
}

/** Default loader: effective pack conf (swarm-identity path) or swarmforge.conf. */
export function readWindowModelsFromTarget(targetPath: string): Record<string, string> {
  const text = readPackConfText(targetPath);
  return text ? parseWindowModelsFromConf(text) : {};
}

// Human decision 5: "the packet reaches the specifier, not only the
// briefing" - this delivers a note addressed to `to`, never merely writes
// under docs/briefings/.
export function runClosingCeremony(targetPath: string, nowIso: string, deps: ClosingCeremonyRunDeps, to = 'specifier'): ClosingCeremonyRunResult {
  const shiftKey = nowIso.slice(0, 10);

  // "A silent ceremony is a failed ceremony" (human decision 4): before this
  // shift's own pass runs, finalize any earlier shift left pending - a
  // ceremony that produced nothing must never sit indistinguishable from
  // one that never ran (the ticket's own declared invariant).
  const finalizedFailed: string[] = [];
  for (const stale of findOpenCeremonyRunsBefore(targetPath, shiftKey)) {
    finalizeCeremonyRunAsFailed(targetPath, stale, nowIso);
    finalizedFailed.push(stale.shiftKey);
    deps.sendNote(targetPath, buildCeremonyFailureNoteDraft(to, stale.shiftKey));
  }

  const existing = readCeremonyRun(targetPath, shiftKey);
  if (existing) {
    return { shiftKey, status: 'already_exists', run: existing, finalizedFailed };
  }

  const allEvents = readLeanLedgerEvents(targetPath);
  const windowModels = (deps.readWindowModels ?? readWindowModelsFromTarget)(targetPath);

  // BL-1365 invariant 1: READ the ledger, never compute it here. The producer
  // accrues it on the daemon's own sweep, so a shift that closes no ceremony
  // delays this adjudication and loses no measurement - the next ceremony
  // still sees the earlier window's commits because they are still in the
  // store. Selection and suppression happen here, against the tickets open
  // NOW, so a ticket minted since the last sweep silences its class
  // immediately (invariant 2).
  const ledgerRecord = readPersistedRitualLedger(path.join(targetPath, '.swarmforge', 'telemetry'));
  const openTicketTexts = (deps.readOpenTicketTexts ?? readOpenTicketTextsFromTarget)(targetPath);
  const determinismCandidates = ledgerRecord
    ? determinismCandidatesFromLedger(ledgerRecord.ledger, openTicketTexts)
    : [];

  const packet = buildClosingCeremonyPacket(shiftKey, allEvents, windowModels, determinismCandidates);

  // Scenario "empty-shift-still-produces-an-explicit-no-change": nothing
  // happened this shift, so there is nothing for the specifier to evaluate -
  // the ceremony records the outcome itself rather than delivering an empty
  // packet and waiting on a human/agent turn that has nothing to react to.
  if (isEmptyCeremonyPacket(packet)) {
    const run: CeremonyRun = {
      shiftKey,
      packet,
      deliveredAt: nowIso,
      outcome: { type: 'no_change', ref: null, recordedAt: nowIso },
      adjustments: [],
      failedAt: null,
    };
    writeCeremonyRun(targetPath, run);
    return { shiftKey, status: 'auto_no_change', run, finalizedFailed };
  }

  const run: CeremonyRun = { shiftKey, packet, deliveredAt: nowIso, outcome: null, adjustments: [], failedAt: null };
  writeCeremonyRun(targetPath, run);
  const packetRelPath = path.relative(targetPath, ceremonyRunFilePath(targetPath, shiftKey));
  deps.sendNote(targetPath, buildClosingCeremonyNoteDraft(to, packetRelPath));
  return { shiftKey, status: 'created', run, finalizedFailed };
}
