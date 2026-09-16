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

// Flag -> setter, in place of an if/else-if chain (hardener extraction,
// BL-1554 CRAP gate: complexity 7 at 100% coverage on the chain form,
// complexity alone) - a lookup collapses 4 branches into 1.
const ARG_SETTERS: Record<string, (out: Partial<ParsedArgs>, value: string) => void> = {
  '--ticket': (out, value) => {
    out.ticket = value;
  },
  '--task': (out, value) => {
    out.task = value;
  },
  '--commit': (out, value) => {
    out.commit = value;
  },
  '--root': (out, value) => {
    out.root = value;
  },
};

export function parseArgs(argv: string[]): ParsedArgs | undefined {
  const out: Partial<ParsedArgs> = {};
  for (let i = 0; i < argv.length; i += 1) {
    const setter = ARG_SETTERS[argv[i]];
    if (setter) setter(out, argv[++i]);
  }
  if (!out.ticket) {
    return undefined;
  }
  return out as ParsedArgs;
}

export function resolveHeadCommit(root: string): string {
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
