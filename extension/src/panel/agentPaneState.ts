export function isClaudeAgentRunning(
  paneCommand: string,
  paneText: string
): boolean {
  const cmd = paneCommand.toLowerCase();
  if (cmd.includes('claude')) {
    return true;
  }

  const text = paneText.trim();
  if (!text) {
    return false;
  }

  if (/SwarmForge \w+/i.test(text)) {
    return true;
  }
  if (
    /bypass permissions|auto mode|accept edits|dont ask|plan mode/i.test(text)
  ) {
    return true;
  }
  if (/shift\+tab to cycle|esc to interrupt/i.test(text)) {
    return true;
  }
  if (/─{3,}/.test(text) && /❯/.test(text)) {
    return true;
  }

  return false;
}

export function isShellOnlyPane(
  paneCommand: string,
  paneText: string
): boolean {
  if (isClaudeAgentRunning(paneCommand, paneText)) {
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
  if (isClaudeAgentRunning(paneCommand, paneText)) {
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
