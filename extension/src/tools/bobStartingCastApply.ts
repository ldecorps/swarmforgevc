/**
 * BL-1181: BoB starting cast apply — ModelFactory overlay + agent-memory transfer.
 */

import {
  agentMemoryTransfer,
  CaptureNamedInputs,
} from './agentMemoryTransfer';

export type AgentMemoryTransferApi = Pick<typeof agentMemoryTransfer, 'capture' | 'inject'>;

export type BobCastRoleEntry = {
  role: string;
  provider: string;
  model: string;
  agent: string;
  policy?: string;
  reason?: string;
};

export type BobCastExport = {
  kind: 'bob-starting-cast';
  schemaVersion: number;
  roles: Record<string, BobCastRoleEntry>;
};

export type OverlayWriterResult = {
  via: 'model-factory-overlay' | 'pack-model-apply';
  overlayPath?: string;
};

export type ApplyBobCastResult =
  | { ok: true; via: OverlayWriterResult['via']; memoryTransferred: string[] }
  | { ok: false; role?: string; signal: string };

export function rolesWithModelChange(
  cast: BobCastExport,
  currentModels: Readonly<Record<string, string | undefined>>
): string[] {
  return Object.keys(cast.roles).filter((role) => {
    const next = cast.roles[role]?.model;
    const current = currentModels[role];
    return Boolean(next && current !== next);
  });
}

export function runMemoryTransferForChangedRoles(
  cast: BobCastExport,
  currentModels: Readonly<Record<string, string | undefined>>,
  outgoingByRole: Readonly<Record<string, CaptureNamedInputs>>,
  deps: AgentMemoryTransferApi = agentMemoryTransfer
): { ok: true; transferred: string[] } | { ok: false; role: string; signal: string } {
  const changed = rolesWithModelChange(cast, currentModels);
  for (const role of changed) {
    const outgoing = outgoingByRole[role];
    if (!outgoing) {
      continue;
    }
    const { payload } = deps.capture(outgoing);
    const injected = deps.inject(role, payload);
    if (!injected.ok) {
      return { ok: false, role, signal: injected.signal };
    }
  }
  return { ok: true, transferred: changed };
}

export function applyBobCast(params: {
  cast: BobCastExport;
  currentModels: Readonly<Record<string, string | undefined>>;
  outgoingByRole: Readonly<Record<string, CaptureNamedInputs>>;
  writeOverlay: (assignment: Record<string, BobCastRoleEntry>) => OverlayWriterResult;
  deps?: AgentMemoryTransferApi;
}): ApplyBobCastResult {
  const memory = runMemoryTransferForChangedRoles(
    params.cast,
    params.currentModels,
    params.outgoingByRole,
    params.deps
  );
  if (!memory.ok) {
    return { ok: false, role: memory.role, signal: memory.signal };
  }
  const applied = params.writeOverlay(params.cast.roles);
  return { ok: true, via: applied.via, memoryTransferred: memory.transferred };
}

/** Guard: assignment must go through ModelFactory overlay or pack apply only. */
export function assertKnownApplyPath(via: string): void {
  if (via !== 'model-factory-overlay' && via !== 'pack-model-apply') {
    throw new Error(`unknown BoB cast apply path: ${via}`);
  }
}
