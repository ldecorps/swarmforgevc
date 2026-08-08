#!/usr/bin/env node
/**
 * BL-619: records a human-transcribed account usage-percentage checkpoint -
 * the number the human reads off the app on their phone - into
 * .swarmforge/operator/usage-anchors.jsonl (usageAnchorStore.ts). The
 * projection CLI (token-burn-section.ts) reads these back to derive a burn
 * rate; this tool owns validation and persistence only, never a derivation.
 *
 * Usage: node usage-anchor.js record <pct> [scope] [--now <epoch-ms>]
 *   <pct>              0..100 inclusive; anything else is rejected (exit 1),
 *                      nothing is written.
 *   [scope]            Defaults to "all-models" (the binding limit surfaced
 *                       in the app).
 *   --now <epoch-ms>   Injected clock for e2e verification without waiting
 *                       for a real instant - an argument seam, not a
 *                       *_FORCE_RESULT env bypass. Defaults to Date.now().
 *
 * Runnable from the repo root or any .worktrees/<role>/ checkout, same
 * project-root resolution as the rest of extension/src/tools.
 */
import { appendUsageAnchor, DEFAULT_ANCHOR_SCOPE } from '../metrics/usageAnchorStore';
import { resolveCliMainWorktreeContext, printJsonToStdout, runCliMain } from './swarm-metrics';

export type ParsedArgs = { command: 'record'; pct: number; scope: string; nowMs: number } | { error: string };

const USAGE = 'usage: usage-anchor.js record <pct> [scope] [--now <epoch-ms>]';

function extractNowFlag(rest: string[], defaultNowMs: number): { nowMs: number; positional: string[] } {
  const positional: string[] = [];
  let nowMs = defaultNowMs;
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === '--now' && rest[i + 1] !== undefined) {
      nowMs = Number(rest[i + 1]);
      i++;
    } else {
      positional.push(rest[i]);
    }
  }
  return { nowMs, positional };
}

function parsePctAndScope(positional: string[]): { pct: number; scope: string } | { error: string } {
  const [pctRaw, scopeRaw] = positional;
  const pct = Number(pctRaw);
  if (pctRaw === undefined || Number.isNaN(pct)) {
    return { error: `pct must be a number - ${USAGE}` };
  }
  return { pct, scope: scopeRaw ?? DEFAULT_ANCHOR_SCOPE };
}

export function parseArgs(argv: string[], defaultNowMs: number): ParsedArgs {
  const [command, ...rest] = argv;
  if (command !== 'record') {
    return { error: `unknown command "${command ?? ''}" - ${USAGE}` };
  }
  const { nowMs, positional } = extractNowFlag(rest, defaultNowMs);
  const parsedPctScope = parsePctAndScope(positional);
  if ('error' in parsedPctScope) {
    return parsedPctScope;
  }
  return { command: 'record', pct: parsedPctScope.pct, scope: parsedPctScope.scope, nowMs };
}

export function main(): void {
  const { projectRoot } = resolveCliMainWorktreeContext();
  const parsed = parseArgs(process.argv.slice(2), Date.now());
  if ('error' in parsed) {
    process.stderr.write(parsed.error + '\n');
    process.exitCode = 1;
    return;
  }
  const result = appendUsageAnchor(projectRoot, parsed.nowMs, parsed.pct, parsed.scope);
  if (!result.ok) {
    process.stderr.write(result.error + '\n');
    process.exitCode = 1;
    return;
  }
  printJsonToStdout({ recorded: true, pct: result.anchor.pct, scope: result.anchor.scope, atMs: result.anchor.atMs });
}

if (require.main === module) {
  runCliMain(main);
}
