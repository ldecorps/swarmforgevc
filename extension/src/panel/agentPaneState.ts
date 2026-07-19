const SWARMFORGE_ROLE = /SwarmForge \w+/i;
const PERMISSION_MODE = /bypass permissions|auto mode|accept edits|dont ask|plan mode/i;
const UI_MARKERS = /shift\+tab to cycle|esc to interrupt/i;
const DIVIDER_AND_PROMPT = /─{3,}/;
const ARROW_MARKER = /❯/;
const AGENT_CLI_NAMES = /(?:^|\/)claude$|(?:^|\/)aider$|(?:^|\/)codex$|(?:^|\/)copilot$|(?:^|\/)grok$/;
const AIDER_BUSY = /(?:Applying edits|Searching|Summariz|Generating|Tokens:\s*\d)/i;

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
  if (cmd.includes('aider') && AIDER_BUSY.test(paneText)) {
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

export function isAgentCliRunning(
  paneCommand: string,
  paneText: string
): boolean {
  const cmd = paneCommand.trim();
  if (AGENT_CLI_NAMES.test(cmd) || cmd.toLowerCase().includes('aider')) {
    return true;
  }

  const text = paneText.trim();
  if (!text) {
    return false;
  }

  if (SWARMFORGE_ROLE.test(text)) {
    return true;
  }
  if (PERMISSION_MODE.test(text)) {
    return true;
  }
  if (UI_MARKERS.test(text)) {
    return true;
  }
  if (DIVIDER_AND_PROMPT.test(text) && ARROW_MARKER.test(text)) {
    return true;
  }
  if (/^Aider v\d/m.test(text) || /\bAider v\d/.test(text)) {
    return true;
  }
  if (AIDER_BUSY.test(text)) {
    return true;
  }

  return false;
}

export function isShellOnlyPane(
  paneCommand: string,
  paneText: string
): boolean {
  if (isAgentCliRunning(paneCommand, paneText)) {
    return false;
  }

  const cmd = paneCommand.toLowerCase();
  const isShell =
    cmd === 'bash' ||
    cmd === 'zsh' ||
    cmd === '-zsh' ||
    cmd.endsWith('/bash') ||
    cmd.endsWith('/zsh');

  if (!isShell) {
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

export function agentPaneStatusMessage(
  paneCommand: string,
  paneText: string
): string | undefined {
  if (isAgentCliRunning(paneCommand, paneText)) {
    return undefined;
  }

  if (!isShellOnlyPane(paneCommand, paneText)) {
    return undefined;
  }

  if (!paneText.trim()) {
    return 'Waiting for Claude to start…\n\nIf this persists, use SwarmForge: Stop Swarm then Launch Swarm.';
  }

  return 'Agent is not running in this pane (shell only).\n\nUse SwarmForge: Launch Swarm to start Claude agents.';
}
