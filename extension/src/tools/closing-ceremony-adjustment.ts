#!/usr/bin/env node
/**
 * BL-820: the coordinator's own closing-ceremony CLI - "the coordinator may
 * act within powers it already holds" (promotion order or throttle
 * posture) "and records that it did" (human decision 2). The adjustment is
 * recorded against the ceremony run, reversible from its own record alone
 * (a ticket id or a note pointer - human decision 7), never a silent edit.
 *
 * Usage: node closing-ceremony-adjustment.js --shift <yyyy-MM-dd>
 *   --kind <promotion_order|throttle_posture> --detail <text>
 *   --form <ticket|note> --ref <id> [--target <path>] [--at <iso-timestamp>]
 */
import { resolveProjectRoot, printJsonToStdout, makeArgsGuardedMain, runCliMain } from './swarm-metrics';
import { recordCeremonyAdjustment } from '../metrics/closingCeremonyStore';
import { parseArgs, USAGE, ClosingCeremonyAdjustmentArgs } from './closingCeremonyAdjustmentArgs';

export { parseArgs, ClosingCeremonyAdjustmentArgs };

export const main = makeArgsGuardedMain(parseArgs, USAGE, async (args) => {
  const targetPath = args.target ?? resolveProjectRoot(process.cwd());
  const nowIso = args.at ?? new Date().toISOString();
  const run = recordCeremonyAdjustment(targetPath, args.shift, {
    kind: args.kind,
    detail: args.detail,
    record: { form: args.form, ref: args.ref },
    recordedAt: nowIso,
  });
  printJsonToStdout({ shift: args.shift, run });
});

if (require.main === module) {
  runCliMain(main);
}
