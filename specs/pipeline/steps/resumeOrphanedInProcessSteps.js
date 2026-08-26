'use strict';

// BL-323: step handlers for "A parcel claimed by a killed agent is
// resumed, not silently stranded". Scenarios 01/02/04 (resume-on-start
// behavior) drive the REAL swarmforge.sh launch-script generation and
// EXECUTION as a subprocess (swarmforge/scripts/test/
// test_resume_on_start.sh, real processes, a real orphaned in_process
// fixture, a stubbed claude binary) - mirroring
// contextClearAllRolesSteps.js's own "drive the real daemon test" pattern
// rather than re-implementing its process/fixture setup here, since the
// fix lives in a bash launch-script generator with no separate pure lib
// to unit-test against. Scenario 03 (status distinguishes no-work from
// claimed-by-nobody) drives the REAL compiled formatRoleStatus
// (extension/out/tools/queue-status.js) directly, mirroring
// conciergeTopicRoutingSteps.js's own "require the compiled pure module"
// pattern.
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const SWARMFORGE_SCRIPTS = path.join(__dirname, '..', '..', '..', 'swarmforge', 'scripts');
const RESUME_TEST = path.join(SWARMFORGE_SCRIPTS, 'test', 'test_resume_on_start.sh');

const { formatRoleStatus } = require(path.join(__dirname, '..', '..', '..', 'extension', 'out', 'tools', 'queue-status'));

function runResumeTest(ctx) {
  if (ctx.resumeTestOutput) {
    return ctx.resumeTestOutput;
  }
  const result = spawnSync('bash', [RESUME_TEST], { encoding: 'utf8', timeout: 60000 });
  ctx.resumeTestOutput = (result.stdout || '') + (result.stderr || '');
  return ctx.resumeTestOutput;
}

function registerSteps(registry) {
  // ── Background ───────────────────────────────────────────────────────
  registry.define(/^a swarm whose roles each own an inbox with new\/ and in_process\/ queues$/, () => {
    // Narrative only - the real shell test's own fixture (mk_fixture_root)
    // provisions exactly this shape per scenario.
  });

  // ── resume-orphaned-inprocess-01 ────────────────────────────────────
  registry.define(/^a role has claimed a parcel into its in_process queue$/, () => {
    // Fixtured entirely inside the real shell test below - it writes the
    // orphaned .handoff directly into inbox/in_process/, exactly what
    // ready_for_next_task.bb leaves behind when an agent claims a parcel.
  });

  registry.define(/^that role's agent is killed before completing it$/, () => {
    // The real shell test never starts a real agent process to kill in
    // the first place - it constructs the POST-kill state directly (an
    // orphaned in_process file with no live owner), which is the only
    // observable difference a kill actually leaves behind. This is the
    // same substitution bridgeServer.test.js's real-dropped-socket tests
    // make for "a process died mid-flight": construct the state a real
    // death leaves, rather than requiring a literal kill -9 in CI.
  });

  registry.define(/^a replacement agent for that role starts$/, (ctx) => {
    ctx.output = runResumeTest(ctx);
  });

  registry.define(/^it resumes the orphaned parcel without human intervention$/, (ctx) => {
    if (!ctx.output.includes('PASS: 01: a parcel orphaned by a killed agent is resumed')) {
      throw new Error(`expected the orphaned-parcel-resumed assertion to pass, got:\n${ctx.output}`);
    }
  });

  registry.define(/^it does not report that there is no work$/, (ctx) => {
    if (!ctx.output.includes('PASS: 01: it does not report that there is no work')) {
      throw new Error(`expected the not-reported-as-no-work assertion to pass, got:\n${ctx.output}`);
    }
  });

  // ── resume-orphaned-inprocess-02 ────────────────────────────────────
  registry.define(/^a role is actively working a parcel in its in_process queue$/, () => {
    // Fixtured inside the real shell test's scenario 02 (a live-owned
    // in_process parcel, content captured before/after).
  });

  registry.define(/^that role's agent is alive$/, () => {
    // Narrative - scenario 02's own point is that the resume check is
    // READ-ONLY regardless of the owning agent's liveness, so this
    // scenario does not need to simulate an actually-running process to
    // prove its parcel is left untouched.
  });

  registry.define(/^the swarm's stall detection runs$/, (ctx) => {
    ctx.output = runResumeTest(ctx);
  });

  registry.define(/^the parcel is left with its owning agent$/, (ctx) => {
    if (!ctx.output.includes('PASS: 02: a parcel held by a live agent is never taken away from it')) {
      throw new Error(`expected the live-agent-parcel-untouched assertion to pass, got:\n${ctx.output}`);
    }
  });

  registry.define(/^it is not requeued or reassigned$/, (ctx) => {
    if (!ctx.output.includes('PASS: 02: a parcel held by a live agent is never taken away from it')) {
      throw new Error(`expected the not-requeued assertion to pass, got:\n${ctx.output}`);
    }
  });

  // ── resume-orphaned-inprocess-03 (Scenario Outline) ─────────────────
  registry.define(/^a role whose new\/ queue is empty and whose in_process queue (is also empty|holds an orphaned parcel)$/, (ctx, state) => {
    ctx.view = {
      role: 'coder',
      newPayloads: [],
      inProcessPayloads: state === 'holds an orphaned parcel' ? ['00_orphaned.handoff'] : [],
      sidecars: [],
    };
  });

  registry.define(/^the swarm's status is reported for that role$/, (ctx) => {
    ctx.statusLine = formatRoleStatus(ctx.view);
  });

  registry.define(/^the status reports (no work pending|work claimed by nobody)$/, (ctx, expected) => {
    if (!ctx.statusLine.includes(expected)) {
      throw new Error(`expected the status line to report "${expected}", got: "${ctx.statusLine}"`);
    }
  });

  // ── resume-orphaned-inprocess-04 ────────────────────────────────────
  registry.define(/^a role whose new\/ and in_process\/ queues are both empty$/, () => {
    // Fixtured inside the real shell test's scenario 04.
  });

  registry.define(/^it reports that there is no work$/, (ctx) => {
    if (!ctx.output.includes('PASS: 04: an idle role with a genuinely empty inbox still reports no work')) {
      throw new Error(`expected the genuinely-idle-no-work assertion to pass, got:\n${ctx.output}`);
    }
  });

  registry.define(/^it does not fabricate or resume a parcel$/, (ctx) => {
    if (!ctx.output.includes('PASS: 04: an idle role with a genuinely empty inbox still reports no work')) {
      throw new Error(`expected the no-fabricated-resume assertion to pass, got:\n${ctx.output}`);
    }
    if (!/ALL PASS/.test(ctx.output)) {
      throw new Error(`expected the real resume-on-start test to pass in full, got:\n${ctx.output}`);
    }
  });
}

module.exports = { registerSteps };
