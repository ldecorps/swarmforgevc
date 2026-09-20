'use strict';

// BL-1652: step handlers for "The chase sweep never respawns a busy role
// and respawns at most once per sweep"
// (specs/features/BL-1652-the-chase-sweep-never-respawns-a-busy-role-and-respawns-at-most-once-per-sweep.feature).
//
// Drives the REAL chase_sweep_lib.bb (run-sweep! -> sweep-role-inbox! ->
// decide-item-action/decide-stale-item-action) via chase_sweep_test_runner.bb
// - the SAME real fake-adapter (calls.log) harness test_chase_sweep.sh and
// the BL-499/BL-852/BL-1505 acceptance features already use - never a
// reimplementation of the respawn decision. PANE_BUSY/LANE_RUNNING/
// HEARTBEAT_AGE_SECONDS are the harness's own BL-1652 env-var seams for the
// :role-agent-busy?/:role-lane-running?/:get-heartbeat-age-seconds
// adapters.

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { trackedTmpRoot } = require('./lib/fixtureReaper');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const CHASE_SWEEP_RUNNER = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'test', 'chase_sweep_test_runner.bb');

const FEATURE = 'BL-1652 The chase sweep never respawns a busy role and respawns at most once per sweep';

const CHASE_TIMEOUT_S = 30;
const STUCK_TIMEOUT_S = 60;
const MAX_CHASES = 3;
const NOW_MS = 1758000000 * 1000;
const STALE_MTIME_S = (NOW_MS / 1000) - CHASE_TIMEOUT_S - 5;
// Comfortably past STUCK_TIMEOUT_S so every item reaches decide-stale-item-
// action (the "no recent pane-content activity" branch), regardless of
// which item ends up the sweep's one respawn candidate.
const LAST_ACTIVITY_MS = NOW_MS - 700 * 1000;
const HEARTBEAT_AGE_SECONDS = 600; // "ten minutes old" (the feature's own words)
const ITEM_IDS = ['01', '02', '03', '04', '05'];

function mkRoot() {
  const root = trackedTmpRoot('aps-bl1652-');
  for (const sub of ['inbox/new', 'inbox/in_process', 'inbox/completed', 'inbox/abandoned']) {
    fs.mkdirSync(path.join(root, sub), { recursive: true });
  }
  return root;
}

function writeStuckItem(root, id) {
  const file = path.join(root, 'inbox', 'new', `${id}_item.handoff`);
  fs.writeFileSync(
    file,
    `id: t${id}\nfrom: specifier\nto: QA\npriority: 50\ntype: note\nmessage: hi\ncreated_at: 2026-07-01T00:00:00Z\n\nhi\n`
  );
  const stamp = new Date(STALE_MTIME_S * 1000);
  fs.utimesSync(file, stamp, stamp);
  fs.writeFileSync(`${file}.chase.json`, JSON.stringify({ chaseCount: MAX_CHASES }));
  return file;
}

function runSweep(ctx, envOverrides) {
  const result = spawnSync(
    'bb',
    [CHASE_SWEEP_RUNNER, ctx.root, String(NOW_MS), 'dead', String(LAST_ACTIVITY_MS), 'QA'],
    {
      encoding: 'utf8',
      env: {
        ...process.env,
        CHASE_TIMEOUT_SECONDS: String(CHASE_TIMEOUT_S),
        STUCK_TIMEOUT_SECONDS: String(STUCK_TIMEOUT_S),
        MAX_CHASES: String(MAX_CHASES),
        HEARTBEAT_AGE_SECONDS: String(HEARTBEAT_AGE_SECONDS),
        ...envOverrides,
      },
    }
  );
  if (result.status !== 0) {
    throw new Error(`chase_sweep_test_runner.bb failed: ${result.stderr}`);
  }
  const logPath = path.join(ctx.root, 'calls.log');
  ctx.callsLog = fs.existsSync(logPath) ? fs.readFileSync(logPath, 'utf8') : '';
}

function respawnLines(callsLog) {
  return callsLog.split('\n').filter((l) => /^respawn QA$/.test(l));
}

function respawnReadingsLines(callsLog) {
  return callsLog.split('\n').filter((l) => l.startsWith('respawn-readings QA '));
}

function telemetryRespawnReadingsLines(callsLog) {
  return callsLog.split('\n').filter((l) => l.startsWith('telemetry-respawn-readings QA '));
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(
    /^a fixture root with a daemon-shaped \.swarmforge, a QA role whose heartbeat is ten minutes old, and five inbox items on QA each already chased three times$/,
    (ctx) => {
      ctx.root = mkRoot();
      ctx.itemFiles = ITEM_IDS.map((id) => writeStuckItem(ctx.root, id));
      ctx.chaseCountBefore = Object.fromEntries(
        ITEM_IDS.map((id) => [id, JSON.parse(fs.readFileSync(`${ctx.root}/inbox/new/${id}_item.handoff.chase.json`, 'utf8')).chaseCount])
      );
    }
  );

  scoped(/^the QA pane capture carries the busy footer$/, (ctx) => {
    ctx.envOverrides = { ...ctx.envOverrides, PANE_BUSY: '1' };
  });

  scoped(/^the QA pane capture carries no busy footer$/, (ctx) => {
    ctx.envOverrides = { ...ctx.envOverrides };
  });

  scoped(/^a test lane process is running with the QA worktree as its working directory$/, (ctx) => {
    ctx.envOverrides = { ...ctx.envOverrides, LANE_RUNNING: '1' };
  });

  scoped(/^no test lane process is running under the QA worktree$/, (ctx) => {
    ctx.envOverrides = { ...ctx.envOverrides };
  });

  scoped(/^the daemon's chase sweep runs once on the fixture root$/, (ctx) => {
    runSweep(ctx, ctx.envOverrides || {});
  });

  scoped(/^no chase-respawn line is logged for QA$/, (ctx) => {
    const lines = respawnReadingsLines(ctx.callsLog);
    if (lines.length !== 0) {
      throw new Error(`expected no chase-respawn line for QA, got calls.log:\n${ctx.callsLog}`);
    }
  });

  scoped(/^no respawn is triggered for QA$/, (ctx) => {
    const lines = respawnLines(ctx.callsLog);
    if (lines.length !== 0) {
      throw new Error(`expected no respawn triggered for QA, got calls.log:\n${ctx.callsLog}`);
    }
  });

  scoped(/^exactly one respawn is triggered for QA$/, (ctx) => {
    const lines = respawnLines(ctx.callsLog);
    if (lines.length !== 1) {
      throw new Error(`expected exactly one respawn for QA, got ${lines.length}. calls.log:\n${ctx.callsLog}`);
    }
  });

  scoped(
    /^exactly one chase-respawn line is logged for QA naming the triggering item, the liveness state, the heartbeat age, the pane activity age, the busy reading and the lane reading$/,
    (ctx) => {
      const lines = respawnReadingsLines(ctx.callsLog);
      if (lines.length !== 1) {
        throw new Error(`expected exactly one chase-respawn readings line for QA, got ${lines.length}. calls.log:\n${ctx.callsLog}`);
      }
      const line = lines[0];
      const m = line.match(
        /^respawn-readings QA item=(\d\d_item\.handoff) liveness=(\S+) heartbeat-age-s=(\S+) activity-age-s=(\S+) busy=(\S+) lane=(\S+)$/
      );
      if (!m) {
        throw new Error(`chase-respawn readings line missing an expected field: ${line}`);
      }
      const [, itemId, liveness, heartbeatAgeS, activityAgeS, busy, lane] = m;
      if (liveness !== 'dead') throw new Error(`expected liveness=dead, got: ${line}`);
      if (Number(heartbeatAgeS) !== HEARTBEAT_AGE_SECONDS) throw new Error(`expected heartbeat-age-s=${HEARTBEAT_AGE_SECONDS}, got: ${line}`);
      if (Number(activityAgeS) <= 0) throw new Error(`expected a positive activity-age-s, got: ${line}`);
      if (busy !== 'false' || lane !== 'false') throw new Error(`expected busy=false lane=false, got: ${line}`);
      ctx.triggeringItemId = itemId.slice(0, 2);
    }
  );

  scoped(/^the chaser telemetry carries one respawn row for QA with the same readings$/, (ctx) => {
    const lines = telemetryRespawnReadingsLines(ctx.callsLog);
    if (lines.length !== 1) {
      throw new Error(`expected exactly one telemetry respawn-readings row for QA, got ${lines.length}. calls.log:\n${ctx.callsLog}`);
    }
    const respawnLine = respawnReadingsLines(ctx.callsLog)[0].replace(/^respawn-readings /, '');
    const telemetryLine = lines[0].replace(/^telemetry-respawn-readings /, '');
    if (respawnLine !== telemetryLine) {
      throw new Error(`expected the telemetry respawn row's readings to match the chase-respawn line's exactly:\n  respawn:   ${respawnLine}\n  telemetry: ${telemetryLine}`);
    }
  });

  scoped(/^the four items that did not trigger the respawn carry the same chase count as before the sweep$/, (ctx) => {
    const lines = respawnReadingsLines(ctx.callsLog);
    if (lines.length !== 1) {
      throw new Error(`expected exactly one chase-respawn line to identify the trigger, got ${lines.length}. calls.log:\n${ctx.callsLog}`);
    }
    const m = lines[0].match(/^respawn-readings QA item=(\d\d)_item\.handoff /);
    if (!m) {
      throw new Error(`could not read the triggering item id from: ${lines[0]}`);
    }
    const triggeringItemId = m[1];
    const others = ITEM_IDS.filter((id) => id !== triggeringItemId);
    if (others.length !== 4) {
      throw new Error(`expected exactly 4 non-triggering items, got ${others.length}: ${JSON.stringify(others)}`);
    }
    for (const id of others) {
      if (ctx.callsLog.includes(`${id}_item.handoff`)) {
        throw new Error(`expected no adapter call at all for non-triggering item ${id}, got calls.log:\n${ctx.callsLog}`);
      }
      const after = JSON.parse(fs.readFileSync(`${ctx.root}/inbox/new/${id}_item.handoff.chase.json`, 'utf8')).chaseCount;
      if (after !== ctx.chaseCountBefore[id]) {
        throw new Error(`expected item ${id}'s chase count unchanged (${ctx.chaseCountBefore[id]}), got ${after}`);
      }
    }
  });
}

module.exports = { registerSteps };
