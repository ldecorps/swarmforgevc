#!/usr/bin/env node
/**
 * BL-1147: read-only probe for legacy topic adoption paths (BL-294 auto-open
 * context, cursor Host re-adopt, front-desk map scrub candidates).
 *
 * Usage: node probe-legacy-topic-adoption.js <target-repo-path>
 * Exit 0 when the target is readable; non-zero only on missing/unreadable target.
 */
import {
  assertReadableTargetPath,
  formatProbeReport,
  probeLegacyTopicAdoption,
} from './probeLegacyTopicAdoption';
import { makeArgsGuardedMain, runCliMain } from './swarm-metrics';

export function parseArgs(argv: string[]): { targetPath: string } | null {
  const [targetPath] = argv;
  return targetPath ? { targetPath } : null;
}

export const main = makeArgsGuardedMain(
  parseArgs,
  'Usage: node probe-legacy-topic-adoption.js <target-repo-path>\n',
  async ({ targetPath }) => {
    assertReadableTargetPath(targetPath);
    const report = probeLegacyTopicAdoption(targetPath);
    for (const line of formatProbeReport(report)) {
      process.stdout.write(`${line}\n`);
    }
  }
);

if (require.main === module) {
  runCliMain(main);
}
