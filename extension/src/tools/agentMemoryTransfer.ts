/**
 * BL-1177: agentMemoryTransfer — capture + inject portable payload API for
 * same-role model swap. Emits a schema-versioned portable payload (never a
 * vendor-opaque blob as the only artifact).
 */

export const AGENT_MEMORY_PAYLOAD_SCHEMA_VERSION = 1;

export interface CaptureNamedInputs {
  role: string;
  transcriptSummary: string;
  openParcelIds: readonly string[];
  handoffPack?: Record<string, unknown>;
  toolStatePointers?: readonly string[];
}

export interface PortableAgentMemoryPayload {
  /** portable payload discriminator for BL-1177 continuity transfer */
  kind: 'portable-agent-memory-payload';
  schemaVersion: number;
  role: string;
  continuitySummary: string;
  openParcelContext: {
    openParcelIds: string[];
  };
  handoffPack?: Record<string, unknown>;
  toolStatePointers?: string[];
}

export type InjectAgentMemoryResult =
  | {
      ok: true;
      role: string;
      openParcelContext: { openParcelIds: string[] };
      continuitySummary: string;
      pretendedContinuity: false;
    }
  | {
      ok: false;
      signal: string;
      pretendedContinuity: false;
    };

function normalizeRole(role: string): string {
  return role.trim().toLowerCase();
}

function normalizeParcelIds(ids: readonly string[]): string[] {
  return [...ids]
    .map((id) => id.trim())
    .filter(Boolean)
    .sort();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readOpenParcelIds(raw: unknown): string[] | null {
  if (!isRecord(raw)) {
    return null;
  }
  const ids = raw.openParcelIds;
  if (!Array.isArray(ids) || !ids.every((id) => typeof id === 'string')) {
    return null;
  }
  return normalizeParcelIds(ids);
}

/** Pure aggregation over named capture inputs — unit-testable without a live agent. */
export function aggregateCapturePayload(inputs: CaptureNamedInputs): PortableAgentMemoryPayload {
  return {
    kind: 'portable-agent-memory-payload',
    schemaVersion: AGENT_MEMORY_PAYLOAD_SCHEMA_VERSION,
    role: normalizeRole(inputs.role),
    continuitySummary: inputs.transcriptSummary.trim(),
    openParcelContext: {
      openParcelIds: normalizeParcelIds(inputs.openParcelIds),
    },
    ...(inputs.handoffPack ? { handoffPack: inputs.handoffPack } : {}),
    ...(inputs.toolStatePointers?.length
      ? { toolStatePointers: [...inputs.toolStatePointers] }
      : {}),
  };
}

export function validatePortablePayload(raw: unknown): PortableAgentMemoryPayload | null {
  if (!isRecord(raw)) {
    return null;
  }
  if (raw.schemaVersion !== AGENT_MEMORY_PAYLOAD_SCHEMA_VERSION) {
    return null;
  }
  if (typeof raw.role !== 'string' || !raw.role.trim()) {
    return null;
  }
  if (typeof raw.continuitySummary !== 'string') {
    return null;
  }
  const openParcelIds = readOpenParcelIds(raw.openParcelContext);
  if (!openParcelIds) {
    return null;
  }
  return {
    kind: 'portable-agent-memory-payload',
    schemaVersion: AGENT_MEMORY_PAYLOAD_SCHEMA_VERSION,
    role: normalizeRole(raw.role),
    continuitySummary: raw.continuitySummary.trim(),
    openParcelContext: { openParcelIds },
    ...(isRecord(raw.handoffPack) ? { handoffPack: raw.handoffPack } : {}),
    ...(Array.isArray(raw.toolStatePointers) &&
    raw.toolStatePointers.every((p) => typeof p === 'string')
      ? { toolStatePointers: [...(raw.toolStatePointers as string[])] }
      : {}),
  };
}

export function capture(outgoingState: CaptureNamedInputs): { payload: PortableAgentMemoryPayload } {
  return { payload: aggregateCapturePayload(outgoingState) };
}

export function inject(role: string, rawPayload: unknown): InjectAgentMemoryResult {
  if (rawPayload === null || rawPayload === undefined) {
    return {
      ok: false,
      signal: 'inject refused: portable memory payload is missing — fail closed',
      pretendedContinuity: false,
    };
  }
  const payload = validatePortablePayload(rawPayload);
  if (!payload) {
    return {
      ok: false,
      signal: 'inject refused: portable memory payload is malformed — fail closed',
      pretendedContinuity: false,
    };
  }
  const targetRole = normalizeRole(role);
  if (payload.role !== targetRole) {
    return {
      ok: false,
      signal: `inject refused: payload role "${payload.role}" does not match target role "${targetRole}" — fail closed`,
      pretendedContinuity: false,
    };
  }
  return {
    ok: true,
    role: targetRole,
    openParcelContext: payload.openParcelContext,
    continuitySummary: payload.continuitySummary,
    pretendedContinuity: false,
  };
}

/** agentMemoryTransfer namespace for wiring and BL-1178 hot-swap integration. */
export const agentMemoryTransfer = {
  capture,
  inject,
};
