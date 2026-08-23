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
 */

import { execSync } from 'child_process';
import {
  buildNamedModelPullPlan,
  buildNamedModelServePlan,
  formatNamedModelStatus,
  isNamedModelHealthy,
  DEFAULT_NAMED_MODEL_ENDPOINT_URL,
  type NamedModelEndpointProbe,
  type NamedModelPullPlan,
  type NamedModelServePlan,
} from '../swarm/modelServing';

export type NamedModelCommand = 'pull' | 'serve' | 'status' | 'help';

export interface NamedModelCliArgs {
  command: NamedModelCommand;
  modelId: string;
  repoRoot?: string;
  modelStorePath?: string;
  endpointUrl: string;
  execute: boolean;
  presentModelIds: string[];
  availableModelIds?: string[];
  probe: NamedModelEndpointProbe;
}

export interface NamedModelCliDeps {
  execCommand?: (command: string) => void;
  writeOut?: (text: string) => void;
  writeErr?: (text: string) => void;
}

export function usageText(): string {
  return [
    'Usage: named-model <pull|serve|status|help> [model-id] [options]',
    '',
    '  pull <model-id>   Compose (or --execute) an ollama pull for that id',
    '  serve <model-id>  Compose (or --execute) an ollama serve when needed',
    '  status            Report loopback OpenAI-compatible endpoint health',
    '',
    'Options:',
    '  --store <path>    Host model store (default: ~/.swarmforge/models/ollama)',
    '  --repo <path>     Tracked worktree root (refuses a store inside it)',
    '  --endpoint <url>  Loopback base URL (default: http://127.0.0.1:11434)',
    '  --execute         Run the composed command instead of printing it',
    '  --present <id>    Treat <id> as already in the store (repeatable)',
    '  --healthy         Treat the endpoint as already healthy (serve reuse)',
  ].join('\n');
}

function takeFlagValue(argv: string[], index: number, flag: string): string {
  const value = argv[index + 1];
  if (!value || value.startsWith('--')) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}

export function parseNamedModelArgs(argv: string[]): NamedModelCliArgs {
  const args: NamedModelCliArgs = {
    command: 'help',
    modelId: '',
    endpointUrl: DEFAULT_NAMED_MODEL_ENDPOINT_URL,
    execute: false,
    presentModelIds: [],
    probe: { endpointStatus: 'missing', endpointUrl: DEFAULT_NAMED_MODEL_ENDPOINT_URL },
  };

  const positional: string[] = [];
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === '--execute') {
      args.execute = true;
      continue;
    }
    if (token === '--store') {
      args.modelStorePath = takeFlagValue(argv, i, token);
      i += 1;
      continue;
    }
    if (token === '--repo') {
      args.repoRoot = takeFlagValue(argv, i, token);
      i += 1;
      continue;
    }
    if (token === '--endpoint') {
      args.endpointUrl = takeFlagValue(argv, i, token);
      args.probe = { ...args.probe, endpointUrl: args.endpointUrl };
      i += 1;
      continue;
    }
    if (token === '--present') {
      args.presentModelIds.push(takeFlagValue(argv, i, token));
      i += 1;
      continue;
    }
    if (token === '--healthy') {
      args.probe = { endpointStatus: 'healthy', endpointUrl: args.endpointUrl };
      continue;
    }
    if (token.startsWith('--')) {
      throw new Error(`Unknown flag: ${token}`);
    }
    positional.push(token);
  }

  const commandToken = (positional[0] || 'help').toLowerCase();
  if (
    commandToken !== 'pull' &&
    commandToken !== 'serve' &&
    commandToken !== 'status' &&
    commandToken !== 'help'
  ) {
    throw new Error(`Unknown command: ${commandToken}`);
  }
  args.command = commandToken;
  args.modelId = positional[1] || '';
  if ((args.command === 'pull' || args.command === 'serve') && !args.modelId) {
    throw new Error(`${args.command} requires a model id`);
  }
  return args;
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

export function runNamedModelCli(args: NamedModelCliArgs, deps: NamedModelCliDeps = {}): number {
  const writeOut = deps.writeOut ?? ((text: string) => process.stdout.write(`${text}\n`));
  const writeErr = deps.writeErr ?? ((text: string) => process.stderr.write(`${text}\n`));
  const execCommand = deps.execCommand;

  if (args.command === 'help') {
    writeOut(usageText());
    return 0;
  }

  try {
    if (args.command === 'status') {
      const health = isNamedModelHealthy(args.probe);
      writeOut(formatNamedModelStatus(health));
      return health.ready ? 0 : 1;
    }

    if (args.command === 'pull') {
      const plan = buildNamedModelPullPlan(args.modelId, {
        repoRoot: args.repoRoot,
        modelStorePath: args.modelStorePath,
        presentModelIds: args.presentModelIds,
        availableModelIds: args.availableModelIds,
      });
      writeOut(formatPullPlan(plan));
      if (args.execute && plan.command) {
        if (!execCommand) {
          throw new Error('execute requested but no execCommand dep was provided');
        }
        execCommand(plan.command);
      }
      return 0;
    }

    const plan = buildNamedModelServePlan(args.modelId, args.probe, {
      endpointUrl: args.endpointUrl,
    });
    writeOut(formatServePlan(plan));
    if (args.execute && plan.command) {
      if (!execCommand) {
        throw new Error('execute requested but no execCommand dep was provided');
      }
      execCommand(plan.command);
    }
    return 0;
  } catch (err) {
    writeErr(String((err as Error)?.message || err));
    return 1;
  }
}

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
