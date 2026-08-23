/**
 * BL-1081: spawn/snapshot plan helpers for the ACP pane host.
 *
 * Separated from argv parsing so each surface stays under a tractable
 * mutation budget while keeping policy (what to spawn) independent of
 * CLI flag collection.
 */

import * as path from 'path';
import { acpSnapshotRelPath } from './acpHostRuntime';
import type { AcpHostPaneArgs } from './acpHostPaneArgs';

/** Argv for the underlying vibe CLI (ACP stdio + the same trust/workdir flags). */
export function buildAgentArgv(args: AcpHostPaneArgs): string[] {
  const argv = ['vibe', '--yolo', '--trust', '--workdir', args.workdir];
  if (args.addDir) argv.push('--add-dir', args.addDir);
  if (args.extraCli) {
    // Split on whitespace only for the spike; write_role_launch_script already
    // shell-quoted the block as a single --extra-cli value when needed.
    argv.push(...args.extraCli.split(/\s+/).filter(Boolean));
  }
  if (args.firstMessage) argv.push(args.firstMessage);
  return argv;
}

export function snapshotAbsPath(repoRoot: string, role: string): string {
  return path.join(repoRoot, acpSnapshotRelPath(role));
}

export function formatSnapshotBody(snapshot: unknown): string {
  return `${JSON.stringify(snapshot, null, 2)}\n`;
}
