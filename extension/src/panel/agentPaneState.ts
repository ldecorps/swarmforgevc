// BL-142 slice 1: pane-state detection driven by a provider-descriptor
// registry instead of inline brand names/patterns. Behavior is unchanged
// for every currently-supported provider (claude/aider/codex/copilot/grok);
// adding a provider means adding a descriptor here, with no edits to the
// detection functions below.
export interface ProviderDescriptor {
  name: string;
  /** Matches the pane's running command (basename or full path) for this provider. */
  cliPattern: RegExp;
  /** Matches pane text indicating this provider is actively busy/working (not every provider has one). */
  busyPattern?: RegExp;
  /** Matches this provider's own startup banner text (not every provider has one). */
  bannerPattern?: RegExp;
  /** Human-facing name for the "waiting to start" / "agent not running" messages. */
  startupCopy: string;
}

export const PROVIDER_DESCRIPTORS: ProviderDescriptor[] = [
  { name: 'claude', cliPattern: /(?:^|\/)claude$/, startupCopy: 'Claude' },
  {
    name: 'aider',
    // Looser than the other providers' exact-basename match, preserved
    // from the pre-refactor behavior: a command containing "aider"
    // anywhere (e.g. a wrapper script name) still counts.
    cliPattern: /aider/i,
    busyPattern: /(?:Applying edits|Searching|Summariz|Generating|Tokens:\s*\d)/i,
    bannerPattern: /\bAider v\d/,
    startupCopy: 'Aider',
  },
  { name: 'codex', cliPattern: /(?:^|\/)codex$/, startupCopy: 'Codex' },
  { name: 'copilot', cliPattern: /(?:^|\/)copilot$/, startupCopy: 'Copilot' },
  { name: 'grok', cliPattern: /(?:^|\/)grok$/, startupCopy: 'Grok' },
];

const DEFAULT_PROVIDER_NAME = 'claude';

export function findProviderDescriptor(name: string | undefined): ProviderDescriptor | undefined {
  if (!name) {
    return undefined;
  }
  return PROVIDER_DESCRIPTORS.find((d) => d.name === name.toLowerCase());
}

// Generic interactive-agent UI chrome - not tied to any one provider brand,
// so these stay as-is (no descriptor needed).
const SWARMFORGE_ROLE = /SwarmForge \w+/i;
const PERMISSION_MODE = /bypass permissions|auto mode|accept edits|dont ask|plan mode/i;
const UI_MARKERS = /shift\+tab to cycle|esc to interrupt/i;
const DIVIDER_AND_PROMPT = /─{3,}/;
const ARROW_MARKER = /❯/;

// "esc to interrupt" is Claude Code's own busy/generating footer, shown only
// while a turn is actively in flight - unlike "shift+tab to cycle", which
// appears on the idle prompt too. BL-137: a forced respawn was typed into a
// coordinator pane that was genuinely mid-turn (the caller's liveness signal
// was stale/misjudged); this is the narrow, high-confidence positive check a
// fresh pane capture can make right before injecting a respawn command, to
// refuse doing so into a pane that is provably not stuck.
const ACTIVELY_PROCESSING = /esc to interrupt/i;

export function isPaneActivelyProcessing(paneText: string): boolean {
  return ACTIVELY_PROCESSING.test(paneText);
}

export function isAgentActivelyWorking(paneCommand: string, paneText: string): boolean {
  if (isPaneActivelyProcessing(paneText)) {
    return true;
  }
  const cmd = paneCommand.toLowerCase();
  const descriptor = PROVIDER_DESCRIPTORS.find((d) => d.cliPattern.test(cmd));
  if (descriptor?.busyPattern?.test(paneText)) {
    return true;
  }
  return false;
}

export function isClaudeAgentRunning(
  paneCommand: string,
  paneText: string
): boolean {
  return isAgentCliRunning(paneCommand, paneText);
}

// Independent pane-text signals that each, alone, indicate an agent CLI is
// running: any one matching is sufficient. A data-driven list rather than a
// cascade of if-statements keeps isAgentCliRunning itself at a single
// decision point per signal source (CRAP<=6 gate), matching the same
// registry-driven spirit as PROVIDER_DESCRIPTORS above.
const TEXT_RUNNING_SIGNALS: Array<(text: string) => boolean> = [
  (text) => SWARMFORGE_ROLE.test(text),
  (text) => PERMISSION_MODE.test(text),
  (text) => UI_MARKERS.test(text),
  (text) => DIVIDER_AND_PROMPT.test(text) && ARROW_MARKER.test(text),
  (text) => PROVIDER_DESCRIPTORS.some((d) => d.bannerPattern?.test(text)),
  (text) => PROVIDER_DESCRIPTORS.some((d) => d.busyPattern?.test(text)),
];

export function isAgentCliRunning(
  paneCommand: string,
  paneText: string
): boolean {
  const cmd = paneCommand.trim();
  if (PROVIDER_DESCRIPTORS.some((d) => d.cliPattern.test(cmd))) {
    return true;
  }

  const text = paneText.trim();
  if (!text) {
    return false;
  }

  return TEXT_RUNNING_SIGNALS.some((matches) => matches(text));
}

// Split out of isShellOnlyPane so its own complexity stays under the
// CRAP<=6 gate (mirrors TEXT_RUNNING_SIGNALS' extraction above) - no
// behavior change, same four command shapes recognized as a bare shell.
function isShellCommandName(cmd: string): boolean {
  return cmd === 'bash' || cmd === 'zsh' || cmd === '-zsh' || cmd.endsWith('/bash') || cmd.endsWith('/zsh');
}

export function isShellOnlyPane(
  paneCommand: string,
  paneText: string
): boolean {
  if (isAgentCliRunning(paneCommand, paneText)) {
    return false;
  }

  if (!isShellCommandName(paneCommand.toLowerCase())) {
    return false;
  }

  const text = paneText.trim();
  if (!text) {
    return true;
  }

  const lines = text.split('\n').filter((line) => line.trim().length > 0);
  if (lines.length > 3) {
    return false;
  }

  const lastLine = lines[lines.length - 1] ?? '';
  return /[$#]\s*$/.test(lastLine.trim());
}

// expectedProviderName names the provider this pane is CONFIGURED to run
// (e.g. roles.tsv's agent column, SwarmRole.agent) - the only way to know
// which provider's startup copy to show for an EMPTY pane, since there is
// no CLI/text to detect from yet. Defaults to the pre-refactor hardcoded
// "Claude" behavior when omitted, so existing callers are unaffected.
export function agentPaneStatusMessage(
  paneCommand: string,
  paneText: string,
  expectedProviderName: string = DEFAULT_PROVIDER_NAME
): string | undefined {
  if (isAgentCliRunning(paneCommand, paneText)) {
    return undefined;
  }

  if (!isShellOnlyPane(paneCommand, paneText)) {
    return undefined;
  }

  const providerLabel =
    findProviderDescriptor(expectedProviderName)?.startupCopy ??
    findProviderDescriptor(DEFAULT_PROVIDER_NAME)!.startupCopy;

  if (!paneText.trim()) {
    return `Waiting for ${providerLabel} to start…\n\nIf this persists, use SwarmForge: Stop Swarm then Launch Swarm.`;
  }

  return `Agent is not running in this pane (shell only).\n\nUse SwarmForge: Launch Swarm to start ${providerLabel} agents.`;
}
