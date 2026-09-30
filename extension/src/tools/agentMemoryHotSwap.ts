/**
 * BL-1178: wire BL-1177 capture/inject into same-role model switch paths
 * (BL-235 hot-swap, trial boundaries, relaunch hooks).
 * seat relaunch / hot-swap / trial lifecycle: capture then inject (BL-1177 API)
 */

import * as fs from 'fs';
import * as path from 'path';
import { computeRoleQueueView } from '../swarm/inboxVisibility';
import { RespawnResult } from '../swarm/tmuxClient';
import {
  agentMemoryTransfer,
  CaptureNamedInputs,
  InjectAgentMemoryResult,
  PortableAgentMemoryPayload,
} from './agentMemoryTransfer';

export type AgentMemoryTransferApi = Pick<typeof agentMemoryTransfer, 'capture' | 'inject'>;

export type TrialBoundary = 'start' | 'end';

export type MemoryTransferOutcome =
  | {
      ok: true;
      captured: true;
      injected: true;
      payload: PortableAgentMemoryPayload;
      injectResult: Extract<InjectAgentMemoryResult, { ok: true }>;
    }
  | {
      ok: false;
      captured: boolean;
      injected: false;
      signal: string;
      payload?: PortableAgentMemoryPayload;
    };

export const MEMORY_TRANSFER_ABORT_PREFIX = 'model switch aborted: agent-memory transfer failed';

function resolveRoleHandoffInboxDirs(
  targetPath: string,
  role: string
): { newDir: string; inProcessDir: string } {
  const worktreeInbox = path.join(targetPath, '.worktrees', role, '.swarmforge', 'handoffs', 'inbox');
  const sharedInbox = path.join(targetPath, '.swarmforge', 'handoffs', 'inbox');
  const base = fs.existsSync(path.join(worktreeInbox, 'new')) ? worktreeInbox : sharedInbox;
  return {
    newDir: path.join(base, 'new'),
    inProcessDir: path.join(base, 'in_process'),
  };
}

/** Collect open-parcel ids from a role's handoff inbox for capture. */
export function buildOutgoingCaptureState(
  targetPath: string,
  role: string,
  transcriptSummary = ''
): CaptureNamedInputs {
  const { newDir, inProcessDir } = resolveRoleHandoffInboxDirs(targetPath, role);
  const view = computeRoleQueueView(role, newDir, inProcessDir, false);
  const openParcelIds = [...view.newPayloads, ...view.inProcessPayloads];
  return { role, transcriptSummary, openParcelIds };
}

/** Capture then inject for one role before live work resumes. */
export function runMemoryTransferForRole(
  role: string,
  outgoingState: CaptureNamedInputs,
  deps: AgentMemoryTransferApi = agentMemoryTransfer
): MemoryTransferOutcome {
  const { payload } = deps.capture(outgoingState);
  const injectResult = deps.inject(role, payload);
  if (!injectResult.ok) {
    return {
      ok: false,
      captured: true,
      injected: false,
      signal: injectResult.signal,
      payload,
    };
  }
  return {
    ok: true,
    captured: true,
    injected: true,
    payload,
    injectResult,
  };
}

/** BoB / steward trial start or end — same capture/inject contract as hot-swap. */
export function runTrialBoundaryMemoryTransfer(
  role: string,
  _boundary: TrialBoundary,
  outgoingState: CaptureNamedInputs,
  deps: AgentMemoryTransferApi = agentMemoryTransfer
): MemoryTransferOutcome {
  return runMemoryTransferForRole(role, outgoingState, deps);
}

/**
 * BL-1815: the on-disk home for a role's agent-memory artifacts at a trial
 * boundary - the outgoing seat's knowledge brief (brief.md, written by the
 * live seat itself, never by this tool) and the persisted portable payload
 * (payload.json, written below). Kept as one named function so both the
 * brief path (model_steward_brief_lib.bb's own brief-path mirrors this
 * exact join) and the payload path agree without restating the segments.
 */
export function agentMemoryDir(targetPath: string, role: string): string {
  return path.join(targetPath, '.swarmforge', 'agent-memory', role);
}

/**
 * BL-1815: persists the captured portable payload (BL-1177 schema 1) to
 * .swarmforge/agent-memory/<role>/payload.json, with `capturedAt`
 * (ISO-8601) merged into `handoffPack` rather than a schema change - so
 * BL-1816's own inject-side reader can judge freshness without a new
 * top-level field. Returns the path written, for a caller that wants to
 * report it.
 */
export function persistTrialBoundaryPayload(
  targetPath: string,
  role: string,
  payload: PortableAgentMemoryPayload,
  capturedAt: string
): string {
  const dir = agentMemoryDir(targetPath, role);
  fs.mkdirSync(dir, { recursive: true });
  const withCapturedAt: PortableAgentMemoryPayload = {
    ...payload,
    handoffPack: { ...(payload.handoffPack ?? {}), capturedAt },
  };
  const filePath = path.join(dir, 'payload.json');
  fs.writeFileSync(filePath, `${JSON.stringify(withCapturedAt, null, 2)}\n`, 'utf8');
  return filePath;
}

export type ModelSwitchWithMemoryResult = RespawnResult & {
  memoryCaptured?: boolean;
  memoryInjected?: boolean;
};

/** BL-235 hot-swap path: transfer memory, then perform the respawn/swap. */
export function attemptSameRoleModelSwitch(params: {
  role: string;
  outgoingState: CaptureNamedInputs;
  performSwap: () => RespawnResult;
  deps?: AgentMemoryTransferApi;
}): ModelSwitchWithMemoryResult {
  const transfer = runMemoryTransferForRole(params.role, params.outgoingState, params.deps);
  if (!transfer.ok) {
    return {
      success: false,
      message: `${MEMORY_TRANSFER_ABORT_PREFIX}: ${transfer.signal}`,
      memoryCaptured: transfer.captured,
      memoryInjected: false,
    };
  }
  const swap = params.performSwap();
  return {
    ...swap,
    memoryCaptured: true,
    memoryInjected: true,
  };
}
