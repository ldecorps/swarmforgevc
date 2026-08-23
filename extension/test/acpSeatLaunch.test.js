'use strict';

// BL-1081: unit tests for the ACP-host launch decision (QA bounce D1).

const assert = require('node:assert/strict');
const path = require('node:path');

const {
  ACP_SPIKE_SEAT_AGENT,
  ACP_HOST_PANE_REL,
  shouldLaunchViaAcpHost,
  buildAcpHostPaneCommand,
  normalizeAgentToken,
} = require('../out/swarm/acpSeatLaunch');

test('hosts only the spike seat (vibe), never every acp-native agent', () => {
  assert.equal(ACP_SPIKE_SEAT_AGENT, 'vibe');
  assert.equal(shouldLaunchViaAcpHost('vibe'), true);
  assert.equal(shouldLaunchViaAcpHost('Vibe'), true);
  assert.equal(shouldLaunchViaAcpHost('  vibe  '), true);
  assert.equal(shouldLaunchViaAcpHost('gemini'), false);
  assert.equal(shouldLaunchViaAcpHost('copilot'), false);
  assert.equal(shouldLaunchViaAcpHost('claude'), false);
  assert.equal(shouldLaunchViaAcpHost('cursor'), false);
  assert.equal(shouldLaunchViaAcpHost(''), false);
  assert.equal(shouldLaunchViaAcpHost('vibe-extra'), false);
  assert.equal(normalizeAgentToken(null), '');
  assert.equal(normalizeAgentToken(undefined), '');
  assert.equal(shouldLaunchViaAcpHost(null), false);
});

test('builds a pane command that names the compiled host, not vibe directly', () => {
  const hostEntry = path.join('/repo', ACP_HOST_PANE_REL);
  const cmd = buildAcpHostPaneCommand({
    hostEntry,
    role: 'coder',
    agent: 'vibe',
    worktree: '/repo/.worktrees/coder',
    promptFile: '/repo/.swarmforge/prompts/coder.md',
    addDir: '/repo',
    extraCli: '--model foo',
  });
  assert.match(cmd, /node '/);
  assert.match(cmd, /acp-host-pane\.js/);
  assert.match(cmd, /--role 'coder'/);
  assert.match(cmd, /--agent 'vibe'/);
  assert.match(cmd, /--prompt-file '\/repo\/\.swarmforge\/prompts\/coder\.md'/);
  assert.doesNotMatch(cmd, /^vibe /);
  assert.match(cmd, /--add-dir '\/repo'/);
  assert.match(cmd, /--extra-cli '--model foo'/);
  assert.match(cmd, /\$\{RESUME_NOTE\}\$\(cat '\/repo\/\.swarmforge\/prompts\/coder\.md'\)"/);
});

test('refuses to build a host command for a non-spike agent', () => {
  assert.throws(
    () =>
      buildAcpHostPaneCommand({
        hostEntry: '/x/acp-host-pane.js',
        role: 'coder',
        agent: 'gemini',
        worktree: '/wt',
        promptFile: '/p.md',
      }),
    /only the spike seat/
  );
});

test('shell-quotes paths that contain single quotes', () => {
  const cmd = buildAcpHostPaneCommand({
    hostEntry: "/repo/it's/acp-host-pane.js",
    role: 'coder',
    agent: 'vibe',
    worktree: "/wt/it's",
    promptFile: "/p/it's.md",
  });
  assert.match(cmd, /node '\/repo\/it'\\''s\/acp-host-pane\.js'/);
  assert.match(cmd, /--workdir '\/wt\/it'\\''s'/);
  // The RESUME_NOTE cat path must escape quotes the same way — dropping the
  // replace body would leave an unquoted apostrophe that breaks the shell.
  assert.match(cmd, /\$\(cat '\/p\/it'\\''s\.md'\)"/);
});

test('omits optional flags when addDir/extraCli are absent or blank', () => {
  const cmd = buildAcpHostPaneCommand({
    hostEntry: '/repo/extension/out/tools/acp-host-pane.js',
    role: 'coder',
    agent: 'vibe',
    worktree: '/wt',
    promptFile: '/p.md',
    extraCli: '   ',
  });
  assert.doesNotMatch(cmd, /--add-dir/);
  assert.doesNotMatch(cmd, /--extra-cli/);
  assert.match(cmd, /\$\{RESUME_NOTE\}/);
});

test('trims extraCli before embedding it', () => {
  const cmd = buildAcpHostPaneCommand({
    hostEntry: '/repo/extension/out/tools/acp-host-pane.js',
    role: 'coder',
    agent: 'vibe',
    worktree: '/wt',
    promptFile: '/p.md',
    extraCli: '  --model foo  ',
  });
  assert.match(cmd, /--extra-cli '--model foo'/);
  assert.doesNotMatch(cmd, /--extra-cli '  --model foo  '/);
});
