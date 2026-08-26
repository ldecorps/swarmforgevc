#!/usr/bin/env node
/**
 * BL-588: batch recovery tooling for approach 3 — clean siblings re-forward
 * unchanged; defective tickets rework from the last clean ancestor; QA lands
 * verified whole trees only.
 */
import { dispatchBatchRecoveryCommand } from './batchRecoveryCommands';
import { parseArgs } from './batchRecoveryArgs';
import { resolveCliMainWorktreeContext, runCliMain } from './swarm-metrics';

const USAGE = `Usage:
  batch-recovery.js prepare-re-forward --ticket <id> --defective-ticket <id>
  batch-recovery.js prepare-rework --ticket <id> --batch-commit <10-hex> --ancestor <10-hex>
  batch-recovery.js validate-land --operation <merge|cherry-pick|rebase-to-land|partial-subset cherry-pick> --verified-commit <10-hex>
  batch-recovery.js validate-merge-up --ticket <id> --verified-commit <10-hex> --landed-commit <10-hex>
  batch-recovery.js validate-land-isolation --landed-commit <10-hex> --defective-tip <10-hex>
`;

export { parseArgs } from './batchRecoveryArgs';

export async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (!args) {
    process.stderr.write(USAGE);
    process.exitCode = 2;
    return;
  }
  const { mainWorktreePath } = resolveCliMainWorktreeContext();
  dispatchBatchRecoveryCommand(mainWorktreePath, args);
}

if (require.main === module) {
  runCliMain(main);
}
