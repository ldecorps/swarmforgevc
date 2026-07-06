const assert = require('node:assert/strict');
const {
  agentPaneStatusMessage,
  isClaudeAgentRunning,
  isShellOnlyPane,
  isPaneActivelyProcessing,
} = require('../out/panel/agentPaneState');

test('isClaudeAgentRunning detects claude process name', () => {
  assert.equal(isClaudeAgentRunning('claude', ''), true);
});

test('isClaudeAgentRunning detects Claude UI markers in pane text', () => {
  const pane = [
    '──────────────────────────────── SwarmForge Coder ──',
    '  bypass permissions on · esc to interrupt',
  ].join('\n');

  assert.equal(isClaudeAgentRunning('bash', pane), true);
});

test('isClaudeAgentRunning detects Coordinator in auto permission mode', () => {
  const pane = [
    '──────────────────────────────── SwarmForge Coordinator ──',
    '  auto mode on (shift+tab to cycle) · esc to interrupt',
  ].join('\n');

  assert.equal(isClaudeAgentRunning('bash', pane), true);
});

test('isClaudeAgentRunning detects permission-mode text without a SwarmForge role banner', () => {
  assert.equal(isClaudeAgentRunning('bash', '  bypass permissions on · working'), true);
});

test('isClaudeAgentRunning detects UI markers without a SwarmForge role banner', () => {
  assert.equal(isClaudeAgentRunning('bash', '  shift+tab to cycle modes'), true);
});

test('isClaudeAgentRunning detects a divider line combined with an arrow prompt marker', () => {
  const pane = '────────────\n❯ ';
  assert.equal(isClaudeAgentRunning('bash', pane), true);
});

test('isClaudeAgentRunning returns false for plain shell text with no markers', () => {
  assert.equal(isClaudeAgentRunning('bash', 'ls -la\ntotal 0'), false);
});

test('isShellOnlyPane returns false when Claude is actually running', () => {
  assert.equal(isShellOnlyPane('claude', ''), false);
});

test('isShellOnlyPane returns false for a non-shell, non-claude command', () => {
  assert.equal(isShellOnlyPane('node', 'starting server...'), false);
});

test('isShellOnlyPane returns false when the pane has more than 3 lines of output', () => {
  const pane = 'line1\nline2\nline3\nline4\n$ ';
  assert.equal(isShellOnlyPane('bash', pane), false);
});

test('isShellOnlyPane treats empty bash pane as shell-only', () => {
  assert.equal(isShellOnlyPane('bash', ''), true);
});

test('isShellOnlyPane treats hostname shell prompt as shell-only', () => {
  assert.equal(
    isShellOnlyPane('bash', 'Laurents-Air:swarmforgevc ldecorps$ '),
    true
  );
});

test('agentPaneStatusMessage returns waiting text for empty bash pane', () => {
  const message = agentPaneStatusMessage('bash', '');
  assert.match(message, /Waiting for Claude to start/);
});

test('agentPaneStatusMessage returns undefined when Claude is active', () => {
  const pane = '──────────────── SwarmForge Cleaner ──\n  bypass permissions on';
  assert.equal(agentPaneStatusMessage('bash', pane), undefined);
});

test('agentPaneStatusMessage returns undefined for Coordinator in auto mode', () => {
  const pane =
    '──────────────── SwarmForge Coordinator ──\n  auto mode on · esc to interrupt';
  assert.equal(agentPaneStatusMessage('bash', pane), undefined);
});

test('agentPaneStatusMessage reports the agent is not running for a non-empty shell-only pane', () => {
  const message = agentPaneStatusMessage('bash', 'Laurents-Air:swarmforgevc ldecorps$ ');
  assert.match(message, /Agent is not running in this pane \(shell only\)/);
});

test('isPaneActivelyProcessing detects the busy "esc to interrupt" footer', () => {
  assert.equal(isPaneActivelyProcessing('  auto mode on · esc to interrupt'), true);
});

test('isPaneActivelyProcessing returns false for the idle "shift+tab to cycle" footer alone', () => {
  assert.equal(isPaneActivelyProcessing('  bypass permissions on (shift+tab to cycle)  /rc'), false);
});

test('isPaneActivelyProcessing returns false for plain shell text', () => {
  assert.equal(isPaneActivelyProcessing('ls -la\ntotal 0'), false);
});
