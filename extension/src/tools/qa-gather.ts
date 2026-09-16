// BL-1554: thin CLI wrapper over extension/src/metrics/qaGatherAdapter.ts's
// gatherQaChecklist - main() itself only parses argv, resolves defaults
// and prints; every decision lives in the testable module (engineering
// prompt's CLI rule).

import { execFileSync } from 'child_process';
import { gatherQaChecklist } from '../metrics/qaGatherAdapter';
import { printJsonToStdout, resolveCliMainWorktreeContext, runCliMain } from './swarm-metrics';

const USAGE = 'Usage: node qa-gather.js --ticket <BL-id> [--task <name>] [--commit <10-hex>] [--root <path>]\n';

export interface ParsedArgs {
  ticket: string;
  task?: string;
  commit?: string;
  root?: string;
}

export function parseArgs(argv: string[]): ParsedArgs | undefined {
  const out: Partial<ParsedArgs> = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--ticket') out.ticket = argv[++i];
    else if (arg === '--task') out.task = argv[++i];
    else if (arg === '--commit') out.commit = argv[++i];
    else if (arg === '--root') out.root = argv[++i];
  }
  if (!out.ticket) {
    return undefined;
  }
  return out as ParsedArgs;
}

function resolveHeadCommit(root: string): string {
  try {
    return execFileSync('git', ['rev-parse', '--short=10', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  } catch {
    return 'unknown';
  }
}

export function main(): void {
  const args = parseArgs(process.argv.slice(2));
  if (!args) {
    process.stderr.write(USAGE);
    process.exitCode = 2;
    return;
  }
  const root = args.root ?? resolveCliMainWorktreeContext().projectRoot;
  const commit = args.commit ?? resolveHeadCommit(root);
  const report = gatherQaChecklist(root, args.ticket, { task: args.task, commit });
  printJsonToStdout(report);
}

if (require.main === module) {
  runCliMain(main);
}
