// BL-240: wires gateAnswerPath.ts's pure answerCapturedGate to the real
// swarm - the exact same target-resolution + tmux send-keys call chain
// PaneTailer.forwardInput (paneTailer.ts) uses locally, assembled fresh
// per-request since the bridge has no live PaneTailer instance to reuse
// (a separate, stateless HTTP surface). Kept out of gateAnswerPath.ts
// itself so that module stays trivially unit-testable with injected fakes,
// no real tmux/fs involved.

import {
  readTmuxSocket,
  readSwarmRoles,
  resolveAgentPaneTarget,
  getPaneBaseIndex,
  capturePane,
  sendKeys,
} from '../swarm/tmuxClient';
import { mapInputToTmuxKey } from '../panel/paneTailer';
import { recordHumanInput } from '../swarm/humanInputTracker';
import { appendInputEntry } from '../swarm/inputLog';
import { detectNeedsHuman } from '../panel/needsHumanDetection';
import { answerCapturedGate, GateAnswerRequest, GateAnswerResult } from './gateAnswerPath';

function resolveLiveTarget(targetPath: string, socketPath: string, role: string): string | undefined {
  const roleEntry = readSwarmRoles(targetPath).find((entry) => entry.role === role);
  if (!roleEntry) {
    return undefined;
  }
  return resolveAgentPaneTarget(socketPath, roleEntry.session, getPaneBaseIndex(socketPath));
}

export function answerCapturedGateLive(targetPath: string, request: GateAnswerRequest): GateAnswerResult {
  const socketPath = readTmuxSocket(targetPath);
  if (!socketPath) {
    return { success: false, reason: 'No tmux socket recorded (is the swarm running?)' };
  }

  return answerCapturedGate(request, {
    capturePaneText: (role) => {
      const target = resolveLiveTarget(targetPath, socketPath, role);
      if (!target) {
        return undefined;
      }
      const captured = capturePane(socketPath, target);
      return captured.exitCode === 0 ? captured.stdout : undefined;
    },
    isPaneGated: detectNeedsHuman,
    sendAnswer: (role, answer) => {
      const target = resolveLiveTarget(targetPath, socketPath, role);
      if (!target) {
        return;
      }
      const mapped = mapInputToTmuxKey(answer);
      sendKeys(socketPath, target, mapped.key, mapped.literal);
      recordHumanInput(role);
      try {
        appendInputEntry(targetPath, role, answer);
      } catch {
        // Best-effort audit trail, same non-fatal posture as
        // PaneTailer.logInput - an audit-write failure must never block
        // the answer itself from reaching the pane.
      }
    },
  });
}
