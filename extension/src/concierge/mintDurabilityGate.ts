// BL-1190 deliverable 3: the specifier's own "spec-ready" handoff must not
// arm an ApprovalRequested path for a paused ticket whose yaml is not yet
// DURABLY committed - a working-tree-only yaml can vanish (a revert, a
// crash before the commit lands) leaving a live ApprovalRequested ask with
// nothing behind it (BL-1186's own root cause). Reuses isFileCommitted
// (BL-331's established "present AND has no pending changes" durability
// contract), never a second, drifting git-status check of its own.
import * as path from 'path';
import { isFileCommitted } from '../util/gitCommitScopedFile';

export interface MintDurabilityResult {
  refused: boolean;
  reason?: string;
}

export function checkMintDurability(targetPath: string, pausedYamlRelPath: string): MintDurabilityResult {
  const absPath = path.join(targetPath, pausedYamlRelPath);
  if (isFileCommitted(targetPath, absPath)) {
    return { refused: false };
  }
  return { refused: true, reason: `not committed: ${pausedYamlRelPath}` };
}

// The handoff-shaped wrapper: "spec-ready" only ever arms the
// ApprovalRequested path (calls `arm`) when the gate does not refuse - the
// caller's contract, encoded once here rather than re-checked ad hoc at
// each call site.
export function attemptSpecReadyHandoff(targetPath: string, pausedYamlRelPath: string, arm: () => void): MintDurabilityResult {
  const result = checkMintDurability(targetPath, pausedYamlRelPath);
  if (!result.refused) {
    arm();
  }
  return result;
}
