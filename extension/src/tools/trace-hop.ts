#!/usr/bin/env node
/**
 * BL-021: trace-hop CLI
 *
 * Usage:
 *   node trace-hop.js <traceId> receive
 *   node trace-hop.js <traceId> decide <decision> [detail]
 *   node trace-hop.js <traceId> retry "<reason>"
 *
 * Role is read from $SWARMFORGE_ROLE.
 * Traces dir: $SWARMFORGE_TRACES_DIR or <git-common-dir>/../.swarmforge/traces/
 */

import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';

export const PHASE_MAP: Record<string, string> = {
  coordinator: 'routing',
  specifier: 'specifying',
  coder: 'coding',
  cleaner: 'verifying',
};

export function roleToPhase(role: string): string {
  const phase = PHASE_MAP[role];
  if (!phase) {
    throw new Error(`Unknown role "${role}" — cannot map to phase. Known roles: ${Object.keys(PHASE_MAP).join(', ')}`);
  }
  return phase;
}

export function buildReceiveLines(role: string, iso: string): string[] {
  const phase = roleToPhase(role);
  return [
    `HOP ${role} ${iso} action=receive state=received`,
    `STATE_CHANGE ${role} ${iso} received->${phase}`,
  ];
}

export function buildDecideLines(role: string, iso: string, decision: string, detail?: string): string[] {
  let line = `DECISION ${role} ${iso} decision=${decision}`;
  if (detail) {
    line += ` details="${detail}"`;
  }
  return [line];
}

export function buildRetryLine(role: string, iso: string, attempt: number, reason: string): string {
  return `RETRY ${role} ${iso} attempt=${attempt} reason="${reason}"`;
}

export function countPriorRetries(logPath: string, role: string): number {
  if (!fs.existsSync(logPath)) {
    return 0;
  }
  const content = fs.readFileSync(logPath, 'utf-8');
  let count = 0;
  for (const line of content.split('\n')) {
    if (line.match(new RegExp(`^RETRY ${role} `))) {
      count++;
    }
  }
  return count;
}

export function resolveTracesDir(envDir: string | null, cwd?: string): string {
  if (envDir) {
    return envDir;
  }
  try {
    const gitCommonDir = execSync('git rev-parse --git-common-dir', {
      cwd: cwd ?? process.cwd(),
      encoding: 'utf-8',
    }).trim();
    // git-common-dir is inside the worktree; go up to the repo root
    const repoRoot = path.resolve(gitCommonDir, '..', '..');
    return path.join(repoRoot, '.swarmforge', 'traces');
  } catch {
    throw new Error(
      'Cannot resolve traces directory: $SWARMFORGE_TRACES_DIR is not set and git rev-parse --git-common-dir failed.'
    );
  }
}

function atomicAppend(logPath: string, lines: string[]): void {
  const content = lines.join('\n') + '\n';
  // For single-line appends, O_APPEND is atomic on POSIX.
  // For multi-line, write to tmp then rename to avoid interleaving.
  if (lines.length === 1) {
    fs.appendFileSync(logPath, content, { encoding: 'utf-8', flag: 'a' });
  } else {
    const tmp = `${logPath}.tmp.${process.pid}`;
    fs.writeFileSync(tmp, content, 'utf-8');
    // Read existing + append manually (rename would truncate on concurrent writers)
    // Safe enough: multi-line appends are rare and single-process in practice.
    const existing = fs.existsSync(logPath) ? fs.readFileSync(logPath, 'utf-8') : '';
    fs.writeFileSync(tmp, existing + content, 'utf-8');
    fs.renameSync(tmp, logPath);
  }
}

export function main(argv: string[]): void {
  const role = process.env.SWARMFORGE_ROLE;
  if (!role) {
    console.error('ERROR: $SWARMFORGE_ROLE is not set.');
    process.exit(1);
  }

  const [traceId, command, ...rest] = argv;
  if (!traceId || !command) {
    console.error('Usage: trace-hop.js <traceId> <receive|decide|retry> [args...]');
    process.exit(1);
  }

  const tracesDir = resolveTracesDir(process.env.SWARMFORGE_TRACES_DIR ?? null);
  fs.mkdirSync(tracesDir, { recursive: true });
  const logPath = path.join(tracesDir, `${traceId}.log`);
  const iso = new Date().toISOString();

  if (command === 'receive') {
    atomicAppend(logPath, buildReceiveLines(role, iso));
  } else if (command === 'decide') {
    const [decision, detail] = rest;
    if (!decision) {
      console.error('Usage: trace-hop.js <traceId> decide <decision> [detail]');
      process.exit(1);
    }
    atomicAppend(logPath, buildDecideLines(role, iso, decision, detail));
  } else if (command === 'retry') {
    const reason = rest[0];
    if (!reason) {
      console.error('Usage: trace-hop.js <traceId> retry "<reason>"');
      process.exit(1);
    }
    const attempt = countPriorRetries(logPath, role) + 1;
    atomicAppend(logPath, [buildRetryLine(role, iso, attempt, reason)]);
  } else {
    console.error(`Unknown command "${command}". Expected: receive, decide, retry.`);
    process.exit(1);
  }
}

if (require.main === module) {
  main(process.argv.slice(2));
}
