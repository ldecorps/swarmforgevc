// BL-235 (M5, roadmap gap #1 - narrow slice): per-tile model switch for
// claude-backed roles only. The ticket's full scope (cross-backend switch,
// e.g. claude <-> codex <-> an in-process vscode.lm runtime) is deferred:
// it would require porting swarmforge.sh's write_role_launch_script - a
// ~100-line per-agent CLI-construction case-statement covering 5 different
// agent CLIs' exact flags, including a documented past secrets-handling
// incident (an API key nearly written to disk) - into TypeScript. None of
// that exists yet in extension/src despite the ticket's premise that a
// TS-side "InteractiveProcess"/backend abstraction is already landed (BL-130/
// 142/206-208 only landed bash-side agent capability flags and a TS error
// taxonomy, not a launch-command builder); "vscode.lm" appears nowhere in
// this codebase outside aspirational Spec.MD prose. Operator-confirmed
// 2026-07-10: ship the safe same-agent slice now, defer the rest.
//
// A same-agent MODEL switch needs none of that porting - claude's launch
// script already points at a fixed-path settings file that this module
// rewrites one field of and respawns via, per claudeSettingsFile.ts (the
// read/write/respawn plumbing shared with effortDial.ts's effort switch).

import { PRICING_TABLE } from '../metrics/pricingTable';
import { RespawnResult } from './tmuxClient';
import { readClaudeSettingsField, writeClaudeSettingsFieldAndRespawn } from './claudeSettingsFile';

// The dropdown's available-models list is the SAME versioned catalog cost
// estimation already uses - one list, not a second copy that could drift.
export const AVAILABLE_CLAUDE_MODELS: readonly string[] = Object.keys(PRICING_TABLE);

// The current model for a claude-backed role, read from its own settings
// file - the same file the running agent itself reads, so this is always
// the true current value, never a separately-tracked value that could go
// stale. undefined when the role has no settings file yet (not launched,
// or not a claude-backed role).
export function readCurrentModel(targetPath: string, role: string): string | undefined {
  const model = readClaudeSettingsField(targetPath, role, 'model');
  return typeof model === 'string' ? model : undefined;
}

// Rewrites role's settings-file model in place, preserving every other
// field (effortLevel, permissions, etc.) unchanged, then respawns that ONE
// role's pane - never touches any other role, never touches swarmforge.conf.
export function switchRoleModel(targetPath: string, role: string, model: string): RespawnResult {
  if (!AVAILABLE_CLAUDE_MODELS.includes(model)) {
    return { success: false, message: `Unknown model "${model}" - expected one of: ${AVAILABLE_CLAUDE_MODELS.join(', ')}` };
  }
  return writeClaudeSettingsFieldAndRespawn(targetPath, role, 'model', model);
}
