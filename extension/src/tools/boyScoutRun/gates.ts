/**
 * BL-1015 — the repository's existing gate set. Split out of
 * `boyScoutRun.ts` (BL-485 mutation-site size).
 */

import { spawnSync } from 'child_process';
import * as path from 'path';

import type { GateCommand, GateResult, GateSpawn, SpawnOutcome } from './types';

/**
 * The gate set is the repository's own, declared in ONE place. This ticket
 * adds no gate and weakens none — `npm test` in `extension/` is what every
 * role already runs before forwarding, and npm runs from `extension/`, never
 * the repo root (local-engineering.prompt).
 */
export const DEFAULT_GATE_COMMANDS: readonly GateCommand[] = [
  { name: 'unit', command: 'npm', args: ['test'], cwd: 'extension' },
];

export function defaultGateSpawn(command: string, args: string[], cwd: string): SpawnOutcome {
  const run = spawnSync(command, args, { cwd, encoding: 'utf8' });
  return {
    status: run.status,
    output: `${run.stdout ?? ''}${run.stderr ?? ''}`,
    error: run.error,
  };
}

/**
 * Runs the declared gates in order and stops at the first failure — the
 * cleanup is already abandoned at that point, and the remaining gates would
 * change neither the verdict nor what the report has to say.
 *
 * A gate that could not be SPAWNED at all fails. "The gate never ran" and "the
 * gate passed" are opposite facts, and collapsing them is how an autonomous
 * committer ends up committing unverified work.
 */
export function runDeclaredGates(
  root: string,
  commands: readonly GateCommand[] = DEFAULT_GATE_COMMANDS,
  spawn: GateSpawn = defaultGateSpawn
): GateResult {
  const ran: string[] = [];
  const failed: string[] = [];
  const output: string[] = [];
  for (const gate of commands) {
    ran.push(gate.name);
    const outcome = spawn(gate.command, gate.args, path.join(root, gate.cwd));
    if (outcome.output) output.push(outcome.output);
    if (outcome.status !== 0 || outcome.error) {
      failed.push(gate.name);
      if (outcome.error) output.push(String(outcome.error.message));
      break;
    }
  }
  return { passed: failed.length === 0, ran, failed, output: output.join('\n') };
}
