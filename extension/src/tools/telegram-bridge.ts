#!/usr/bin/env node
/**
 * BL-281: thin Node CLI bridge over telegramClient.ts, shelled out to from
 * the Babashka Operator runtime (operator_runtime.bb) - Babashka cannot
 * import a CommonJS/TS module directly, the same shell-to-Node pattern
 * handoffd.bb already uses for emit-cost-health-sidecar.js. Reads the bot
 * token/chat id from env (TELEGRAM_BOT_TOKEN/TELEGRAM_CHAT_ID), mirroring
 * RESEND_API_KEY's operator-provided-env-var convention (BL-214/BL-215) -
 * never a key store here.
 *
 * Usage:
 *   node telegram-bridge.js create-topic <name>
 *   node telegram-bridge.js send <text> [--thread <messageThreadId>] [--reply-to <id>]
 *   node telegram-bridge.js get-updates <offset> [--timeout <seconds>]
 *
 * Prints the result as JSON to stdout. Exits non-zero on a USAGE error; a
 * Telegram-side failure (bad token, API error) still exits 0 with
 * {"success":false,...} on stdout - the caller (operator_runtime.bb)
 * decides how to react, matching every other *Result-shaped adapter here.
 */
import { sendTelegramMessage, getTelegramUpdates, createForumTopic } from '../notify/telegramClient';
import { printJsonToStdout, runCliMain } from './swarm-metrics';

export type TelegramBridgeArgs =
  | { subcommand: 'create-topic'; name: string }
  | { subcommand: 'send'; text: string; threadId?: number; replyTo?: number }
  | { subcommand: 'get-updates'; offset: number; timeoutSeconds: number };

const USAGE =
  'Usage: telegram-bridge.js create-topic <name> | send <text> [--thread <id>] [--reply-to <id>] | get-updates <offset> [--timeout <seconds>]\n';

function flagValue(argv: string[], flag: string): string | undefined {
  const i = argv.indexOf(flag);
  return i !== -1 ? argv[i + 1] : undefined;
}

// Pure - no process.argv/stderr/exitCode access here, the same "thin
// main()" split every CLI in this directory follows (engineering "CLI
// main() must be a thin wrapper over pure helpers").
export function parseArgs(argv: string[]): TelegramBridgeArgs | null {
  const [subcommand, ...rest] = argv;
  if (subcommand === 'create-topic') {
    const [name] = rest;
    return name ? { subcommand, name } : null;
  }
  if (subcommand === 'send') {
    const [text] = rest;
    if (!text) {
      return null;
    }
    const threadIdRaw = flagValue(rest, '--thread');
    const replyToRaw = flagValue(rest, '--reply-to');
    return {
      subcommand,
      text,
      threadId: threadIdRaw !== undefined ? Number(threadIdRaw) : undefined,
      replyTo: replyToRaw !== undefined ? Number(replyToRaw) : undefined,
    };
  }
  if (subcommand === 'get-updates') {
    const [offsetRaw] = rest;
    if (!offsetRaw) {
      return null;
    }
    const timeoutRaw = flagValue(rest, '--timeout');
    return { subcommand, offset: Number(offsetRaw), timeoutSeconds: timeoutRaw !== undefined ? Number(timeoutRaw) : 25 };
  }
  return null;
}

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not set in the environment`);
  }
  return value;
}

export async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (!args) {
    process.stderr.write(USAGE);
    process.exitCode = 1;
    return;
  }
  const token = requiredEnv('TELEGRAM_BOT_TOKEN');

  if (args.subcommand === 'create-topic') {
    printJsonToStdout(await createForumTopic(token, requiredEnv('TELEGRAM_CHAT_ID'), args.name));
    return;
  }
  if (args.subcommand === 'send') {
    printJsonToStdout(await sendTelegramMessage(token, requiredEnv('TELEGRAM_CHAT_ID'), args.text, args.replyTo, undefined, args.threadId));
    return;
  }
  printJsonToStdout(await getTelegramUpdates(token, args.offset, args.timeoutSeconds));
}

if (require.main === module) {
  runCliMain(main);
}
