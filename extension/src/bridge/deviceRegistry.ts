// BL-241: hardens BL-065's bridge auth layer (one static bearer token, no
// rotation/revocation/scoping) with a device registry - token
// issuance/rotation, per-device revocation, and a read-vs-control scope
// with a genuine step-up requirement for control actions. Pure/immutable
// (every mutator returns a new registry rather than mutating in place),
// so it stays trivially unit-testable without a live bridge or VS Code.
//
// Step-up design: a read-scoped device carries only `token` - the single
// credential BL-065's original model already had, and everything it can
// ever prove. A control-scoped device carries `token` AND a SEPARATE
// `controlToken`; control actions require presenting BOTH (the base token
// identifies the device, same as a read request; the control token is an
// additional secret a read-only client never has and a control device
// never needs for merely viewing) - a genuinely stronger auth step, not
// just the same credential re-checked (control-requires-step-up-04).

import * as crypto from 'crypto';

export type DeviceScope = 'read' | 'control';

export interface Device {
  id: string;
  label: string;
  scope: DeviceScope;
  token: string;
  // Only ever present for a control-scoped device - a read-scoped device
  // has no control token at all, so it can never satisfy the step-up
  // check no matter what it presents (read-only-cannot-control-03).
  controlToken?: string;
  revoked: boolean;
}

export interface DeviceRegistry {
  devices: Device[];
}

function randomHex(bytes: number): string {
  return crypto.randomBytes(bytes).toString('hex');
}

export function emptyRegistry(): DeviceRegistry {
  return { devices: [] };
}

export function registerDevice(registry: DeviceRegistry, label: string, scope: DeviceScope): { registry: DeviceRegistry; device: Device } {
  const device: Device = {
    id: randomHex(8),
    label,
    scope,
    token: randomHex(24),
    controlToken: scope === 'control' ? randomHex(24) : undefined,
    revoked: false,
  };
  return { registry: { devices: [...registry.devices, device] }, device };
}

// A revoked device is never removed from the registry - its id/label
// stays visible in the roster, only its ability to authenticate is
// switched off. Revoking an unknown device id is a no-op (idempotent,
// matches this module's general "never throw on a bad id" posture).
export function revokeDevice(registry: DeviceRegistry, deviceId: string): DeviceRegistry {
  return { devices: registry.devices.map((d) => (d.id === deviceId ? { ...d, revoked: true } : d)) };
}

export interface RotateResult {
  registry: DeviceRegistry;
  device: Device;
}

// Replaces ONLY the named device's token(s) with fresh ones - every other
// device's credentials are untouched (device-revocation-02's own
// "the others are unaffected" requirement applies equally to rotation).
// undefined for an unknown device id.
export function rotateDeviceToken(registry: DeviceRegistry, deviceId: string): RotateResult | undefined {
  const existing = registry.devices.find((d) => d.id === deviceId);
  if (!existing) {
    return undefined;
  }
  const rotated: Device = {
    ...existing,
    token: randomHex(24),
    controlToken: existing.scope === 'control' ? randomHex(24) : undefined,
  };
  return {
    registry: { devices: registry.devices.map((d) => (d.id === deviceId ? rotated : d)) },
    device: rotated,
  };
}

// Same timing-safe-length-then-compare posture as bridgeAuth.ts's own
// isAuthorizedRequest, generalized to search a list of candidate secrets
// instead of comparing against one.
function timingSafeEquals(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  return bufA.length === bufB.length && crypto.timingSafeEqual(bufA, bufB);
}

// Read auth: any non-revoked device (either scope) whose base token
// matches - unchanged from BL-065's original "one token, full read
// access" behavior, just generalized to a roster instead of one string.
export function findDeviceByToken(registry: DeviceRegistry, token: string | undefined): Device | undefined {
  if (!token) {
    return undefined;
  }
  return registry.devices.find((d) => !d.revoked && timingSafeEquals(d.token, token));
}

// Control auth (the step-up check): requires a non-revoked, control-scoped
// device whose base token AND separate control token both match. A
// read-scoped device (no controlToken) can never satisfy this regardless
// of what it presents.
export function findDeviceByControlToken(
  registry: DeviceRegistry,
  token: string | undefined,
  controlToken: string | undefined
): Device | undefined {
  if (!token || !controlToken) {
    return undefined;
  }
  return registry.devices.find(
    (d) =>
      !d.revoked &&
      d.scope === 'control' &&
      d.controlToken !== undefined &&
      timingSafeEquals(d.token, token) &&
      timingSafeEquals(d.controlToken, controlToken)
  );
}
