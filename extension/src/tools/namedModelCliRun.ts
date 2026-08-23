/**
 * BL-1082: named-model CLI command runners (compose / optional execute).
 *
 * Kept separate from arg parsing so each stage stays under CRAP ≤ 6.
 */
import {
  buildNamedModelPullPlan,
  buildNamedModelServePlan,
  formatNamedModelStatus,
  isNamedModelHealthy,
  type NamedModelPullPlan,
  type NamedModelServePlan,
} from '../swarm/modelServing';
import { usageText, type NamedModelCliArgs } from './namedModelCliArgs';

export interface NamedModelCliDeps {
  execCommand?: (command: string) => void;
  writeOut?: (text: string) => void;
  writeErr?: (text: string) => void;
}

export function formatPullPlan(plan: NamedModelPullPlan): string {
  if (!plan.shouldDownload) {
    return plan.message;
  }
  return `${plan.message}\n${plan.command}`;
}

export function formatServePlan(plan: NamedModelServePlan): string {
  if (!plan.shouldStartServer) {
    return plan.message;
  }
  return `${plan.message}\n${plan.command}`;
}

function maybeExecute(
  command: string | null,
  execute: boolean,
  execCommand: ((command: string) => void) | undefined
): void {
  if (!execute || !command) {
    return;
  }
  if (!execCommand) {
    throw new Error('execute requested but no execCommand dep was provided');
  }
  execCommand(command);
}

function runHelp(writeOut: (text: string) => void): number {
  writeOut(usageText());
  return 0;
}

function runStatus(args: NamedModelCliArgs, writeOut: (text: string) => void): number {
  const health = isNamedModelHealthy(args.probe);
  writeOut(formatNamedModelStatus(health));
  return health.ready ? 0 : 1;
}

function runPull(args: NamedModelCliArgs, deps: NamedModelCliDeps, writeOut: (text: string) => void): number {
  const plan = buildNamedModelPullPlan(args.modelId, {
    repoRoot: args.repoRoot,
    modelStorePath: args.modelStorePath,
    presentModelIds: args.presentModelIds,
    availableModelIds: args.availableModelIds,
  });
  writeOut(formatPullPlan(plan));
  maybeExecute(plan.command, args.execute, deps.execCommand);
  return 0;
}

function runServe(args: NamedModelCliArgs, deps: NamedModelCliDeps, writeOut: (text: string) => void): number {
  const plan = buildNamedModelServePlan(args.modelId, args.probe, {
    endpointUrl: args.endpointUrl,
  });
  writeOut(formatServePlan(plan));
  maybeExecute(plan.command, args.execute, deps.execCommand);
  return 0;
}

function dispatchCommand(
  args: NamedModelCliArgs,
  deps: NamedModelCliDeps,
  writeOut: (text: string) => void
): number {
  if (args.command === 'help') {
    return runHelp(writeOut);
  }
  if (args.command === 'status') {
    return runStatus(args, writeOut);
  }
  if (args.command === 'pull') {
    return runPull(args, deps, writeOut);
  }
  return runServe(args, deps, writeOut);
}

export function runNamedModelCli(args: NamedModelCliArgs, deps: NamedModelCliDeps = {}): number {
  const writeOut = deps.writeOut ?? ((text: string) => process.stdout.write(`${text}\n`));
  const writeErr = deps.writeErr ?? ((text: string) => process.stderr.write(`${text}\n`));
  try {
    return dispatchCommand(args, deps, writeOut);
  } catch (err) {
    writeErr(String((err as Error)?.message || err));
    return 1;
  }
}
