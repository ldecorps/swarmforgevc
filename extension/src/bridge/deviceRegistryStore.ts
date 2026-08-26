// BL-241: persists the device registry in VS Code SecretStorage only -
// same secrets rule as notify/secrets.ts's RESEND/OPENAI/MISTRAL keys:
// never the target working directory, never a commit. Persistence (not
// the original BL-065 model's "fresh token every bridge start") is what
// makes revocation actually mean something: a revoked device must stay
// revoked across restarts, not just for the current process's lifetime.

import * as vscode from 'vscode';
import { DeviceRegistry, emptyRegistry } from './deviceRegistry';

export const DEVICE_REGISTRY_SECRET_KEY = 'swarmforge.bridgeDeviceRegistry';

// A missing or corrupt stored value reads as an empty registry rather than
// throwing - the same defensive-read posture translationCache.ts/
// backlogReader.ts already use for other on-disk/stored state in this
// codebase, so a first run (nothing stored yet) or a manually-edited
// SecretStorage entry never crashes the bridge.
export async function readDeviceRegistry(secrets: vscode.SecretStorage): Promise<DeviceRegistry> {
  const raw = await secrets.get(DEVICE_REGISTRY_SECRET_KEY);
  if (!raw) {
    return emptyRegistry();
  }
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed?.devices) ? (parsed as DeviceRegistry) : emptyRegistry();
  } catch {
    return emptyRegistry();
  }
}

export async function writeDeviceRegistry(secrets: vscode.SecretStorage, registry: DeviceRegistry): Promise<void> {
  await secrets.store(DEVICE_REGISTRY_SECRET_KEY, JSON.stringify(registry));
}
