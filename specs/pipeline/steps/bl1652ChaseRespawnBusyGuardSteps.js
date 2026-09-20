'use strict';

// BL-1652: step handlers for "The chase sweep never respawns a busy role
// and respawns at most once per sweep" (feature authored by the specifier
// at mint - this file only implements ITS scenarios, never rewrites them).
//
// Every scenario drives the REAL handoffd.bb daemon's own one-shot
// `--chase-sweep-once` mode (a real fixture root under mkdtemp, BL-1390;
// a fake-but-real tmux binary on PATH; for scenario 02, a REAL background
// process scoped to the role's own worktree) - never chase_sweep_lib.bb's
// pure decision layer alone (that is test_chase_sweep.sh's job) and never
// a second, divergent reimplementation of the daemon's own decision.
// Mirrors test/test_handoffd_bl1652_chase_respawn_busy_lane_guard.sh's own
// fixture shape (the ticket's separately-required wiring shell test) so
// the two can never disagree about what "a daemon-shaped fixture" means.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync, execSync } = require('node:child_process');
const { mkProcessTmpDir } = require('../../../extension/test/helpers/tmpDir');

const FEATURE = 'BL-1652 The chase sweep never respawns a busy role and respawns at most once per sweep';

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const HANDOFFD = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'handoffd.bb');

const FAKE_TMUX_SCRIPT = `#!/usr/bin/env bash
echo "$*" >> "$TMUX_LOG"
for a in "$@"; do
  if [[ "$a" == "capture-pane" ]]; then
    if [[ -f "$PANE_BUSY_FLAG" ]]; then
      printf '$ some prior output\\n* Cooking… (12s · esc to interrupt)\\n'
    else
      printf '$ \\n'
    fi
    exit 0
  fi
done
exit 0
`;

function ensureState(ctx) {
  if (!ctx.bl1652) {
    const root = mkProcessTmpDir('bl1652acc-');
    const wtQa = path.join(root, 'wt-qa');
    const inboxNew = path.join(wtQa, '.swarmforge', 'handoffs', 'inbox', 'new');
    fs.mkdirSync(inboxNew, { recursive: true });
    fs.mkdirSync(path.join(root, '.swarmforge', 'heartbeat'), { recursive: true });
    fs.mkdirSync(path.join(root, '.swarmforge', 'daemon'), { recursive: true });
    fs.writeFileSync(path.join(root, 'fake.sock'), '');
    fs.writeFileSync(path.join(root, '.swarmforge', 'tmux-socket'), path.join(root, 'fake.sock'));
    fs.writeFileSync(path.join(root, '.swarmforge', 'roles.tsv'), `QA\tqa\t${wtQa}\tswarmforge-qa\tQA\tclaude\ttask\n`);

    const fakeBin = path.join(root, 'bin');
    fs.mkdirSync(fakeBin, { recursive: true });
    const tmuxPath = path.join(fakeBin, 'tmux');
    fs.writeFileSync(tmuxPath, FAKE_TMUX_SCRIPT);
    fs.chmodSync(tmuxPath, 0o755);

    // Five inbox items, each already chased three times (at the ceiling)
    // and old enough to clear chaseTimeoutSeconds (30s) against real
    // wall-clock time - the Background's own fixture shape.
    const nowSec = Math.floor(Date.now() / 1000);
    for (let i = 1; i <= 5; i += 1) {
      const file = path.join(inboxNew, `0${i}_item.handoff`);
      fs.writeFileSync(
        file,
        'id: t\nfrom: specifier\nto: QA\npriority: 00\ntype: note\nmessage: hi\ncreated_at: 2026-07-01T00:00:00Z\n\nhi\n'
      );
      const mtimeSec = nowSec - 45;
      fs.utimesSync(file, mtimeSec, mtimeSec);
      fs.writeFileSync(`${file}.chase.json`, JSON.stringify({ chaseCount: 3 }));
    }

    // A stale heartbeat, ten minutes old, non-in-flight, this PROCESS's own
    // pid (alive throughout) - liveness classifies "dead" via the stale-
    // heartbeat path, matching the 2026-09-19 incident narrative exactly,
    // never via a missing/dead pid.
    const tenMinAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString().replace(/\.\d+Z$/, 'Z');
    fs.writeFileSync(
      path.join(root, '.swarmforge', 'heartbeat', 'QA.yaml'),
      `last_beat: "${tenMinAgo}"\nin_flight: false\npid: ${process.pid}\n`
    );

    ctx.bl1652 = {
      root,
      wtQa,
      inboxNew,
      fakeBin,
      tmuxLog: path.join(root, 'tmux-calls.log'),
      paneBusyFlag: path.join(root, 'pane-busy-flag'),
      handoffdLog: path.join(root, '.swarmforge', 'daemon', 'handoffd.log'),
      lanePid: null,
    };
  }
  return ctx.bl1652;
}

function runChaseSweepOnce(state) {
  fs.writeFileSync(state.tmuxLog, '');
  fs.writeFileSync(state.handoffdLog, '');
  const env = {
    ...process.env,
    PATH: `${state.fakeBin}:${process.env.PATH}`,
    TMUX_LOG: state.tmuxLog,
    PANE_BUSY_FLAG: state.paneBusyFlag,
    // BL-406: this mkdtemp root is an intentional throwaway test fixture.
    SWARMFORGE_ALLOW_TMP_DAEMON: '1',
  };
  delete env.OPENROUTER_API_KEY;
  delete env.CLAUDE_CODE_MAX_OUTPUT_TOKENS;
  const result = spawnSync('bb', [HANDOFFD, state.root, '--chase-sweep-once'], { encoding: 'utf8', timeout: 15000, env });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`handoffd.bb --chase-sweep-once failed (status ${result.status}): ${result.stderr || result.stdout}`);
  }
  state.tmuxCalls = fs.existsSync(state.tmuxLog) ? fs.readFileSync(state.tmuxLog, 'utf8') : '';
  state.handoffdLogText = fs.existsSync(state.handoffdLog) ? fs.readFileSync(state.handoffdLog, 'utf8') : '';
}

function chaserTelemetryRespawnRows(state) {
  const telemetryDir = path.join(state.root, '.swarmforge', 'telemetry');
  if (!fs.existsSync(telemetryDir)) return [];
  const rows = [];
  for (const name of fs.readdirSync(telemetryDir)) {
    if (!name.startsWith('chaser-') || !name.endsWith('.jsonl')) continue;
    const lines = fs.readFileSync(path.join(telemetryDir, name), 'utf8').split('\n').filter(Boolean);
    for (const line of lines) {
      const event = JSON.parse(line);
      if (event.type === 'respawn' && event.role === 'QA') rows.push(event);
    }
  }
  return rows;
}

function itemChaseCounts(state) {
  const counts = {};
  for (let i = 1; i <= 5; i += 1) {
    const sidecar = path.join(state.inboxNew, `0${i}_item.handoff.chase.json`);
    counts[`0${i}_item.handoff`] = JSON.parse(fs.readFileSync(sidecar, 'utf8')).chaseCount;
  }
  return counts;
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  // ── Background ────────────────────────────────────────────────────────
  scoped(
    /^a fixture root with a daemon-shaped \.swarmforge, a QA role whose heartbeat is ten minutes old, and five inbox items on QA each already chased three times$/,
    (ctx) => {
      ensureState(ctx);
    }
  );

  // ── Given ─────────────────────────────────────────────────────────────
  scoped(/^the QA pane capture carries the busy footer$/, (ctx) => {
    fs.writeFileSync(ensureState(ctx).paneBusyFlag, '1');
  });

  scoped(/^the QA pane capture carries no busy footer$/, (ctx) => {
    const state = ensureState(ctx);
    if (fs.existsSync(state.paneBusyFlag)) fs.unlinkSync(state.paneBusyFlag);
  });

  scoped(/^a test lane process is running with the QA worktree as its working directory$/, (ctx) => {
    const state = ensureState(ctx);
    // exec -a renames the child's own argv0 to "vitest" so chase_sweep_lib.
    // bb's lane-process-cmdline? regex matches it - a REAL process, real
    // /proc/<pid>/cwd, never a mocked process-table reading.
    const child = require('node:child_process').spawn(
      'bash',
      ['-c', 'cd "$1" && exec -a vitest sleep 30', '--', state.wtQa],
      { detached: true, stdio: 'ignore' }
    );
    state.lanePid = child.pid;
    execSync('sleep 0.3'); // let the renamed process actually start before the sweep reads /proc
  });

  scoped(/^no test lane process is running under the QA worktree$/, (ctx) => {
    ensureState(ctx); // no-op: the fixture starts with no lane process by default
  });

  // ── When ──────────────────────────────────────────────────────────────
  scoped(/^the daemon's chase sweep runs once on the fixture root$/, (ctx) => {
    const state = ensureState(ctx);
    state.chaseCountsBefore = itemChaseCounts(state);
    runChaseSweepOnce(state);
    if (state.lanePid) {
      try {
        process.kill(state.lanePid, 'SIGKILL');
      } catch {
        /* already gone */
      }
      state.lanePid = null;
    }
  });

  // ── Then ──────────────────────────────────────────────────────────────
  scoped(/^no chase-respawn line is logged for QA$/, (ctx) => {
    const state = ensureState(ctx);
    assert.doesNotMatch(
      state.handoffdLogText,
      /chase-respawn QA /,
      `expected no chase-respawn line for QA; log: ${state.handoffdLogText}`
    );
  });

  scoped(/^no respawn is triggered for QA$/, (ctx) => {
    const state = ensureState(ctx);
    assert.doesNotMatch(state.tmuxCalls, /respawn-pane/, `expected no real tmux respawn-pane call; tmux log: ${state.tmuxCalls}`);
  });

  scoped(/^exactly one respawn is triggered for QA$/, (ctx) => {
    const state = ensureState(ctx);
    const calls = state.tmuxCalls.split('\n').filter((l) => l.includes('respawn-pane'));
    assert.equal(calls.length, 1, `expected exactly 1 real tmux respawn-pane call, got ${calls.length}; tmux log: ${state.tmuxCalls}`);
  });

  scoped(
    /^exactly one chase-respawn line is logged for QA naming the triggering item, the liveness state, the heartbeat age, the pane activity age, the busy reading and the lane reading$/,
    (ctx) => {
      const state = ensureState(ctx);
      const lines = state.handoffdLogText.split('\n').filter((l) => l.includes('chase-respawn QA '));
      assert.equal(lines.length, 1, `expected exactly one chase-respawn line, got ${lines.length}; log: ${state.handoffdLogText}`);
      assert.match(
        lines[0],
        /chase-respawn QA item=\S+ liveness=dead heartbeat-age-s=[0-9.]+ activity-age-s=[0-9.eE+-]+ busy=false lane=false/,
        `unexpected chase-respawn line shape: ${lines[0]}`
      );
    }
  );

  scoped(/^the chaser telemetry carries one respawn row for QA with the same readings$/, (ctx) => {
    const state = ensureState(ctx);
    const rows = chaserTelemetryRespawnRows(state);
    assert.equal(rows.length, 1, `expected exactly one respawn telemetry row for QA, got ${rows.length}: ${JSON.stringify(rows)}`);
    const row = rows[0];
    assert.equal(row.liveness, 'dead', `telemetry row liveness mismatch: ${JSON.stringify(row)}`);
    assert.equal(row.busy, false, `telemetry row busy mismatch: ${JSON.stringify(row)}`);
    assert.equal(row.lane, false, `telemetry row lane mismatch: ${JSON.stringify(row)}`);
    assert.ok(
      typeof row['heartbeat-age-s'] === 'number' && row['heartbeat-age-s'] > 0,
      `telemetry row missing/bad heartbeat-age-s: ${JSON.stringify(row)}`
    );
    assert.ok(
      typeof row['activity-age-s'] === 'number' && row['activity-age-s'] > 0,
      `telemetry row missing/bad activity-age-s: ${JSON.stringify(row)}`
    );
  });

  scoped(/^the four items that did not trigger the respawn carry the same chase count as before the sweep$/, (ctx) => {
    const state = ensureState(ctx);
    const before = state.chaseCountsBefore;
    const after = itemChaseCounts(state);
    for (const name of Object.keys(before)) {
      assert.equal(after[name], before[name], `item ${name} chaseCount changed after the sweep: before=${before[name]} after=${after[name]}`);
    }
  });
}

module.exports = { registerSteps };
