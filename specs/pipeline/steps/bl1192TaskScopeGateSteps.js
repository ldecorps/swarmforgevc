'use strict';

// BL-1192: step handlers for "Pre-handoff task-scope gate refuses
// entangled git_handoffs". Drives the REAL swarm_handoff.bb end to end
// (never a reimplementation) via
// specs/pipeline/steps/lib/bl1192TaskScopeGateCli.sh, which mirrors
// test_swarm_handoff_sync_deliver.sh's own real-fixture conventions
// (fake tmux, a real roles.tsv, a real mailbox skeleton, a real origin/main
// ref) - so a refusal or an acceptance observed here is the actual send
// path, not a unit-level approximation.

const assert = require('node:assert/strict');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const FEATURE = 'Pre-handoff task-scope gate refuses entangled git_handoffs';

const CLI = path.join(__dirname, 'lib', 'bl1192TaskScopeGateCli.sh');

function runGate(sender, taskTicket, foreignTicket, originMode, evidenceOnly) {
  const args = [CLI, sender, taskTicket, foreignTicket, originMode];
  if (evidenceOnly) args.push('evidence');
  const out = execFileSync('bash', args, { encoding: 'utf8', timeout: 30000 });
  return JSON.parse(out.trim().split('\n').pop());
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(/^a swarm repository whose roles send parcels with swarm_handoff\.sh$/, (ctx) => {
    ctx.bl1192 = {};
  });

  scoped(/^origin\/main is reachable from the sender's checkout$/, (ctx) => {
    ctx.bl1192.originMode = 'real';
  });

  scoped(/^origin\/main cannot be resolved from the sender checkout$/, (ctx) => {
    ctx.bl1192.originMode = 'unreadable';
  });

  // ── scenario 01: outline over foreign/no-foreign ─────────────────────────

  scoped(/^a commit whose tree diff vs origin\/main includes paths for ticket "?([A-Za-z0-9-]+)"?$/, (ctx, foreignTicket) => {
    ctx.bl1192.foreignTicket = foreignTicket;
  });

  scoped(/^the coder sends a git_handoff for task ticket "([^"]+)" citing that commit$/, (ctx, taskTicket) => {
    const st = ctx.bl1192;
    st.taskTicket = taskTicket;
    st.result = runGate('coder', taskTicket, st.foreignTicket, st.originMode || 'real');
  });

  scoped(/^the documenter sends a git_handoff for task ticket "([^"]+)" citing that commit$/, (ctx, taskTicket) => {
    const st = ctx.bl1192;
    st.taskTicket = taskTicket;
    st.result = runGate('documenter', taskTicket, st.foreignTicket || 'NONE', st.originMode || 'real', st.evidenceOnly);
  });

  scoped(/^the cleaner sends a git_handoff for task ticket "([^"]+)" citing that commit$/, (ctx, taskTicket) => {
    const st = ctx.bl1192;
    st.taskTicket = taskTicket;
    st.result = runGate('cleaner', taskTicket, st.foreignTicket, st.originMode || 'real');
  });

  scoped(/^the send is (refused|accepted)$/, (ctx, outcome) => {
    const st = ctx.bl1192;
    if (outcome === 'refused') {
      assert.notEqual(st.result.exitCode, 0, `expected the send refused, got: ${JSON.stringify(st.result)}`);
      assert.equal(st.result.delivered, false, `expected no delivery on refusal, got: ${JSON.stringify(st.result)}`);
    } else {
      assert.equal(st.result.exitCode, 0, `expected the send accepted, got: ${JSON.stringify(st.result)}`);
      assert.equal(st.result.delivered, true, `expected delivery on acceptance, got: ${JSON.stringify(st.result)}`);
    }
  });

  // ── scenario 02: the refusal names the foreign ticket and paths ─────────

  scoped(/^the refusal reports the foreign ticket id$/, (ctx) => {
    const st = ctx.bl1192;
    assert.match(st.result.stderr, new RegExp(st.foreignTicket), `expected the refusal to name ${st.foreignTicket}, got: ${st.result.stderr}`);
  });

  scoped(/^the refusal lists at least one conflicting path$/, (ctx) => {
    const st = ctx.bl1192;
    assert.match(st.result.stderr, /backlog\/active\/.*\.yaml/, `expected the refusal to list a conflicting path, got: ${st.result.stderr}`);
  });

  scoped(/^the parcel is not delivered to any mailbox$/, (ctx) => {
    const st = ctx.bl1192;
    assert.equal(st.result.delivered, false);
  });

  // ── scenario 04: evidence-only paths for the named task ──────────────────

  scoped(/^a commit whose tree diff vs origin\/main touches only backlog\/evidence for the named task$/, (ctx) => {
    ctx.bl1192.evidenceOnly = true;
    ctx.bl1192.foreignTicket = 'NONE';
  });

  // ── scenario 05: unreadable origin/main ──────────────────────────────────

  scoped(/^the coder sends a git_handoff for task ticket "([^"]+)" citing any commit$/, (ctx, taskTicket) => {
    const st = ctx.bl1192;
    st.taskTicket = taskTicket;
    st.result = runGate('coder', taskTicket, 'NONE', st.originMode || 'unreadable');
  });

  scoped(/^a warning records that the scope check could not run$/, (ctx) => {
    const st = ctx.bl1192;
    assert.match(st.result.stderr, /TASK_SCOPE WARNING/, `expected a TASK_SCOPE warning, got: ${st.result.stderr}`);
  });
}

module.exports = { registerSteps };
