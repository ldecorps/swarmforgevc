// BL-713 (slice A of BL-712): Cursor identity certification and worktree binding.
//
// Split out of cursorSeatDriver.ts (BL-485 mutation-site advisory — this file
// was 360 sites). This half is the Model Steward registry domain: what an
// identity is, what the registry says about it, and whether that admits it
// onto a seat. It has no session, helper or handoff concerns.
//
// Invariant 3 (BL-713): an identity not certified in the registry cannot be
// selected for a production pack. Admission fails CLOSED — an absent,
// malformed or statusless registry entry is `unknown`, refused exactly like
// an explicit candidate.

import * as path from 'path';

// ── the spike-only escape ─────────────────────────────────────────────────

export const CURSOR_SEAT_SPIKE_ESCAPE_ENV = 'SWARMFORGE_CURSOR_SEAT_SPIKE';
export const CURSOR_SEAT_SPIKE_ESCAPE_VALUE = '1';

export const MODEL_STEWARD_REGISTRY_RELATIVE_PATH = '.swarmforge/model-steward/registry.json';

// Roles that live in the master checkout rather than their own worktree
// (Article 1: coordinator and specifier share master).
const MASTER_RESIDENT_ROLES = new Set(['coordinator', 'specifier']);

// ── identity and certification ────────────────────────────────────────────

export interface CursorIdentity {
  provider: string;
  model: string;
}

export type IdentityStatus = 'certified' | 'candidate' | 'retired' | 'unknown';

export type PackPosture = 'production' | 'spike';

export function identityKey(identity: CursorIdentity): string {
  return `${identity.provider}/${identity.model}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * The identity's status as the Model Steward registry records it. Fails
 * CLOSED at every step — an unreadable registry, a missing `models` map, an
 * absent entry, an entry with no `status`, or a status that is not one this
 * driver understands all report `unknown`, which admission refuses exactly
 * like a candidate. Absence must never buy certification.
 */
const KNOWN_IDENTITY_STATUSES = new Set(['certified', 'candidate', 'retired']);

function isKnownIdentityStatus(status: unknown): status is 'certified' | 'candidate' | 'retired' {
  return typeof status === 'string' && KNOWN_IDENTITY_STATUSES.has(status);
}

export function readIdentityStatus(registry: unknown, identity: CursorIdentity): IdentityStatus {
  if (!isRecord(registry)) {
    return 'unknown';
  }
  const models = registry.models;
  if (!isRecord(models)) {
    return 'unknown';
  }
  const entry = models[identityKey(identity)];
  if (!isRecord(entry)) {
    return 'unknown';
  }
  const status = entry.status;
  return isKnownIdentityStatus(status) ? status : 'unknown';
}

/**
 * Production unless the escape is set to its EXACT value. Every other value —
 * unset, empty, "0", "true", " 1" — is production, so a half-set or
 * misremembered escape never silently admits an uncertified identity.
 */
export function resolvePackPosture(env: NodeJS.ProcessEnv | Record<string, string | undefined>): PackPosture {
  return env[CURSOR_SEAT_SPIKE_ESCAPE_ENV] === CURSOR_SEAT_SPIKE_ESCAPE_VALUE ? 'spike' : 'production';
}

export interface AdmissionVerdict {
  admitted: boolean;
  reason: string;
}

export function admitCursorIdentity(opts: {
  identity: CursorIdentity;
  status: IdentityStatus;
  posture: PackPosture;
}): AdmissionVerdict {
  const key = identityKey(opts.identity);
  if (opts.status === 'certified') {
    return { admitted: true, reason: `${key} is certified in the model steward registry` };
  }
  if (opts.posture === 'spike') {
    return {
      admitted: true,
      reason:
        `${key} is not certified in the model steward registry (status: ${opts.status}); ` +
        `the spike-only escape ${CURSOR_SEAT_SPIKE_ESCAPE_ENV}=${CURSOR_SEAT_SPIKE_ESCAPE_VALUE} admits it for this spike run only`,
    };
  }
  return {
    admitted: false,
    reason:
      `${key} is not certified in the model steward registry (status: ${opts.status}), ` +
      `so it cannot staff a seat on a production pack. Certify it via the model steward, or set ` +
      `${CURSOR_SEAT_SPIKE_ESCAPE_ENV}=${CURSOR_SEAT_SPIKE_ESCAPE_VALUE} for a spike run.`,
  };
}

// ── worktree binding ──────────────────────────────────────────────────────

export function roleWorktreePath(repoRoot: string, role: string): string {
  return MASTER_RESIDENT_ROLES.has(role) ? repoRoot : path.join(repoRoot, '.worktrees', role);
}
