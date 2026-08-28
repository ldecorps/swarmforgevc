#!/usr/bin/env node
/**
 * BL-1201 architect bounce D2 / QA bounce D1: the sole entry point a role
 * should ever use to act on an "answer ready: node
 * extension/out/tools/deliver-role-answer.js --role <role>" note - never
 * reading .swarmforge/operator/role-answers/<role>.json directly, which is
 * exactly what let a
 * five-day-old, already-consumed answer get handed to the specifier as if
 * it answered a live, unrelated question. Runs deliverRoleAnswer, which
 * refuses a mismatch or an already-consumed answer instead of reporting a
 * bare "answer ready".
 *
 * Usage: node deliver-role-answer.js --role <role>
 *
 * Runnable from the repo root or any .worktrees/<role>/ checkout, same
 * project-root resolution as the other tools in this directory.
 */
import { deliverRoleAnswer } from './telegram-front-desk-bot';
import { resolveCliMainWorktreeContext, printJsonToStdout, runCliMain, makeArgsGuardedMain } from './swarm-metrics';

const USAGE = 'Usage: node deliver-role-answer.js --role <role>';

export interface DeliverRoleAnswerArgs {
  role: string;
}

export function parseArgs(argv: string[]): DeliverRoleAnswerArgs | null {
  const idx = argv.indexOf('--role');
  const role = idx >= 0 ? argv[idx + 1] : undefined;
  if (!role) {
    return null;
  }
  return { role };
}

export const main = makeArgsGuardedMain(parseArgs, USAGE, async (args) => {
  const { mainWorktreePath } = resolveCliMainWorktreeContext();
  const result = deliverRoleAnswer(mainWorktreePath, args.role);
  printJsonToStdout(result);
});

if (require.main === module) {
  runCliMain(main);
}
