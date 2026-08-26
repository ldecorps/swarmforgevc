'use strict';

// BL-1081 invariant (coder-authored): seat launch for the spiked seat
// consumes the structured host path — never the bare agent CLI as the
// pane process. Non-vacuous: a mutant that always returns false (never
// host) fails against the vibe generator draw.
//
// Runs ONLY via `npm run test:properties` (vitest.properties.config.mjs).

const assert = require('node:assert/strict');
const fc = require('fast-check');

const {
  ACP_SPIKE_SEAT_AGENT,
  shouldLaunchViaAcpHost,
  buildAcpHostPaneCommand,
} = require('../out/swarm/acpSeatLaunch');

const AGENTS = ['claude', 'codex', 'copilot', 'grok', 'aider', 'vibe', 'gemini', 'cursor', 'mock'];

test('only the spike seat launches via the ACP host; its command never starts with the bare agent', () => {
  const waveThrough = () => false;
  assert.equal(shouldLaunchViaAcpHost(ACP_SPIKE_SEAT_AGENT), true);
  assert.equal(waveThrough(ACP_SPIKE_SEAT_AGENT), false);

  fc.assert(
    fc.property(fc.constantFrom(...AGENTS), (agent) => {
      const hosted = shouldLaunchViaAcpHost(agent);
      if (agent === ACP_SPIKE_SEAT_AGENT) {
        assert.equal(hosted, true);
        const cmd = buildAcpHostPaneCommand({
          hostEntry: '/repo/extension/out/tools/acp-host-pane.js',
          role: 'coder',
          agent,
          worktree: '/repo/.worktrees/coder',
          promptFile: '/repo/.swarmforge/prompts/coder.md',
        });
        assert.match(cmd, /acp-host-pane\.js/);
        assert.doesNotMatch(cmd, /^vibe\b/);
        return true;
      }
      assert.equal(hosted, false);
      return true;
    }),
    { numRuns: 64 }
  );
});
