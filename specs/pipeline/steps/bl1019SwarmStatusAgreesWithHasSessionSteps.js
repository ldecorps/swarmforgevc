'use strict';

// BL-1019: swarm status liveness agrees with has-session + agent child.
// Drives REAL swarm-status-lib/agent-liveness-verdict (and agent-status-row)
// over constructed facts — pane command is never consulted.
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const FEATURE = 'swarm status stops reporting DOWN for a role that is demonstrably up';

function evalVerdict(facts) {
  const edn = [
    '{',
    `:session-present? ${facts.sessionPresent}`,
    `:has-agent-process? ${facts.hasAgent}`,
    `:process-gather-failed? ${facts.gatherFailed}`,
    '}',
  ].join(' ');
  const script = `
(load-file "swarmforge/scripts/swarm_status_lib.bb")
(println (name (swarm-status-lib/agent-liveness-verdict ${edn})))
`;
  const res = spawnSync('bb', ['-e', script], { cwd: REPO_ROOT, encoding: 'utf8' });
  if (res.status !== 0) {
    throw new Error(`verdict failed: ${res.stdout}\n${res.stderr}`);
  }
  return (res.stdout || '').trim().split('\n').pop();
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(/^a pack whose tmux socket is known$/, (ctx) => {
    ctx.bl1019 = { facts: {} };
  });

  scoped(/^role "([^"]+)" whose session exists$/, (ctx, role) => {
    ctx.bl1019.role = role;
    ctx.bl1019.facts.sessionPresent = true;
  });

  scoped(/^role "([^"]+)" whose session is missing$/, (ctx, role) => {
    ctx.bl1019.role = role;
    ctx.bl1019.facts.sessionPresent = false;
    ctx.bl1019.facts.hasAgent = false;
    ctx.bl1019.facts.gatherFailed = false;
  });

  scoped(/^the pane's own command is (zsh|bash)$/, (ctx) => {
    // Documented as irrelevant — status must not key off pane_current_command.
    ctx.bl1019.paneCommandIgnored = true;
  });

  scoped(/^a live claude process runs under that pane$/, (ctx) => {
    ctx.bl1019.facts.hasAgent = true;
    ctx.bl1019.facts.gatherFailed = false;
  });

  scoped(/^no claude process runs under that pane$/, (ctx) => {
    ctx.bl1019.facts.hasAgent = false;
    ctx.bl1019.facts.gatherFailed = false;
  });

  scoped(/^the process gather for that pane fails$/, (ctx) => {
    ctx.bl1019.facts.hasAgent = false;
    ctx.bl1019.facts.gatherFailed = true;
  });

  scoped(/^status is reported for that role$/, (ctx) => {
    ctx.bl1019.verdict = evalVerdict(ctx.bl1019.facts);
  });

  scoped(/^that role is reported UP$/, (ctx) => {
    assert.equal(ctx.bl1019.verdict, 'up');
  });

  scoped(/^that role is reported DOWN$/, (ctx) => {
    assert.equal(ctx.bl1019.verdict, 'down');
  });

  scoped(/^that role is reported unknown rather than DOWN$/, (ctx) => {
    assert.equal(ctx.bl1019.verdict, 'unknown');
  });

  scoped(/^that verdict agrees with what attach reports for the same role$/, (ctx) => {
    // Attach's honest check is has-session: missing session → absent/DOWN.
    assert.equal(ctx.bl1019.facts.sessionPresent, false);
    assert.equal(ctx.bl1019.verdict, 'down');
  });
}

module.exports = { registerSteps };
