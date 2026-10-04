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

import * as fs from 'fs';
import * as path from 'path';
import { PRICING_TABLE } from '../metrics/pricingTable';
import { RespawnResult } from './tmuxClient';
import { readClaudeSettingsField, writeClaudeSettingsFieldAndRespawn } from './claudeSettingsFile';
import {
  attemptSameRoleModelSwitch,
  buildOutgoingCaptureState,
} from '../tools/agentMemoryHotSwap';

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

// Checked in order; the first match wins. BL-1858's qwen entry must stay
// ahead of claude: every launch script (Claude ones too) sources
// qwen_launch_guard_lib.sh, so a bare \bqwen\b would match a claude seat -
// anchoring at line start to the actual command line avoids that.
const LAUNCH_SCRIPT_AGENT_PATTERNS: ReadonlyArray<readonly [RegExp, string]> = [
  [/\bcursor-agent\b/, 'cursor'],
  [/\bcopilot\b/, 'copilot'],
  [/\bcodex\b/, 'codex'],
  [/\baider\b/, 'aider'],
  [/\bgemini\b/, 'gemini'],
  [/\bvibe\b/, 'vibe'],
  [/\bgrok\b/, 'grok'],
  [/^\s*qwen\s/m, 'qwen'],
  [/\bclaude\b/, 'claude'],
];

function detectLaunchScriptAgent(script: string): string | undefined {
  for (const [pattern, agent] of LAUNCH_SCRIPT_AGENT_PATTERNS) {
    if (pattern.test(script)) {
      return agent;
    }
  }
  return undefined;
}

// copilot and cursor both print a bare "auto" --model value that only means
// something once namespaced to the agent that emitted it.
const AUTO_MODEL_AGENTS: ReadonlySet<string> = new Set(['copilot', 'cursor']);

function resolveAutoModelAlias(model: string | undefined, agent: string | undefined): string | undefined {
  if (model === 'auto' && agent !== undefined && AUTO_MODEL_AGENTS.has(agent)) {
    return `${agent}/auto`;
  }
  return model;
}

// BL-1858 D1: since BL-1850 the launch script's FIRST --model belongs to
// the local-seat settings snapshot CLI (a quoted tag), not the agent.
// Returns the detected agent's own command line (its FIRST match, in script
// order), or undefined when the agent has no recognizable line of its own -
// the caller then falls back to matching --model over the whole script.
function findAgentCommandLine(script: string, agent: string | undefined): string | undefined {
  // .find() safely returns undefined when agent is undefined; no separate
  // guard needed.
  const agentPattern = LAUNCH_SCRIPT_AGENT_PATTERNS.find(([, a]) => a === agent)?.[0];
  if (agentPattern === undefined) {
    return undefined;
  }
  for (const line of script.split('\n')) {
    if (agentPattern.test(line)) {
      return line;
    }
  }
  return undefined;
}

// A --model value may be shell-quoted on the agent's own command line
// (e.g. the snapshot-CLI line BL-1850 added); strip one leading and one
// trailing quote char. Unquoted values (the common case) pass through.
function stripShellQuotes(value: string): string {
  return value.replace(/^['"]|['"]$/g, '');
}

// Non-Claude seats (aider / cursor-agent / …) encode the live model in the
// launch script's --model flag; that is ground truth for what tmux is actually
// running. Stale *.claude-settings.json files may remain from prior
// Claude-backed launches and must not win the header label.
function readLaunchScriptModel(
  targetPath: string,
  role: string
): { model?: string; prefersLaunchOverClaudeSettings: boolean } {
  try {
    const script = fs.readFileSync(
      path.join(targetPath, '.swarmforge', 'launch', `${role}.sh`),
      'utf8'
    );
    const agent = detectLaunchScriptAgent(script);
    const prefersLaunchOverClaudeSettings = agent !== undefined && agent !== 'claude';
    const modelLine = findAgentCommandLine(script, agent);
    const match = (modelLine ?? script).match(/--model\s+(\S+)/);
    const rawModel = match?.[1];
    const model = resolveAutoModelAlias(
      rawModel !== undefined ? stripShellQuotes(rawModel) : undefined,
      agent
    );
    return { model, prefersLaunchOverClaudeSettings };
  } catch {
    return { prefersLaunchOverClaudeSettings: false };
  }
}

function readConfiguredModelFromConf(targetPath: string, role: string): string | undefined {
  try {
    const conf = fs.readFileSync(path.join(targetPath, 'swarmforge', 'swarmforge.conf'), 'utf8');
    for (const line of conf.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('window ')) {
        continue;
      }
      const parts = trimmed.split(/\s+/);
      if (parts[1] !== role) {
        continue;
      }
      const match = trimmed.match(/--model\s+(\S+)/);
      return match?.[1];
    }
  } catch {
    // no conf or unreadable
  }
  return undefined;
}

// Non-Claude launch script first (ignores stale claude settings from prior
// backends), then live claude settings file, then launch script --model for
// other agents, then swarmforge.conf's window line as a last-resort fallback.
// BL-1858 D3: a non-Claude launch script that names NO --model is ground
// truth for "no model" - the seat runs whatever its agent's default is, and
// a stale *.claude-settings.json from a prior Claude-backed launch must not
// win the tile label. Only when the launch script is absent or unreadable
// do we fall through to the Claude settings file.
export function readRoleModelId(targetPath: string, role: string): string | undefined {
  const launch = readLaunchScriptModel(targetPath, role);
  if (launch.prefersLaunchOverClaudeSettings) {
    return launch.model ?? readConfiguredModelFromConf(targetPath, role);
  }
  return (
    readCurrentModel(targetPath, role) ??
    launch.model ??
    readConfiguredModelFromConf(targetPath, role)
  );
}

// Rewrites role's settings-file model in place, preserving every other
// field (effortLevel, permissions, etc.) unchanged, then respawns that ONE
// role's pane - never touches any other role, never touches swarmforge.conf.
export function switchRoleModel(targetPath: string, role: string, model: string): RespawnResult {
  if (!AVAILABLE_CLAUDE_MODELS.includes(model)) {
    return { success: false, message: `Unknown model "${model}" - expected one of: ${AVAILABLE_CLAUDE_MODELS.join(', ')}` };
  }
  const outgoingState = buildOutgoingCaptureState(targetPath, role);
  return attemptSameRoleModelSwitch({
    role,
    outgoingState,
    performSwap: () => writeClaudeSettingsFieldAndRespawn(targetPath, role, 'model', model),
  });
}
