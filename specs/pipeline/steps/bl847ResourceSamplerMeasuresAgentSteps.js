'use strict';

// BL-847: step handlers for "the resource sampler measures each role's
// agent process". Drives the REAL production pipeline - buildSampledRoles /
// resolveAgentPid / sampleRolesOnce / readResourceSampleEvents from
// extension/out - with only the two genuine OS boundaries faked (a tmux
// pane pid lookup, and the process table `ps` would return), exactly the
// same seam every other resourceSamplerActivation test in this repo already
// uses. Scenario 04 drives paneTailer's own real, pure didPaneRespawn - the
// out_of_scope regression guard proving that function is untouched.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const EXT_OUT = path.join(REPO_ROOT, 'extension', 'out');

const { buildSampledRoles } = require(path.join(EXT_OUT, 'swarm', 'resourceSamplerActivation.js'));
const { sampleRolesOnce, readResourceSampleEvents } = require(path.join(EXT_OUT, 'metrics', 'resourceTelemetry.js'));
const { didPaneRespawn } = require(path.join(EXT_OUT, 'panel', 'paneTailer.js'));

const SHELL_PID = 100;
const AGENT_PID = 200;
const SHELL_RSS_BYTES = 128 * 1024; // the ticket's own live-data shape: a ~128 KB idle shell...
const AGENT_RSS_BYTES = 400 * 1024 * 1024; // ...next to a ~400 MB agent.
const ROLE = 'coder';

function mkRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'aps-bl847-resource-sampler-'));
}

// Fakes exactly the two OS boundaries buildSampledRoles's default path
// composes (resolvePanePid's tmux lookup, and listProcessTree's `ps`) -
// never a hand-computed "which pid wins" decision.
function buildFakeResolvePid(ctx) {
  return (_targetPath, _session) => {
    if (!ctx.agentPresent) {
      return null; // resolveAgentPid's own real behavior when no descendant matches
    }
    return AGENT_PID;
  };
}

function buildFakeGetStats(ctx) {
  ctx.statsCalledWith = ctx.statsCalledWith || [];
  return (pid) => {
    ctx.statsCalledWith.push(pid);
    if (pid === AGENT_PID) {
      return { rssBytes: AGENT_RSS_BYTES, cpuPercent: 7.8 };
    }
    if (pid === SHELL_PID) {
      // Reachable only if a broken implementation ever called getStats with
      // the shell pid directly - the real resolvePid path above never
      // returns SHELL_PID to sampleRolesOnce at all.
      return { rssBytes: SHELL_RSS_BYTES, cpuPercent: 0 };
    }
    return null;
  };
}

function registerSteps(registry) {
  // ── Background ────────────────────────────────────────────────────────
  registry.define(/^a swarm role is running an agent process inside its tmux pane$/, (ctx) => {
    ctx.root = mkRoot();
    ctx.agentPresent = true;
  });

  registry.define(/^the pane's root shell is a different, much smaller process than the agent$/, () => {
    // Documents the fixture shape (SHELL_PID/SHELL_RSS_BYTES vs
    // AGENT_PID/AGENT_RSS_BYTES above) - nothing to set up beyond Background.
  });

  // ── Given ────────────────────────────────────────────────────────────
  registry.define(/^no agent process can be identified inside that role's pane$/, (ctx) => {
    ctx.agentPresent = false;
  });

  registry.define(/^the pane has been respawned since the last observation$/, (ctx) => {
    ctx.previousPid = String(SHELL_PID);
    ctx.currentPid = String(SHELL_PID + 1);
  });

  // ── When ─────────────────────────────────────────────────────────────
  registry.define(/^the resource sampler takes one sample for that role$/, (ctx) => {
    const roles = [{ index: 1, role: ROLE, session: `swarmforge-${ROLE}`, displayName: 'Coder', agent: 'claude' }];
    const sampledRoles = buildSampledRoles(ctx.root, roles, buildFakeResolvePid(ctx));
    ctx.sampledCount = sampleRolesOnce(ctx.root, sampledRoles, buildFakeGetStats(ctx), 1751500000000);
    ctx.events = readResourceSampleEvents(ctx.root);
  });

  registry.define(/^pane respawn detection runs for that role$/, (ctx) => {
    ctx.respawnDetected = didPaneRespawn(ctx.previousPid, ctx.currentPid);
  });

  // ── Then ─────────────────────────────────────────────────────────────
  registry.define(/^the recorded RSS for that role matches the agent process$/, (ctx) => {
    const recorded = ctx.events.find((e) => e.role === ROLE);
    if (!recorded) {
      throw new Error('expected a recorded resource_sample event for the role');
    }
    if (recorded.rssBytes !== AGENT_RSS_BYTES) {
      throw new Error(`expected the recorded RSS (${recorded.rssBytes}) to match the agent process's RSS (${AGENT_RSS_BYTES})`);
    }
  });

  registry.define(/^the recorded RSS for that role does not match the pane's root shell$/, (ctx) => {
    const recorded = ctx.events.find((e) => e.role === ROLE);
    if (recorded && recorded.rssBytes === SHELL_RSS_BYTES) {
      throw new Error(`expected the recorded RSS not to match the pane's root shell (${SHELL_RSS_BYTES}), but it did`);
    }
  });

  registry.define(/^no resource sample is recorded for that role$/, (ctx) => {
    const recorded = ctx.events.find((e) => e.role === ROLE);
    if (recorded) {
      throw new Error(`expected no resource_sample event for ${ROLE}, got: ${JSON.stringify(recorded)}`);
    }
    if (ctx.sampledCount !== 0) {
      throw new Error(`expected sampleRolesOnce to report 0 sampled roles, got ${ctx.sampledCount}`);
    }
  });

  registry.define(/^the pane's root shell measurement is not recorded under that role$/, (ctx) => {
    const recorded = ctx.events.find((e) => e.role === ROLE);
    if (recorded && recorded.rssBytes === SHELL_RSS_BYTES) {
      throw new Error("expected the pane's root shell measurement never to be recorded as a fallback, but it was");
    }
    // The stronger claim: getStats was never even invoked with the shell
    // pid - resolveAgentPid's null short-circuits before sampleRolesOnce
    // calls getStats at all, so nothing downstream ever sees SHELL_PID.
    if ((ctx.statsCalledWith || []).includes(SHELL_PID)) {
      throw new Error('expected getStats never to be called with the pane shell pid at all');
    }
  });

  registry.define(/^the respawn is detected from the pane's own pid$/, (ctx) => {
    if (ctx.respawnDetected !== true) {
      throw new Error(`expected didPaneRespawn(${ctx.previousPid}, ${ctx.currentPid}) to be true`);
    }
  });
}

module.exports = { registerSteps };
