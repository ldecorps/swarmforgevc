#!/usr/bin/env node
/**
 * BL-820: the closing-ceremony lean pass's driver. Invoked by finish-shift
 * (swarmforge/scripts/finish_shift_lib.sh's finish_shift_run_closing_ceremony)
 * before the shift fully winds down. Folds BL-819's lifecycle ledger into a
 * shift-scoped packet (extension/src/metrics/closingCeremonyRun.ts owns the
 * actual orchestration - this file is only the thin CLI wrapper: args in,
 * the real swarm_handoff.sh side effect injected, JSON out) and delivers it
 * to the specifier through the REAL handoff transport - never a direct
 * inbox/new write (constitution: "Send only via swarm_handoff.sh").
 *
 * Usage: node closing-ceremony-run.js [--target <path>] [--at <iso-timestamp>]
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync } from 'child_process';
import { printJsonToStdout, makeArgsGuardedMain, runCliMain, resolveTargetAndNow } from './swarm-metrics';
import { runClosingCeremony, ClosingCeremonyRunDeps } from '../metrics/closingCeremonyRun';
import { parseArgs, USAGE, ClosingCeremonyRunArgs } from './closingCeremonyRunArgs';

// Re-export for tests
export { parseArgs, ClosingCeremonyRunArgs };

// The one real side effect this CLI performs: hand the draft to the actual
// swarm_handoff.sh, exactly the pattern tracer-bullet-launcher.ts's own
// sendSeedNote already established for a script-originated note (never a
// live agent turn). finish-shift is always the coordinator's own bedtime
// verb (Article 1.1) regardless of which pane happens to invoke it, so the
// sender identity is fixed - never inherited from whatever SWARMFORGE_ROLE
// the ambient shell happens to carry (a live agent pane's own role, for
// instance), which would send as the wrong role or an unknown one.
export function sendNoteViaHandoff(targetPath: string, draft: string): void {
  const draftPath = path.join(os.tmpdir(), `closing-ceremony-note-${process.pid}-${Math.random().toString(36).slice(2)}.txt`);
  fs.writeFileSync(draftPath, draft, 'utf-8');
  const handoffScript = path.join(targetPath, 'swarmforge', 'scripts', 'swarm_handoff.sh');
  execFileSync(handoffScript, [draftPath], {
    cwd: targetPath,
    env: { ...process.env, SWARMFORGE_ROLE: 'coordinator' },
    stdio: 'pipe',
  });
}

export const REAL_DEPS: ClosingCeremonyRunDeps = { sendNote: sendNoteViaHandoff };

export const main = makeArgsGuardedMain(parseArgs, USAGE, async (args) => {
  const { targetPath, nowIso } = resolveTargetAndNow(args);
  const result = runClosingCeremony(targetPath, nowIso, REAL_DEPS);
  printJsonToStdout(result);
});

if (require.main === module) {
  runCliMain(main);
}
