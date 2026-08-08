// BL-820: the closing-ceremony orchestrator - what "the shift-close path
// reaches its lean step" actually runs. Composed from already-shipping
// pieces (leanLedgerStore.ts's ledger, closingCeremony.ts's pure fold),
// never a second ledger. `sendNote` is an injected side-effect seam
// (coder.prompt / engineering.prompt: "inject side effects, not
// *_FORCE_RESULT env bypasses") so this function is fully unit-testable
// without shelling to the real swarm_handoff.sh - the CLI wrapper
// (tools/closing-ceremony-run.ts) supplies the real one.
import * as path from 'path';
import { readLeanLedgerEvents } from './leanLedgerStore';
import { readCeremonyRun, writeCeremonyRun, findOpenCeremonyRunsBefore, finalizeCeremonyRunAsFailed, ceremonyRunFilePath } from './closingCeremonyStore';
import { CeremonyRun, buildClosingCeremonyPacket, isEmptyCeremonyPacket, buildClosingCeremonyNoteDraft, buildCeremonyFailureNoteDraft } from '../quality/closingCeremony';

export interface ClosingCeremonyRunDeps {
  sendNote: (targetPath: string, draft: string) => void;
}

export type ClosingCeremonyRunStatus = 'created' | 'already_exists' | 'auto_no_change';

export interface ClosingCeremonyRunResult {
  shiftKey: string;
  status: ClosingCeremonyRunStatus;
  run: CeremonyRun;
  finalizedFailed: string[];
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
  const packet = buildClosingCeremonyPacket(shiftKey, allEvents);

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
