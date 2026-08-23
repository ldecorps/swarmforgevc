'use strict';

// BL-1081: unit tests for the ACP-host launch decision (QA bounce D1).

const assert = require('node:assert/strict');
const path = require('node:path');

const {
  ACP_SPIKE_SEAT_AGENT,
  ACP_HOST_PANE_REL,
  shouldLaunchViaAcpHost,
  buildAcpHostPaneCommand,
} = require('../out/swarm/acpSeatLaunch');

test('hosts only the spike seat (vibe), never every acp-native agent', () => {
  assert.equal(ACP_SPIKE_SEAT_AGENT, 'vibe');
  assert.equal(shouldLaunchViaAcpHost('vibe'), true);
  assert.equal(shouldLaunchViaAcpHost('Vibe'), true);
  assert.equal(shouldLaunchViaAcpHost('gemini'), false);
  assert.equal(shouldLaunchViaAcpHost('copilot'), false);
  assert.equal(shouldLaunchViaAcpHost('claude'), false);
  assert.equal(shouldLaunchViaAcpHost('cursor'), false);
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
  assert.doesNotMatch(cmd, /^vibe /);
  assert.match(cmd, /--add-dir '\/repo'/);
  assert.match(cmd, /--extra-cli '--model foo'/);
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
