/**
 * BL-1082: named-model CLI argument grammar (parse + usage).
 *
 * Split from named-model.ts so flag parsing stays under the CRAP budget and
 * mutation-site soft threshold without a mechanical line-count chop.
 */
import type { NamedModelCliArgs, NamedModelCommand } from './namedModelCliArgsTypes';
import { KNOWN_COMMANDS, defaultNamedModelArgs } from './namedModelCliArgsTypes';
import { BOOL_FLAGS, VALUE_FLAGS, takeFlagValue } from './namedModelCliFlags';

export type { NamedModelCommand, NamedModelCliArgs } from './namedModelCliArgsTypes';

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

/** Apply one argv token; returns how many following tokens were consumed. */
function consumeArgToken(
  args: NamedModelCliArgs,
  argv: string[],
  index: number,
  positional: string[]
): number {
  const token = argv[index];
  const boolApply = BOOL_FLAGS[token];
  if (boolApply) {
    boolApply(args);
    return 0;
  }
  const valueApply = VALUE_FLAGS[token];
  if (valueApply) {
    valueApply(args, takeFlagValue(argv, index, token));
    return 1;
  }
  if (token.startsWith('--')) {
    throw new Error(`Unknown flag: ${token}`);
  }
  positional.push(token);
  return 0;
}

function resolveCommand(token: string): NamedModelCommand {
  const command = (token || 'help').toLowerCase();
  if (!KNOWN_COMMANDS.has(command as NamedModelCommand)) {
    throw new Error(`Unknown command: ${command}`);
  }
  return command as NamedModelCommand;
}

function requireModelIdWhenNeeded(command: NamedModelCommand, modelId: string): void {
  if ((command === 'pull' || command === 'serve') && !modelId) {
    throw new Error(`${command} requires a model id`);
  }
}

export function parseNamedModelArgs(argv: string[]): NamedModelCliArgs {
  const args = defaultNamedModelArgs();
  const positional: string[] = [];
  for (let i = 0; i < argv.length; i += 1) {
    i += consumeArgToken(args, argv, i, positional);
  }
  args.command = resolveCommand(positional[0] || 'help');
  args.modelId = positional[1] || '';
  requireModelIdWhenNeeded(args.command, args.modelId);
  return args;
}
