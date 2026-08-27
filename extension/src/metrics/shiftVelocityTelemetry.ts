import * as fs from 'fs';
import * as path from 'path';

export const SHIFT_VELOCITY_LOG_BASENAME = 'shift-velocity.jsonl';

export function shiftVelocityLogPath(repoRoot: string): string {
  return path.join(repoRoot, '.swarmforge', 'telemetry', SHIFT_VELOCITY_LOG_BASENAME);
}

export interface ShiftVelocityRecordingConfig {
  path: string;
  created: boolean;
  reused: boolean;
}

function isShiftVelocityTelemetryPath(filePath: string): boolean {
  return path.basename(filePath) === SHIFT_VELOCITY_LOG_BASENAME;
}

export function configureShiftVelocityRecording(
  repoRoot: string,
  existingPaths: string[] = []
): ShiftVelocityRecordingConfig {
  const existing = existingPaths.find(isShiftVelocityTelemetryPath);
  if (existing) {
    return { path: existing, created: false, reused: true };
  }
  const target = shiftVelocityLogPath(repoRoot);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const created = !fs.existsSync(target);
  if (created) {
    fs.writeFileSync(target, '', 'utf8');
  }
  return { path: target, created, reused: false };
}
