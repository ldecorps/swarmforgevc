#!/usr/bin/env node
/**
 * BL-1082: operator-facing named-model pull/serve tooling.
 *
 * Composes (and optionally executes) Ollama pull/serve plans for an
 * operator-named model id. Model identity is always a parameter — the next
 * model is a different id, never a second adapter. Weights land under
 * ~/.swarmforge/models/ollama (or --store), outside the tracked worktree.
 *
 *   node out/tools/named-model.js pull <model-id>
 *   node out/tools/named-model.js serve <model-id>
 *   node out/tools/named-model.js status
 *
 * main() is a thin wrapper over exported helpers (engineering.prompt).
 * Parse/run modules are split for CRAP and mutation-site tractability.
 */

import { execSync } from 'child_process';
import { parseNamedModelArgs } from './namedModelCliArgs';
import { runNamedModelCli } from './namedModelCliRun';

export type { NamedModelCommand, NamedModelCliArgs } from './namedModelCliArgs';
export type { NamedModelCliDeps } from './namedModelCliRun';
export { parseNamedModelArgs, usageText } from './namedModelCliArgs';
export { formatPullPlan, formatServePlan, runNamedModelCli } from './namedModelCliRun';

export function main(argv: string[] = process.argv.slice(2)): number {
  try {
    return runNamedModelCli(parseNamedModelArgs(argv), {
      execCommand: (command) => {
        execSync(command, { stdio: 'inherit', shell: '/bin/bash' });
      },
    });
  } catch (err) {
    process.stderr.write(`${String((err as Error)?.message || err)}\n`);
    return 1;
  }
}

if (require.main === module) {
  process.exitCode = main();
}
