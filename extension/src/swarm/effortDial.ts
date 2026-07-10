// BL-236 (M5, "Suggest" tier only, depends on BL-235): per-role
// reasoning-effort suggestion + manual dial. The Adapt (auto-escalate on
// bounces) and Auto (apply within budget bounds) autonomy tiers are
// explicitly deferred - this only ever RECOMMENDS (suggestRoleEffort is a
// pure, side-effect-free computation; nothing changes until the operator
// explicitly calls switchRoleEffort) and lets the operator manually set an
// effort via a tile dial.
//
// switchRoleEffort reuses BL-235's exact mechanism (backendSwitch.ts):
// claude's settings file already carries "effortLevel" alongside "model"
// (swarmforge.sh's write_claude_settings_file writes both), so rewriting
// that field in place and respawning via the existing respawnAgent is
// enough - same in-memory-only, swarmforge.conf-untouched guarantee BL-235
// established. Same claude-only scope as BL-235 too: a role on a backend
// with no settings file (not claude-backed) has no effort setting to show
// or change (effort-unsupported-04) - hasEffortSetting mirrors the exact
// `agent === 'claude'` gate BL-235's own dropdown uses.

import * as fs from 'fs';
import * as path from 'path';
import { respawnAgent, RespawnResult } from './tmuxClient';

export const EFFORT_LEVELS = ['low', 'medium', 'high', 'xhigh'] as const;
export type EffortLevel = (typeof EFFORT_LEVELS)[number];

// Higher index = more reasoning effort - lets a suggestion comparison
// (design-heavy vs mechanical) be a plain numeric comparison.
export const EFFORT_ORDINAL: Record<EffortLevel, number> = { low: 0, medium: 1, high: 2, xhigh: 3 };

// BL-236: role demand tiers, per the ticket's own framing (specifier/
// architect are its named "design-heavy" examples -> higher; cleaner/
// documenter are its named "mechanical" examples -> lower) and this
// project's constitution Article 1 role definitions for the roles the
// ticket doesn't name explicitly: coordinator ("mechanical git/backlog
// steps" only, never domain code) and QA (runs the final procedural
// gate) are mechanical; coder and hardener sit in a neutral middle tier -
// judgment-heavy implementation/mutation-hardening work, but not the
// acceptance-criteria/architecture-review judgment specifier/architect own.
type DemandTier = 'design-heavy' | 'neutral' | 'mechanical';

const ROLE_DEMAND_TIER: Record<string, DemandTier> = {
  specifier: 'design-heavy',
  architect: 'design-heavy',
  coder: 'neutral',
  hardener: 'neutral',
  cleaner: 'mechanical',
  documenter: 'mechanical',
  QA: 'mechanical',
  coordinator: 'mechanical',
};

const TIER_SUGGESTED_EFFORT: Record<DemandTier, EffortLevel> = {
  'design-heavy': 'xhigh',
  neutral: 'high',
  mechanical: 'medium',
};

const TIER_RATIONALE: Record<DemandTier, string> = {
  'design-heavy': 'design-heavy role (architecture/acceptance-criteria judgment) suggests higher reasoning effort',
  neutral: 'implementation/mutation-hardening judgment suggests a mid-high reasoning effort',
  mechanical: 'mechanical role (procedural, low design judgment) suggests a lower reasoning effort',
};

export interface EffortSuggestion {
  role: string;
  suggestedEffort: EffortLevel;
  rationale: string;
}

// An unknown role name (not one of the 8 constitution roles) defaults to
// the neutral tier rather than throwing - advisory suggestions must never
// block a run over an unrecognized/custom role name.
export function suggestRoleEffort(role: string): EffortSuggestion {
  const tier = ROLE_DEMAND_TIER[role] ?? 'neutral';
  return {
    role,
    suggestedEffort: TIER_SUGGESTED_EFFORT[tier],
    rationale: `${role}: ${TIER_RATIONALE[tier]}`,
  };
}

export function suggestEffortForRoles(roles: readonly string[]): EffortSuggestion[] {
  return roles.map(suggestRoleEffort);
}

// Same backend-capability gate BL-235's model dropdown uses - only a
// claude-backed role's settings file carries an effortLevel field at all.
export function hasEffortSetting(agent: string): boolean {
  return agent === 'claude';
}

function claudeSettingsPath(targetPath: string, role: string): string {
  return path.join(targetPath, '.swarmforge', 'launch', `${role}.claude-settings.json`);
}

// The current effort for a claude-backed role, read from its own settings
// file - undefined when the role has no settings file yet.
export function readCurrentEffort(targetPath: string, role: string): EffortLevel | undefined {
  try {
    const parsed = JSON.parse(fs.readFileSync(claudeSettingsPath(targetPath, role), 'utf8'));
    return EFFORT_LEVELS.includes(parsed.effortLevel) ? (parsed.effortLevel as EffortLevel) : undefined;
  } catch {
    return undefined;
  }
}

// Rewrites role's settings-file effortLevel in place, preserving every
// other field (model, permissions, etc.) unchanged, then respawns that ONE
// role's pane via the existing respawnAgent - never touches any other
// role, never touches swarmforge.conf. Mirrors backendSwitch.ts's
// switchRoleModel exactly, operating on effortLevel instead of model.
export function switchRoleEffort(targetPath: string, role: string, effort: string): RespawnResult {
  if (!(EFFORT_LEVELS as readonly string[]).includes(effort)) {
    return { success: false, message: `Unknown effort "${effort}" - expected one of: ${EFFORT_LEVELS.join(', ')}` };
  }
  const settingsPath = claudeSettingsPath(targetPath, role);
  let settings: Record<string, unknown>;
  try {
    settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
  } catch {
    return { success: false, message: `No claude settings file found for role "${role}" at ${settingsPath}` };
  }
  settings.effortLevel = effort;
  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n');
  return respawnAgent(targetPath, role);
}
