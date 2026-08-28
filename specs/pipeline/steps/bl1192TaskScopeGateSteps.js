'use strict';

// BL-1192: step handlers for "Pre-handoff task-scope gate refuses
// entangled git_handoffs". Drives the REAL swarm_handoff.bb end to end
// (never a reimplementation) via
// specs/pipeline/steps/lib/bl1192TaskScopeGateCli.sh, which mirrors
// test_swarm_handoff_sync_deliver.sh's own real-fixture conventions
// (fake tmux, a real roles.tsv, a real mailbox skeleton) - so a refusal or
// an acceptance observed here is the actual send path, not a unit-level
// approximation.

const assert = require('node:assert/strict');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const FEATURE = 'Pre-handoff task-scope gate refuses entangled git_handoffs';

const CLI = path.join(__dirname, 'lib', 'bl1192TaskScopeGateCli.sh');

function runGate(sender, taskTicket, foreignTicket, mode, evidenceOnly) {
  const args = [CLI, sender, taskTicket, foreignTicket, mode];
  if (evidenceOnly) args.push('evidence');
  const out = execFileSync('bash', args, { encoding: 'utf8', timeout: 30000 });
  return JSON.parse(out.trim().split('\n').pop());
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(/^a swarm repository whose roles send parcels with swarm_handoff\.sh$/, (ctx) => {
    ctx.bl1192 = {};
  });

  // ── scenario 01: outline over foreign/no-foreign ─────────────────────────

  scoped(/^a commit tagged for the task whose own diff includes paths for ticket "?([A-Za-z0-9-]+)"?$/, (ctx, foreignTicket) => {
    ctx.bl1192.foreignTicket = foreignTicket;
  });

  scoped(/^the coder sends a git_handoff for task ticket "([^"]+)" citing that commit$/, (ctx, taskTicket) => {
    const st = ctx.bl1192;
    st.taskTicket = taskTicket;
    st.result = runGate('coder', taskTicket, st.foreignTicket, 'real');
  });

  scoped(/^the documenter sends a git_handoff for task ticket "([^"]+)" citing that commit$/, (ctx, taskTicket) => {
    const st = ctx.bl1192;
    st.taskTicket = taskTicket;
    st.result = runGate('documenter', taskTicket, st.foreignTicket || 'NONE', 'real', st.evidenceOnly);
  });

  scoped(/^the cleaner sends a git_handoff for task ticket "([^"]+)" citing that commit$/, (ctx, taskTicket) => {
    const st = ctx.bl1192;
    st.taskTicket = taskTicket;
    st.result = runGate('cleaner', taskTicket, st.foreignTicket, 'real');
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

  scoped(/^a commit tagged for the task whose own diff touches only backlog\/evidence for the named task$/, (ctx) => {
    ctx.bl1192.evidenceOnly = true;
    ctx.bl1192.foreignTicket = 'NONE';
  });

  // ── scenario 05: an unresolvable cited commit ────────────────────────────

  scoped(/^the coder sends a git_handoff for task ticket "([^"]+)" citing an unresolvable commit$/, (ctx, taskTicket) => {
    const st = ctx.bl1192;
    st.taskTicket = taskTicket;
    st.result = runGate('coder', taskTicket, 'NONE', 'unresolvable');
  });

  scoped(/^a warning records that the scope check could not run$/, (ctx) => {
    const st = ctx.bl1192;
    assert.match(st.result.stderr, /TASK_SCOPE WARNING/, `expected a TASK_SCOPE warning, got: ${st.result.stderr}`);
  });

  // ── scenario 06: batch-sibling exclusion (architect bounce D2) ──────────

  scoped(/^the task's own first commit was already handed off once$/, () => {
    // Declarative - the CLI driver's "batch" mode always records the
    // task's own first commit as a completed handoff before building the
    // sibling and follow-up commits, mirroring last-handoff-commit's own
    // durable-archive contract.
  });

  scoped(/^a sibling ticket's own commit lands on the same branch in between, tagged with its own id$/, (ctx) => {
    ctx.bl1192.foreignTicket = 'BL-1185';
  });

  scoped(/^the task's own follow-up commit lands after it, touching only its own paths$/, () => {
    // Declarative - the CLI driver's "batch" mode always writes the task's
    // own evidence file as the final, cited commit.
  });

  scoped(/^the cleaner sends a git_handoff for task ticket "([^"]+)" citing the follow-up commit$/, (ctx, taskTicket) => {
    const st = ctx.bl1192;
    st.taskTicket = taskTicket;
    st.result = runGate('cleaner', taskTicket, st.foreignTicket, 'batch');
  });
}

module.exports = { registerSteps };
