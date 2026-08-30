'use strict';

// BL-1253: BL-848 stamp-off of Cursor hotfix 2ec06b6ef1 - "a dead front-desk
// feeder must not leave the bridge in queue mode".
//
// This CONFIRMS OR REFUTES what landed. It reimplements nothing, changes no
// hotfix source line, and writes nothing to the ledger.
//
// Where a prior stamp-off would read the source at the commit and assert on
// its text, these scenarios EXECUTE the landed decision: the real
// runCursorBridgePollOnce, over a real heartbeat file on disk, through the
// real exported liveness functions, and the real start_cursor_bridge.sh for
// the start-time half. A source-text assertion cannot tell a wired hotfix
// from an unwired one, and the whole fault being reviewed was a decision that
// looked right and was never re-consulted.
//
// The Background still verifies the reviewed tree IS the landed hotfix: the
// three source files are compared against commit 2ec06b6ef1, so "the landed
// sources at 2ec06b6ef1" is a checked fact rather than an assumption.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const OUT = path.join(REPO_ROOT, 'extension', 'out');
const HOTFIX = '2ec06b6ef1';
const START_CLI = path.join(__dirname, 'lib', 'bl1253StartCursorBridgeFeederCli.sh');
const LEDGER = path.join(REPO_ROOT, 'backlog', 'hotfix-ledger.yaml');

// The hotfix's own functional paths. This parcel must not touch them, and the
// tree under review must still carry what landed in them.
const HOTFIX_SOURCES = [
  'extension/src/tools/cursorBridgeInboundQueue.ts',
  'extension/src/tools/telegramCursorBridgeCore.ts',
  'extension/src/tools/telegramCursorBridgeLive.ts',
];

const FEATURE =
  'Stamp-off review of Cursor hotfix 2ec06b6ef1 - a dead front-desk feeder must not leave the bridge in queue mode';

const {
  runCursorBridgePollOnce,
} = require(path.join(OUT, 'tools', 'telegramCursorBridgeLive'));
const {
  isFrontDeskInboundFeederLive,
  shouldUseCursorBridgeInboundQueue,
} = require(path.join(OUT, 'tools', 'telegramCursorBridgeCore'));
const {
  frontDeskPollHeartbeatPath,
  readFrontDeskPollHeartbeatMs,
  cursorBridgeInboundQueuePath,
  appendCursorBridgeInboundUpdate,
} = require(path.join(OUT, 'tools', 'cursorBridgeInboundQueue'));
const {
  createMockCursorBridgeAgentSession,
} = require(path.join(OUT, 'bridge', 'cursorBridgeAgentSession'));

const STALE_MS = 3_600_000;

function git(...args) {
  return execFileSync('git', args, { cwd: REPO_ROOT, encoding: 'utf8' });
}

/**
 * The landed decision, composed from the three exported functions the hotfix
 * added, exactly as telegramCursorBridgeLive's own resolveInboundQueueFromFeeder
 * composes them. That private helper cannot be imported, and exporting it
 * would edit a hotfix source line - which invariant 1 forbids this parcel from
 * doing. The Background asserts the wiring reads as this composition, and the
 * scenarios below run it through the real poll.
 */
function resolveUseInboundQueue(opDir) {
  return shouldUseCursorBridgeInboundQueue(process.env, {
    feederLive: isFrontDeskInboundFeederLive({
      lastHeartbeatMs: readFrontDeskPollHeartbeatMs(opDir),
      nowMs: Date.now(),
    }),
  });
}

function writeHeartbeat(opDir, state) {
  const file = frontDeskPollHeartbeatPath(opDir);
  if (state === 'absent') {
    fs.rmSync(file, { force: true });
    return;
  }
  if (state === 'malformed') {
    fs.writeFileSync(file, '{"lastHeartbeatMs": not-a-number', 'utf8');
    return;
  }
  const lastHeartbeatMs = state === 'fresh' ? Date.now() : Date.now() - STALE_MS;
  fs.writeFileSync(file, JSON.stringify({ lastHeartbeatMs }), 'utf8');
}

function makeFixture(ctx) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bl1253-'));
  const opDir = path.join(root, '.swarmforge', 'operator');
  fs.mkdirSync(opDir, { recursive: true });
  ctx.bl1253.root = root;
  ctx.bl1253.opDir = opDir;
  ctx.bl1253.getUpdatesCalls = 0;
  const statePath = path.join(opDir, 'cursor-bridge-state.json');
  fs.writeFileSync(statePath, JSON.stringify({ updateOffset: 0, cursorTopicId: 55 }), 'utf8');
  ctx.bl1253.deps = {
    repoRoot: root,
    botToken: 'token',
    chatId: '-100',
    principalUserId: '42',
    opDir,
    statePath,
    topicMapPath: path.join(opDir, 'cursor-bridge-topic-map.json'),
    agentSession: createMockCursorBridgeAgentSession(root),
    post: async () => {},
    inboundQueueIdleMs: 1,
    getUpdates: async () => {
      ctx.bl1253.getUpdatesCalls += 1;
      return { success: true, updates: [] };
    },
    // The seam the hotfix added: re-evaluated on every poll, never once.
    resolveUseInboundQueue: () => resolveUseInboundQueue(opDir),
  };
  return ctx.bl1253;
}

async function poll(ctx) {
  const st = ctx.bl1253;
  // A queued update the bridge can only consume in queue mode. Its presence
  // afterwards is the observable: queue mode drains the file, getUpdates mode
  // leaves it untouched.
  appendCursorBridgeInboundUpdate(st.opDir, { update_id: 1000 + st.polls });
  const before = st.getUpdatesCalls;
  st.polls += 1;
  await runCursorBridgePollOnce(st.deps, { updateOffset: 0, cursorTopicId: 55 }, false, 0);
  st.lastPolledTelegram = st.getUpdatesCalls > before;
  st.lastDrainedQueue = !fs.existsSync(cursorBridgeInboundQueuePath(st.opDir));
}

function assertOwnedGetUpdates(st) {
  assert.equal(st.lastPolledTelegram, true, 'the bridge did not call getUpdates');
  assert.equal(
    st.lastDrainedQueue,
    false,
    'the bridge drained the queue as well - it is still in queue mode'
  );
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(/^the landed sources at commit 2ec06b6ef1$/, (ctx) => {
    ctx.bl1253 = { polls: 0 };

    assert.equal(git('cat-file', '-t', HOTFIX).trim(), 'commit', `hotfix ${HOTFIX} must be reachable`);
    const message = git('log', '-1', '--format=%B', HOTFIX);
    assert.match(message, /Hotfix-Certification:\s*pending/, 'the hotfix trailer is not pending');
    assert.match(message, /Own getUpdates when the front-desk inbound feeder is dead/);

    // What landed is still what runs. Only lines the hotfix did NOT touch may
    // have moved since; the three functions under review are compared
    // literally against the commit.
    for (const file of HOTFIX_SOURCES) {
      const landed = git('show', `${HOTFIX}:${file}`);
      const now = fs.readFileSync(path.join(REPO_ROOT, file), 'utf8');
      for (const symbol of [
        'frontDeskPollHeartbeatPath',
        'readFrontDeskPollHeartbeatMs',
        'isFrontDeskInboundFeederLive',
        'shouldUseCursorBridgeInboundQueue',
        'resolveUseInboundQueue',
      ]) {
        if (landed.includes(symbol)) {
          assert.ok(now.includes(symbol), `${file} lost ${symbol} since ${HOTFIX}`);
        }
      }
    }

    // Invariant 1, checked rather than asserted in prose: this parcel
    // reimplements nothing, so it must have modified none of the hotfix's own
    // source files. A stamp-off that edited what it was reviewing would be
    // certifying its own work.
    const touched = git('status', '--porcelain', '--', ...HOTFIX_SOURCES).trim();
    assert.equal(touched, '', `this stamp-off modified the hotfix it is reviewing: ${touched}`);

    // The composition this review drives is the one the bridge wires in.
    const live = fs.readFileSync(path.join(REPO_ROOT, HOTFIX_SOURCES[2]), 'utf8');
    assert.match(
      live,
      /function resolveInboundQueueFromFeeder\(opDir: string\): boolean \{\s*return shouldUseCursorBridgeInboundQueue\(process\.env, \{\s*feederLive: isFrontDeskInboundFeederLive\(\{\s*lastHeartbeatMs: readFrontDeskPollHeartbeatMs\(opDir\),/,
      'the landed feeder resolution is not the composition this review drives'
    );
    assert.match(
      live,
      /resolveUseInboundQueue: \(\) => resolveInboundQueueFromFeeder\(opDir\)/,
      'the poll loop is not wired to the feeder resolution'
    );
  });

  // ── 01 / 03: the decision, executed ─────────────────────────────────────

  scoped(/^the front-desk poll heartbeat is (fresh|stale|absent)$/, async (ctx, state) => {
    const st = makeFixture(ctx);
    writeHeartbeat(st.opDir, state);
  });

  scoped(/^the front-desk poll heartbeat file cannot be parsed as a heartbeat$/, async (ctx) => {
    const st = makeFixture(ctx);
    writeHeartbeat(st.opDir, 'malformed');
  });

  scoped(/^the bridge decides how to take inbound updates$/, async (ctx) => {
    await poll(ctx);
  });

  scoped(/^the bridge (consumes the queue|owns getUpdates itself)$/, (ctx, behaviour) => {
    const st = ctx.bl1253;
    if (behaviour === 'consumes the queue') {
      assert.equal(st.lastDrainedQueue, true, 'the bridge left the queue undrained');
      assert.equal(st.lastPolledTelegram, false, 'the bridge polled Telegram as well as the queue');
    } else {
      assertOwnedGetUpdates(st);
    }
    fs.rmSync(st.root, { recursive: true, force: true });
  });

  scoped(/^the bridge owns getUpdates itself$/, (ctx) => {
    assertOwnedGetUpdates(ctx.bl1253);
    fs.rmSync(ctx.bl1253.root, { recursive: true, force: true });
  });

  // ── 02: re-evaluated per poll, the actual fault ─────────────────────────

  scoped(/^the bridge started while the front-desk poll heartbeat was fresh$/, async (ctx) => {
    const st = makeFixture(ctx);
    writeHeartbeat(st.opDir, 'fresh');
    await poll(ctx);
    assert.equal(st.lastDrainedQueue, true, 'a fresh feeder should have left the bridge in queue mode');
    assert.equal(st.lastPolledTelegram, false);
  });

  scoped(/^the heartbeat goes stale during the run$/, async (ctx) => {
    // Same deps object, same process: nothing is restarted between the two
    // polls, which is the whole claim.
    writeHeartbeat(ctx.bl1253.opDir, 'stale');
    await poll(ctx);
  });

  scoped(/^the bridge owns getUpdates without being restarted$/, (ctx) => {
    const st = ctx.bl1253;
    assert.equal(st.polls, 2, 'the scenario must observe two polls of one bridge');
    assertOwnedGetUpdates(st);
    fs.rmSync(st.root, { recursive: true, force: true });
  });

  // ── 06: the recovery direction, carried from retired BL-1260 ────────────
  //
  // Scenario 02's mirror, and the dangerous one: a bridge that takes the
  // token and never returns it leaves the front desk permanently dead while
  // every liveness signal reads green. Same deps object, same process - the
  // hand-back cannot be observed any other way.

  scoped(/^the bridge owns getUpdates because the heartbeat was stale$/, async (ctx) => {
    const st = makeFixture(ctx);
    writeHeartbeat(st.opDir, 'stale');
    await poll(ctx);
    assertOwnedGetUpdates(st);
  });

  scoped(/^the front-desk poll heartbeat becomes fresh again during the run$/, async (ctx) => {
    writeHeartbeat(ctx.bl1253.opDir, 'fresh');
    await poll(ctx);
  });

  scoped(/^the bridge returns to consuming the queue without being restarted$/, (ctx) => {
    const st = ctx.bl1253;
    assert.equal(st.polls, 2, 'the scenario must observe two polls of one bridge');
    assert.equal(st.lastDrainedQueue, true, 'the bridge did not go back to the queue');
    assert.equal(
      st.lastPolledTelegram,
      false,
      'the bridge kept the token after the front desk recovered - two pollers on one token'
    );
    fs.rmSync(st.root, { recursive: true, force: true });
  });

  // ── 04: the start script, run for real ──────────────────────────────────

  scoped(/^the front-desk inbound feeder is not live at start$/, (ctx) => {
    ctx.bl1253 = { polls: 0, feederAtStart: 'absent' };
  });

  scoped(/^the bridge start script resolves its inbound queue setting$/, (ctx) => {
    const out = execFileSync('bash', [START_CLI, ctx.bl1253.feederAtStart], {
      encoding: 'utf8',
      timeout: 120_000,
    });
    ctx.bl1253.startResult = JSON.parse(out.trim().split('\n').pop());
  });

  scoped(/^inbound queue mode is off$/, (ctx) => {
    const { startResult } = ctx.bl1253;
    assert.equal(
      startResult.queue,
      '0',
      `the start script exported CURSOR_BRIDGE_INBOUND_QUEUE=${JSON.stringify(startResult.queue)}: ${startResult.stderr}`
    );
    // ...and it says why, rather than turning the mode off silently.
    assert.match(startResult.stderr, /front-desk feeder not live/);
  });

  // ── 05: the ledger stays the human's to decide ──────────────────────────

  scoped(/^the review scenarios above are green$/, (ctx) => {
    ctx.bl1253 = { polls: 0 };
  });

  scoped(/^the stamp-off completes without a recorded human decision$/, (ctx) => {
    ctx.bl1253.ledger = fs.readFileSync(LEDGER, 'utf8');
    // This parcel must not have touched the ledger at all.
    const changed = git('status', '--porcelain', '--', 'backlog/hotfix-ledger.yaml').trim();
    assert.equal(changed, '', `this stamp-off modified the ledger: ${changed}`);
  });

  scoped(/^the hotfix ledger row for 2ec06b6ef1 is neither certified nor waived$/, (ctx) => {
    const rows = ctx.bl1253.ledger.split(/^- commit: /m).filter((r) => r.startsWith(HOTFIX));
    assert.equal(rows.length, 1, `expected exactly one ledger row for ${HOTFIX}`);
    const row = rows[0];
    const state = /\n\s*state:\s*(\S+)/.exec(row);
    const decision = /\n\s*human_decision:\s*(\S+)/.exec(row);
    assert.ok(state, `the ledger row for ${HOTFIX} has no state`);
    assert.ok(
      !['certified', 'waived'].includes(state[1]),
      `green scenarios certified the hotfix: state is ${state[1]}`
    );
    assert.equal(decision && decision[1], 'null', `a human decision was recorded without a human: ${row}`);
  });
}

module.exports = { registerSteps };
