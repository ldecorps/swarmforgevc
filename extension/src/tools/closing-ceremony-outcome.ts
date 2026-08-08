#!/usr/bin/env node
/**
 * BL-820: the specifier's own closing-ceremony CLI - "the specifier turns
 * the evidence into an outcome: a process ticket, a spec/gate tweak, or an
 * explicit 'no change'" (human decision 4). Records that outcome against
 * the shift's ceremony run, ending it in state "complete" - the opposite of
 * the silence this slice exists to prevent.
 *
 * Usage: node closing-ceremony-outcome.js --shift <yyyy-MM-dd>
 *   --outcome <process_ticket|spec_gate_tweak|no_change> [--ref <id>]
 *   [--target <path>] [--at <iso-timestamp>]
 */
import { resolveProjectRoot, printJsonToStdout, makeArgsGuardedMain, runCliMain } from './swarm-metrics';
import { recordCeremonyOutcome } from '../metrics/closingCeremonyStore';
import { parseArgs, USAGE, ClosingCeremonyOutcomeArgs } from './closingCeremonyOutcomeArgs';

export { parseArgs, ClosingCeremonyOutcomeArgs };

export const main = makeArgsGuardedMain(parseArgs, USAGE, async (args) => {
  const targetPath = args.target ?? resolveProjectRoot(process.cwd());
  const nowIso = args.at ?? new Date().toISOString();
  const run = recordCeremonyOutcome(targetPath, args.shift, {
    type: args.outcomeType,
    ref: args.ref ?? null,
    recordedAt: nowIso,
  });
  printJsonToStdout({ shift: args.shift, run });
});

if (require.main === module) {
  runCliMain(main);
}
