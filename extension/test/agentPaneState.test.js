const assert = require('node:assert/strict');
const test = require('node:test');

const {
  agentPaneStatusMessage,
  isClaudeAgentRunning,
  isShellOnlyPane,
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
