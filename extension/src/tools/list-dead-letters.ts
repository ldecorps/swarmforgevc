#!/usr/bin/env node
/**
 * BL-109 dead-letter-visible-03: agent/human-callable dead-letter listing.
 *
 * Usage: node list-dead-letters.js
 *
 * Runnable from the repo root or any .worktrees/<role>/ checkout - anchors
 * path resolution at the git worktree/repo root (BL-056 lesson), reusing
 * swarm-metrics.ts's resolveProjectRoot. Read-only, headless: no VS Code
 * required. A dead-lettered handoff was previously invisible debris (renamed
 * to <name>.handoff.dead next to a .chase.json sidecar nothing read back,
 * indistinguishable from success to the sender); this surfaces every one,
 * across every role, with who it was for and what it was.
 */

import * as path from 'path';
import { listDeadLetters, DeadLetterInfo } from '../swarm/inboxChaser';
import { mailboxDir } from '../swarm/swarmState';
import { resolveProjectRoot, loadRoles, runCliMain } from './swarm-metrics';

export function formatDeadLetterListing(deadLetters: DeadLetterInfo[]): string {
  if (deadLetters.length === 0) {
    return 'No dead-lettered handoffs.';
  }
  return deadLetters
    .map((d) => {
      const from = d.from ?? 'unknown';
      const type = d.type ?? 'unknown';
      const task = d.task ? ` task=${d.task}` : '';
      return `[${d.role}] ${path.basename(d.filePath)} - from=${from} type=${type}${task} chases=${d.chaseCount}`;
    })
    .join('\n');
}

export function main(): void {
  const projectRoot = resolveProjectRoot(process.cwd());
  const roles = loadRoles(projectRoot);

  const roleInboxes = roles.map((r) => ({
    role: r.role,
    inboxNewDir: mailboxDir(r, 'inbox', 'new'),
  }));

  console.log(formatDeadLetterListing(listDeadLetters(roleInboxes)));
}

if (require.main === module) {
  runCliMain(main);
}
