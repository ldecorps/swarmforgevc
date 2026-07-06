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
  architect: 'architecting',
  hardender: 'hardening',
  documenter: 'documenting',
  QA: 'qa-verifying',
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
  try {
    const content = fs.readFileSync(logPath, 'utf-8');
    let count = 0;
    // Escape role for regex to prevent injection in subsequent operations.
    const escapedRole = role.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(`^RETRY ${escapedRole} `);
    for (const line of content.split('\n')) {
      if (line.match(pattern)) {
        count++;
      }
    }
    return count;
  } catch (error) {
    console.error(`Cannot read log file ${logPath}: ${error instanceof Error ? error.message : String(error)}`);
    throw error;
  }
}

export function resolveTracesDir(envDir: string | null, cwd?: string): string {
  if (envDir) {
    return envDir;
  }
  try {
    const resolvedCwd = cwd ?? process.cwd();
    const gitCommonDir = execSync('git rev-parse --git-common-dir', {
      cwd: resolvedCwd,
      encoding: 'utf-8',
    }).trim();
    // git-common-dir is relative (".git") in a plain repo but absolute in a
    // linked worktree (it points at the main repo's .git) - resolve it
    // against resolvedCwd (not process.cwd()) so a relative result lands in
    // the right place; path.resolve discards the leading segment when a
    // later one is already absolute, so this handles both cases.
    const repoRoot = path.resolve(resolvedCwd, gitCommonDir, '..');
    return path.join(repoRoot, '.swarmforge', 'traces');
  } catch (error) {
    const details = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Cannot resolve traces directory: $SWARMFORGE_TRACES_DIR is not set and git rev-parse --git-common-dir failed. Details: ${details}`
    );
  }
}

function atomicAppend(logPath: string, lines: string[]): void {
  // Use O_APPEND for all appends (atomic on POSIX). This avoids the race condition
  // of multi-line appends where concurrent writers can lose data via rename.
  const content = lines.join('\n') + '\n';
  try {
    fs.appendFileSync(logPath, content, { encoding: 'utf-8', flag: 'a' });
  } catch (error) {
    throw new Error(
      `Failed to append to trace log ${logPath}: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

export function main(argv: string[]): void {
  try {
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

    // Validate traceId: must not contain path separators or traversal patterns
    if (traceId.includes('/') || traceId.includes('\\') || traceId.includes('..')) {
      console.error(`ERROR: Invalid traceId "${traceId}" — must not contain path separators or traversal patterns.`);
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
  } catch (error) {
    console.error(`Fatal error: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}

if (require.main === module) {
  main(process.argv.slice(2));
}
