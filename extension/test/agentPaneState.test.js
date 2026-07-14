const assert = require('node:assert/strict');
const {
  agentPaneStatusMessage,
  isClaudeAgentRunning,
  isShellOnlyPane,
  isPaneActivelyProcessing,
  isAgentCliRunning,
  isAgentActivelyWorking,
  PROVIDER_DESCRIPTORS,
  findProviderDescriptor,
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

test('isAgentCliRunning detects aider in the pane command', () => {
  assert.equal(
    isAgentCliRunning('/Users/me/Library/Python/3.9/bin/aider', ''),
    true
  );
  assert.equal(
    isAgentCliRunning('aider', 'Aider v0.82.3\nModel: mistral/mistral-large-latest'),
    true
  );
  assert.equal(isAgentActivelyWorking('aider', 'Tokens: 9.1k sent, 3 received.'), true);
  assert.equal(isAgentActivelyWorking('aider', 'Repo-map: using 4096 tokens'), false);
});

test('isAgentActivelyWorking is false for a recognized provider with no busyPattern configured (claude/codex/copilot/grok)', () => {
  // claude has a descriptor but no busyPattern (isPaneActivelyProcessing's
  // own text signals are its only busy check) - the optional-chained
  // descriptor?.busyPattern?.test(...) must not throw or false-positive
  // when busyPattern is simply absent.
  assert.equal(isAgentActivelyWorking('claude', 'some ordinary output, not a busy footer'), false);
});

// ── BL-142 slice 1: provider-descriptor-driven detection ───────────────────

test('BL-142 descriptor-parity-01: registry has one descriptor per currently-supported provider', () => {
  const names = PROVIDER_DESCRIPTORS.map((d) => d.name).sort();
  assert.deepEqual(names, ['aider', 'claude', 'codex', 'copilot', 'grok']);
});

test('BL-142 descriptor-parity-01: isAgentCliRunning recognizes every provider by its own CLI name, not just claude/aider', () => {
  assert.equal(isAgentCliRunning('codex', ''), true);
  assert.equal(isAgentCliRunning('copilot', ''), true);
  assert.equal(isAgentCliRunning('grok', ''), true);
  assert.equal(isAgentCliRunning('/usr/local/bin/codex', ''), true);
});

test('BL-142 new-provider-is-data-02: a new descriptor is recognized by the existing detection functions with no code changes', () => {
  // Proves the detection functions are genuinely data-driven: mutating the
  // exported registry (as a caller/plugin would to add a provider) is
  // picked up immediately, with zero edits to isAgentCliRunning itself.
  const fakeDescriptor = {
    name: 'mockprovider',
    cliPattern: /(?:^|\/)mockprovider$/,
    busyPattern: /mock-working/,
    bannerPattern: /Mock Provider v\d/,
    startupCopy: 'Mock Provider',
  };
  PROVIDER_DESCRIPTORS.push(fakeDescriptor);
  try {
    assert.equal(isAgentCliRunning('mockprovider', ''), true);
    assert.equal(isAgentCliRunning('bash', 'Mock Provider v1.0 starting up'), true);
    assert.equal(isAgentActivelyWorking('mockprovider', 'mock-working on it'), true);
  } finally {
    PROVIDER_DESCRIPTORS.pop();
  }
});

test('BL-142 startup-copy-03: the waiting-to-start message names the expected provider from its descriptor', () => {
  assert.match(agentPaneStatusMessage('bash', '', 'aider'), /Waiting for Aider to start/);
  assert.match(agentPaneStatusMessage('bash', '', 'codex'), /Waiting for Codex to start/);
  assert.match(agentPaneStatusMessage('bash', '', 'copilot'), /Waiting for Copilot to start/);
  assert.match(agentPaneStatusMessage('bash', '', 'grok'), /Waiting for Grok to start/);
});

test('BL-142 startup-copy-03: an unrecognized or omitted expected provider falls back to Claude (pre-refactor default)', () => {
  assert.match(agentPaneStatusMessage('bash', ''), /Waiting for Claude to start/);
  assert.match(agentPaneStatusMessage('bash', '', 'some-unknown-provider'), /Waiting for Claude to start/);
});

test('BL-142: the "agent not running" message also names the expected provider, not a hardcoded Claude literal', () => {
  const message = agentPaneStatusMessage('bash', 'Laurents-Air:swarmforgevc ldecorps$ ', 'aider');
  assert.match(message, /start Aider agents/);
});

test('findProviderDescriptor is case-insensitive and returns undefined for an unknown name', () => {
  assert.equal(findProviderDescriptor('AIDER').name, 'aider');
  assert.equal(findProviderDescriptor('nope'), undefined);
  assert.equal(findProviderDescriptor(undefined), undefined);
});
