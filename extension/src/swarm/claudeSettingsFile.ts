// Shared read/write plumbing for a claude-backed role's runtime settings
// file (.swarmforge/launch/<role>.claude-settings.json, written once at
// swarm launch by swarmforge.sh's write_claude_settings_file). claude's
// launch script points at this file by a fixed path and passes it to the
// CLI via `--settings`, so rewriting one field in place and respawning via
// the existing respawnAgent (tmuxClient.ts) is enough to apply a change -
// swarmforge.conf and the launch script itself are never touched. The
// settings file is already runtime-only, gitignored state regenerated at
// every swarm launch, not the config file the "in-memory, never persisted"
// constraint means.
//
// Factored out of backendSwitch.ts (BL-235's model switch) once
// effortDial.ts (BL-236's effort switch) needed the exact same
// read-field/write-field-and-respawn shape for a different field.

import * as fs from 'fs';
import * as path from 'path';
import { respawnAgent, RespawnResult } from './tmuxClient';

export function claudeSettingsPath(targetPath: string, role: string): string {
  return path.join(targetPath, '.swarmforge', 'launch', `${role}.claude-settings.json`);
}

// Reads one field from role's settings file - undefined when the role has
// no settings file yet (not launched, or not a claude-backed role) or the
// field is absent, never a thrown error.
export function readClaudeSettingsField(targetPath: string, role: string, field: string): unknown {
  try {
    const parsed = JSON.parse(fs.readFileSync(claudeSettingsPath(targetPath, role), 'utf8'));
    return parsed[field];
  } catch {
    return undefined;
  }
}

// Rewrites one field of role's settings file in place, preserving every
// other field unchanged, then respawns that ONE role's pane via the
// existing respawnAgent - never touches any other role.
export function writeClaudeSettingsFieldAndRespawn(targetPath: string, role: string, field: string, value: string): RespawnResult {
  const settingsPath = claudeSettingsPath(targetPath, role);
  let settings: Record<string, unknown>;
  try {
    settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
  } catch {
    return { success: false, message: `No claude settings file found for role "${role}" at ${settingsPath}` };
  }
  settings[field] = value;
  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n');
  return respawnAgent(targetPath, role);
}
