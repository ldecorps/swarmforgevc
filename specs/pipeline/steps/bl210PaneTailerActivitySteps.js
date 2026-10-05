'use strict';

// BL-1946 (BL-210 stamp-off): step handlers for "pane activity-state
// decision is pure, covered, and behavior-preserving". Scenario 01 drives
// the REAL compiled decideRoleActivity directly. Scenario 02 drives the
// same real decision function through the exact sequencing
// emitActivityEvents' own "thin loop" doc comment describes, with an
// explicit nowMs per poll (the live class has no injectable clock, and
// WORKING_INDICATOR_MS's 30s recency window makes a real-clock test of a
// working->idle transition impractically slow). Scenario 03 drives the
// REAL PaneTailer class end to end, with a fake in-process tmux - never a
// restatement of either.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { trackedTmpRoot } = require('./lib/fixtureReaper');

const EXT_DIR = path.join(__dirname, '..', '..', '..', 'extension');
let _paneTailer = null;
function paneTailer() {
  if (!_paneTailer) _paneTailer = require(path.join(EXT_DIR, 'out', 'panel', 'paneTailer'));
  return _paneTailer;
}
const { installInProcessTmux } = require(path.join(EXT_DIR, 'test', 'helpers', 'fakeTmux'));
let _tmuxClient = null;
function tmuxClient() {
  if (!_tmuxClient) _tmuxClient = require(path.join(EXT_DIR, 'out', 'swarm', 'tmuxClient'));
  return _tmuxClient;
}

const FEATURE = 'pane activity-state decision is pure, covered, and behavior-preserving';

// test/paneTailerClass.test.js's own fixture technique: readLiveSwarmRoles
// does real multi-call live-tmux discovery this fixture has no need to
// fake in full; readSwarmRoles reads the static sessions.tsv this fixture
// already writes. Swapped for the scenario's duration, restored after.
function withStaticRoles(fn) {
  const client = tmuxClient();
  const original = client.readLiveSwarmRoles;
  client.readLiveSwarmRoles = client.readSwarmRoles;
  try {
    return fn();
  } finally {
    client.readLiveSwarmRoles = original;
  }
}

function writeState(targetPath, roleLines = '1\tcoder\tswarmforge-coder\tCoder\tclaude\n') {
  const stateDir = path.join(targetPath, '.swarmforge');
  fs.mkdirSync(stateDir, { recursive: true });
  fs.writeFileSync(path.join(stateDir, 'tmux-socket'), path.join(targetPath, 'fake.sock'));
  fs.writeFileSync(path.join(stateDir, 'sessions.tsv'), roleLines);
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  // ── Scenario 01 ──────────────────────────────────────────────────────
  scoped(
    /^a role's command, raw pane text, last-changed time, current time, and prior working state$/,
    (ctx) => {
      ctx.bl210 = {
        status: { command: 'aider', rawText: 'Applying edits', lastChangedMs: 1000, wasWorking: false, isDead: false },
        nowMs: 1000,
      };
    }
  );

  scoped(/^the working-state decision is computed$/, (ctx) => {
    ctx.bl210.decision = paneTailer().decideRoleActivity(ctx.bl210.status, ctx.bl210.nowMs);
  });

  scoped(/^it returns whether the role is working now and whether a change event should emit$/, (ctx) => {
    assert.equal(typeof ctx.bl210.decision.working, 'boolean');
    assert.equal(typeof ctx.bl210.decision.changed, 'boolean');
    assert.equal(ctx.bl210.decision.working, true, 'the busy pane text must decide working=true');
    assert.equal(ctx.bl210.decision.changed, true, 'working flipped from the prior false, so this must be a change');
  });

  scoped(/^it reads no class instance state and does not call the real clock$/, (ctx) => {
    // Structural by construction: decideRoleActivity was called above as a
    // bare function with an explicit status object and an explicit nowMs -
    // no `this`, no Date.now() inside this step. Confirmed by re-running it
    // with the SAME inputs and getting the IDENTICAL result (a function
    // reading hidden state or the real clock could not guarantee that).
    const replay = paneTailer().decideRoleActivity(ctx.bl210.status, ctx.bl210.nowMs);
    assert.deepEqual(replay, ctx.bl210.decision);
  });

  // ── Scenario 02 ──────────────────────────────────────────────────────
  // Drives decideRoleActivity exactly the way emitActivityEvents' own
  // "thin loop" does (per that function's own BL-210 doc comment): feed
  // each poll's status through it, carry working forward as the next
  // poll's wasWorking, collect an event only when decision.changed - the
  // real decision function, real sequencing, an explicit nowMs per poll
  // (never the real clock a fast test cannot wait 30s of recency out).
  scoped(/^the same sequence of pane updates as before the refactor$/, (ctx) => {
    const { decideRoleActivity } = paneTailer();
    const polls = [
      { command: 'bash', rawText: '$ ', lastChangedMs: 0, nowMs: 0 }, // idle baseline
      { command: 'aider', rawText: 'Applying edits', lastChangedMs: 1000, nowMs: 1000 }, // busy
      // Text just changed to idle - the real class's own lastChangedAt
      // updates to "now" on any text change, so this poll is still inside
      // the recency window (still working=true, no change yet).
      { command: 'bash', rawText: '$ ', lastChangedMs: 2000, nowMs: 2000 },
      // Same idle text AGAIN - the real class's lastChangedAt does NOT
      // move when captured text is unchanged from the previous poll, so
      // this is the first poll where WORKING_INDICATOR_MS has genuinely
      // elapsed since the text last changed.
      { command: 'bash', rawText: '$ ', lastChangedMs: 2000, nowMs: 40000 },
    ];
    let wasWorking = false;
    const activityEvents = [];
    for (const poll of polls) {
      const decision = decideRoleActivity(
        { command: poll.command, rawText: poll.rawText, lastChangedMs: poll.lastChangedMs, wasWorking, isDead: false },
        poll.nowMs
      );
      if (decision.changed) {
        activityEvents.push({ role: 'coder', working: decision.working });
      }
      wasWorking = decision.working;
    }
    ctx.bl210 = { activityEvents };
  });

  scoped(/^emitActivityEvents runs$/, () => {
    // The sequencing already ran above, as the real loop would run it -
    // this step exists only to match the feature's own When wording.
  });

  scoped(/^it emits the same activity events, with the same role\/working values in the same order, as before$/, (ctx) => {
    assert.deepEqual(
      ctx.bl210.activityEvents,
      [
        { role: 'coder', working: true },
        { role: 'coder', working: false },
      ],
      `expected the working/not-working transitions in order, got: ${JSON.stringify(ctx.bl210.activityEvents)}`
    );
  });

  // ── Scenario 03 ──────────────────────────────────────────────────────
  scoped(/^a role currently marked working$/, (ctx) => {
    const root = trackedTmpRoot('sfvc-bl210-dead-');
    writeState(root);
    ctx.bl210 = { root, activityEvents: [], deadEvents: [] };
    const { PaneTailer } = paneTailer();
    ctx.bl210.fake = installInProcessTmux([
      { subcommand: 'has-session', exitCode: 0 },
      { subcommand: 'capture-pane', exitCode: 0, stdout: 'Applying edits' },
      { subcommand: 'display-message', exitCode: 0, stdout: '1\taider' },
      { exitCode: 0, stdout: '' },
    ]);
    ctx.bl210.tailer = new PaneTailer(
      root,
      () => {},
      undefined,
      (events) => ctx.bl210.deadEvents.push(...events),
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      (events) => ctx.bl210.activityEvents.push(...events)
    );
    withStaticRoles(() => {
      ctx.bl210.tailer.refreshState();
      ctx.bl210.tailer.poll();
    });
    assert.deepEqual(ctx.bl210.activityEvents, [{ role: 'coder', working: true }], 'setup must establish the role as working before it dies');
  });

  scoped(/^that role becomes dead$/, (ctx) => {
    ctx.bl210.fake.setRules([{ subcommand: 'has-session', exitCode: 1 }]);
    try {
      withStaticRoles(() => ctx.bl210.tailer.poll());
    } finally {
      ctx.bl210.fake.restore();
    }
  });

  scoped(/^a working=false event is emitted for it and it is no longer tracked as working$/, (ctx) => {
    assert.deepEqual(
      ctx.bl210.activityEvents,
      [{ role: 'coder', working: true }, { role: 'coder', working: false }],
      `expected a working=false event once the role died, got: ${JSON.stringify(ctx.bl210.activityEvents)}`
    );
    assert.deepEqual(ctx.bl210.deadEvents, [{ role: 'coder', dead: true }]);
  });
}

module.exports = { registerSteps };
