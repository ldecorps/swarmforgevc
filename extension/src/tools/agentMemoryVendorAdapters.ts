/**
 * BL-1179 (epic BL-1176): cross-vendor memory adapters + explicit unsupported
 * matrix. BL-1177's portable payload is already vendor-agnostic, so a
 * "supported" pair needs no second format — it transfers through
 * agentMemoryHotSwap's existing capture/inject exactly as a same-vendor swap
 * does (invariant 2). What this slice adds is the per-runtime adapter table
 * that decides WHICH pairs may attempt that at all, and refuses the rest with
 * a named reason instead of a silent no-op (invariant 1).
 */
import { normalizeAgentToken } from '../swarm/acpSeatLaunch';
import {
  agentMemoryTransfer,
  CaptureNamedInputs,
} from './agentMemoryTransfer';
import { AgentMemoryTransferApi, MemoryTransferOutcome, runMemoryTransferForRole } from './agentMemoryHotSwap';

export interface RuntimeMemoryAdapter {
  runtime: string;
  /** Whether this runtime can participate in a portable-payload memory transfer at all. */
  supported: boolean;
  /** Required when supported is false — invariant 1 forbids an unnamed refusal. */
  reason?: string;
}

// Every agent token prompt-engine-lib's own provider-capabilities table
// recognises (swarmforge/scripts/prompt_engine_lib.bb). Two are unsupported
// as EITHER side of a memory transfer:
//   - aider: a file-editor CLI, not a chat/session-continuity agent — each
//     invocation starts from a fresh prompt built from `--message`/file
//     mentions, with no mechanism to receive an injected prior-context
//     payload (prompt_engine_lib.bb's own comment: "a file editor that
//     cannot execute").
//   - mock: a test-only stub runtime, never a real memory participant.
export const RUNTIME_MEMORY_ADAPTERS: readonly RuntimeMemoryAdapter[] = [
  { runtime: 'claude', supported: true },
  { runtime: 'codex', supported: true },
  { runtime: 'copilot', supported: true },
  { runtime: 'grok', supported: true },
  { runtime: 'vibe', supported: true },
  { runtime: 'gemini', supported: true },
  { runtime: 'cursor', supported: true },
  { runtime: 'local-model', supported: true },
  {
    runtime: 'aider',
    supported: false,
    reason:
      'aider is a file-editor CLI with no session/transcript continuity mechanism to inject a portable payload into — every invocation starts from a fresh prompt',
  },
  { runtime: 'mock', supported: false, reason: 'mock is a test-only stub runtime, never a real memory participant' },
];

/** The adapter entry for a runtime token, or a fail-closed unsupported entry for an unrecognised one. */
export function runtimeMemoryAdapter(runtime: string): RuntimeMemoryAdapter {
  const normalized = normalizeAgentToken(runtime);
  const found = RUNTIME_MEMORY_ADAPTERS.find((a) => a.runtime === normalized);
  if (found) {
    return found;
  }
  return {
    runtime: normalized,
    supported: false,
    reason: `unrecognised runtime "${normalized}" is not in the memory-adapter table — fail closed`,
  };
}

/**
 * The matrix reason a vendor pair cannot transfer, or null when both sides
 * support it. Naming which side(s) refuse is what makes the refusal a
 * signal rather than a bare no (invariant 1).
 */
export function vendorPairUnsupportedReason(outgoingRuntime: string, incomingRuntime: string): string | null {
  const out = runtimeMemoryAdapter(outgoingRuntime);
  const inc = runtimeMemoryAdapter(incomingRuntime);
  if (!out.supported && !inc.supported) {
    return `neither ${out.runtime} (${out.reason}) nor ${inc.runtime} (${inc.reason}) supports memory transfer`;
  }
  if (!out.supported) {
    return `${out.runtime} does not support memory transfer as the outgoing runtime: ${out.reason}`;
  }
  if (!inc.supported) {
    return `${inc.runtime} does not support memory transfer as the incoming runtime: ${inc.reason}`;
  }
  return null;
}

export function isSupportedVendorPair(outgoingRuntime: string, incomingRuntime: string): boolean {
  return vendorPairUnsupportedReason(outgoingRuntime, incomingRuntime) === null;
}

export interface UnsupportedVendorPair {
  outgoing: string;
  incoming: string;
  reason: string;
}

/**
 * Every unsupported pair among the known runtime table, queryable without
 * performing a live swap (qa_e2e_procedure step 3). Derived from the
 * per-runtime adapter table above, never hand-maintained as a second list —
 * a runtime's support flag changes in exactly one place.
 */
export function unsupportedVendorMatrix(): UnsupportedVendorPair[] {
  const pairs: UnsupportedVendorPair[] = [];
  for (const outgoing of RUNTIME_MEMORY_ADAPTERS) {
    for (const incoming of RUNTIME_MEMORY_ADAPTERS) {
      if (outgoing.runtime === incoming.runtime) {
        continue;
      }
      const reason = vendorPairUnsupportedReason(outgoing.runtime, incoming.runtime);
      if (reason) {
        pairs.push({ outgoing: outgoing.runtime, incoming: incoming.runtime, reason });
      }
    }
  }
  return pairs;
}

/**
 * The cross-vendor entry point: refuses an unsupported pair with a named
 * matrix reason (invariant 1); a supported pair delegates to
 * runMemoryTransferForRole unchanged — the same BL-1177 capture/inject a
 * same-vendor swap already uses, never a second ad-hoc format (invariant 2).
 */
export function transferMemoryAcrossVendors(
  outgoingRuntime: string,
  incomingRuntime: string,
  role: string,
  outgoingState: CaptureNamedInputs,
  deps: AgentMemoryTransferApi = agentMemoryTransfer
): MemoryTransferOutcome {
  const reason = vendorPairUnsupportedReason(outgoingRuntime, incomingRuntime);
  if (reason) {
    return {
      ok: false,
      captured: false,
      injected: false,
      signal: `unsupported vendor pair (${normalizeAgentToken(outgoingRuntime)} → ${normalizeAgentToken(incomingRuntime)}): ${reason}`,
    };
  }
  return runMemoryTransferForRole(role, outgoingState, deps);
}
