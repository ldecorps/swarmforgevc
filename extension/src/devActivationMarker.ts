import * as fs from 'fs';
import * as path from 'path';

/**
 * Activation marker for the dev-host bounce script (BL-058).
 *
 * When the extension activates in Development extension mode, it drops a small
 * JSON marker into the extension repo so scripts/start-extension-dev.sh can
 * verify a fresh activation instead of trusting a blind delay. The path is
 * gitignored; production activation never writes it, so user repos stay clean.
 */
export const DEV_ACTIVATION_MARKER_FILENAME = '.dev-activation.json';

export interface ActivationMarker {
  activatedAt: string;
  pid: number;
}

export function maybeWriteActivationMarker(
  isDevelopmentMode: boolean,
  extensionPath: string,
  pid: number = process.pid,
  now: Date = new Date()
): string | null {
  if (!isDevelopmentMode) {
    return null;
  }
  const markerPath = path.join(extensionPath, DEV_ACTIVATION_MARKER_FILENAME);
  const marker: ActivationMarker = { activatedAt: now.toISOString(), pid };
  try {
    fs.writeFileSync(markerPath, JSON.stringify(marker) + '\n');
    return markerPath;
  } catch {
    // The marker only serves the bounce script; a failed write must never
    // break activation. The script reports the missing fresh marker loudly.
    return null;
  }
}
