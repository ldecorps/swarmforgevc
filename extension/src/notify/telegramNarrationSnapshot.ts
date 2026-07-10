// BL-239: assembles the ONE snapshot shape TelegramNarrator diffs against -
// pure combine, no fs/tmux/vscode of its own. The live wiring that calls
// this (extension.ts) is the only place that touches buildBridgeState,
// computeRoleGateStatesLive, and listDeadLetters directly.
import { BridgeState } from '../bridge/bridgeState';
import { mostRecentRunForTarget } from '../runs/runLog';
import { RoleGateState } from '../bridge/gateSnapshot';
import { DeadLetterInfo } from '../swarm/inboxChaser';

export interface NarrationSnapshot {
  runName: string;
  prUrl: string | null;
  pipeline: { role: string; status: 'active' | 'idle' }[];
  gates: RoleGateState[];
  deadLetters: DeadLetterInfo[];
}

// null when there is no run recorded yet for this target - nothing to
// narrate before a run has actually started.
export function buildNarrationSnapshot(
  targetPath: string,
  bridgeState: Pick<BridgeState, 'pipeline' | 'runLog'>,
  gates: RoleGateState[],
  deadLetters: DeadLetterInfo[]
): NarrationSnapshot | null {
  const currentRun = mostRecentRunForTarget(bridgeState.runLog, targetPath);
  if (!currentRun) {
    return null;
  }
  return {
    runName: currentRun.name,
    prUrl: currentRun.prUrl ?? null,
    pipeline: bridgeState.pipeline.map((p) => ({ role: p.role, status: p.status })),
    gates,
    deadLetters,
  };
}
