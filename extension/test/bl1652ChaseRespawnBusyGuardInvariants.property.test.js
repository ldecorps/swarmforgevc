'use strict';

// BL-1652's two declared invariants (coder first authorship - BL-654):
//
// Invariant 1: "A role is never respawned while its own pane shows the busy
// footer or a test lane is running under its worktree; liveness read from a
// stale heartbeat alone never respawns a role whose pane or lane is alive."
// Encoded directly against the real, pure chase-sweep-lib/decide-stale-
// item-action over a generated spread of (chaseCount, maxChases, liveness,
// busy, lane) - never a reimplementation of the decision.
//
// Invariant 2: "One sweep respawns a role at most once, however many of its
// inbox items have reached the chase ceiling, and each respawn writes one
// log line naming the role, the item that triggered it, the liveness
// state, the heartbeat age, the pane activity age, the busy reading and
// the lane reading." Encoded against the real, impure chase-sweep-lib/run-
// sweep! (via chase_sweep_test_runner.bb, the same fake-adapter calls.log
// harness BL-499/BL-852/BL-1505/this ticket's own acceptance feature all
// share) over a generated item count, proving exactly one respawn (never
// zero, never more than one) fires regardless of how many items reached
// the ceiling in the same sweep.
//
// Runs ONLY via `npm run test:properties`.

const assert = require('node:assert/strict');
const fc = require('fast-check');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const { SUBPROCESS_HEAVY_TIMEOUT_MS } = require('./helpers/subprocessHeavyTimeout');
const { mkTmpDir } = require('./helpers/tmpDir');

const REPO_ROOT = path.join(__dirname, '..', '..');
const CHASE = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'chase_sweep_lib.bb');
const CHASE_SWEEP_RUNNER = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'test', 'chase_sweep_test_runner.bb');

const MAX_CHASES = 3;
const LIVENESS_VALUES = ['alive', 'idle', 'unknown', 'dead', 'stuck'];
const UNRESPONSIVE = new Set(['dead', 'unknown', 'stuck']);

function cljBool(b) {
  return b ? 'true' : 'false';
}

// ── Invariant 1 ──────────────────────────────────────────────────────────

function decideStaleBatch(cases) {
  const vec = cases
    .map(({ chaseCount, liveness, busy, lane }) => `[${chaseCount} "${liveness}" ${cljBool(busy)} ${cljBool(lane)}]`)
    .join(' ');
  const script = `
(load-file "${CHASE}")
(doseq [[chaseCount liveness busy lane] [${vec}]]
  (println (chase-sweep-lib/decide-stale-item-action chaseCount {:maxChases ${MAX_CHASES}} liveness busy lane)))
`;
  return execFileSync('bb', ['-e', script], { encoding: 'utf8' }).trim().split('\n');
}

test(
  'property (BL-1652 invariant 1): a role at the chase ceiling is never respawned while busy or lane-running is true',
  () => {
    let draws = 0;
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            chaseCount: fc.integer({ min: MAX_CHASES, max: MAX_CHASES + 5 }),
            liveness: fc.constantFrom(...LIVENESS_VALUES),
            busy: fc.boolean(),
            lane: fc.boolean(),
          }),
          { minLength: 1, maxLength: 12 }
        ),
        (cases) => {
          draws += 1;
          const decisions = decideStaleBatch(cases);
          assert.equal(decisions.length, cases.length);
          cases.forEach((c, i) => {
            if (c.busy || c.lane) {
              assert.equal(
                decisions[i],
                'chased',
                `expected "chased" for a busy/lane-running role at the ceiling (busy=${c.busy} lane=${c.lane} liveness=${c.liveness}), got ${decisions[i]}`
              );
            } else {
              const expected = UNRESPONSIVE.has(c.liveness) ? 'respawned' : 'dead-lettered';
              assert.equal(
                decisions[i],
                expected,
                `expected "${expected}" with neither busy nor lane set (liveness=${c.liveness}), got ${decisions[i]} - the busy/lane guard must never change the decision when both are false`
              );
            }
          });
        }
      ),
      { numRuns: 15 }
    );
    assert.ok(draws >= 10);
  },
  SUBPROCESS_HEAVY_TIMEOUT_MS
);

test('property (BL-1652 invariant 1) boundary: below the chase ceiling, busy/lane never matter - always "chased"', () => {
  const cases = [];
  for (const liveness of LIVENESS_VALUES) {
    for (const busy of [true, false]) {
      for (const lane of [true, false]) {
        cases.push({ chaseCount: 0, liveness, busy, lane });
      }
    }
  }
  const decisions = decideStaleBatch(cases);
  decisions.forEach((d, i) => assert.equal(d, 'chased', `case ${JSON.stringify(cases[i])} expected "chased" below the ceiling, got ${d}`));
});

test('property (BL-1652 invariant 1) non-vacuity: a broken guard that ignores busy/lane would respawn - proven against a scratch copy, then restored', () => {
  const original = fs.readFileSync(CHASE, 'utf8');
  const marker = '(or pane-busy? lane-running?) "chased"';
  assert.ok(original.includes(marker), 'expected to find the BL-1652 busy/lane guard clause to remove for the non-vacuity probe');
  const broken = original.replace(`${marker}\n    `, '');
  assert.notEqual(broken, original, 'expected the textual removal to actually change the file');

  const brokenPath = path.join(path.dirname(CHASE), `bl1652-non-vacuity-scratch-${process.pid}-${Date.now()}.bb`);
  fs.writeFileSync(brokenPath, broken);
  try {
    const script = `
(load-file "${brokenPath}")
(println (chase-sweep-lib/decide-stale-item-action ${MAX_CHASES} {:maxChases ${MAX_CHASES}} "dead" true true))
`;
    const decision = execFileSync('bb', ['-e', script], { encoding: 'utf8' }).trim();
    assert.equal(
      decision,
      'respawned',
      'expected the broken (guard-removed) decision to respawn a busy+lane-running role at the ceiling, proving the real guard is load-bearing'
    );
  } finally {
    fs.rmSync(brokenPath, { force: true });
  }
});

// ── Invariant 2 ──────────────────────────────────────────────────────────

const NOW_MS = 1758100000 * 1000;
const CHASE_TIMEOUT_S = 30;
const STUCK_TIMEOUT_S = 60;
const STALE_MTIME_S = NOW_MS / 1000 - CHASE_TIMEOUT_S - 5;
const LAST_ACTIVITY_MS = NOW_MS - 700 * 1000;

function buildFixture(itemCount) {
  const root = mkTmpDir('bl1652-prop-');
  for (const sub of ['new', 'in_process', 'completed', 'abandoned']) {
    fs.mkdirSync(path.join(root, 'inbox', sub), { recursive: true });
  }
  for (let i = 0; i < itemCount; i += 1) {
    const id = String(i).padStart(2, '0');
    const file = path.join(root, 'inbox', 'new', `${id}_item.handoff`);
    fs.writeFileSync(
      file,
      `id: t${id}\nfrom: specifier\nto: QA\npriority: 50\ntype: note\nmessage: hi\ncreated_at: 2026-07-01T00:00:00Z\n\nhi\n`
    );
    const stamp = new Date(STALE_MTIME_S * 1000);
    fs.utimesSync(file, stamp, stamp);
    fs.writeFileSync(`${file}.chase.json`, JSON.stringify({ chaseCount: MAX_CHASES }));
  }
  return root;
}

function runSweep(root) {
  const result = spawnSync('bb', [CHASE_SWEEP_RUNNER, root, String(NOW_MS), 'dead', String(LAST_ACTIVITY_MS), 'QA'], {
    encoding: 'utf8',
    env: {
      ...process.env,
      CHASE_TIMEOUT_SECONDS: String(CHASE_TIMEOUT_S),
      STUCK_TIMEOUT_SECONDS: String(STUCK_TIMEOUT_S),
      MAX_CHASES: String(MAX_CHASES),
      HEARTBEAT_AGE_SECONDS: '600',
    },
  });
  if (result.status !== 0) {
    throw new Error(`chase_sweep_test_runner.bb failed: ${result.stderr}`);
  }
  const logPath = path.join(root, 'calls.log');
  return fs.existsSync(logPath) ? fs.readFileSync(logPath, 'utf8') : '';
}

test(
  'property (BL-1652 invariant 2): however many items reach the chase ceiling in one sweep, exactly one respawn fires and its line carries every reading',
  () => {
    let draws = 0;
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 15 }), (itemCount) => {
        draws += 1;
        const root = buildFixture(itemCount);
        try {
          const callsLog = runSweep(root);
          const respawnLines = callsLog.split('\n').filter((l) => /^respawn QA$/.test(l));
          assert.equal(respawnLines.length, 1, `expected exactly one respawn for ${itemCount} stuck items, got ${respawnLines.length}:\n${callsLog}`);

          const readingsLines = callsLog.split('\n').filter((l) => l.startsWith('respawn-readings QA '));
          assert.equal(readingsLines.length, 1, `expected exactly one chase-respawn readings line, got ${readingsLines.length}:\n${callsLog}`);
          const m = readingsLines[0].match(
            /^respawn-readings QA item=(\d+_item\.handoff) liveness=(\S+) heartbeat-age-s=(\S+) activity-age-s=(\S+) busy=(\S+) lane=(\S+)$/
          );
          assert.ok(m, `expected the readings line to name every field, got: ${readingsLines[0]}`);
          const [, itemId, liveness, heartbeatAgeS, activityAgeS, busy, lane] = m;
          assert.ok(itemId, 'expected a triggering item id');
          assert.equal(liveness, 'dead');
          assert.equal(Number(heartbeatAgeS), 600, 'expected the heartbeat age reading to be named');
          assert.ok(Number(activityAgeS) > 0, 'expected a positive pane activity age');
          assert.equal(busy, 'false');
          assert.equal(lane, 'false');

          const telemetryReadingsLines = callsLog.split('\n').filter((l) => l.startsWith('telemetry-respawn-readings QA '));
          assert.equal(telemetryReadingsLines.length, 1, `expected exactly one telemetry respawn readings row, got ${telemetryReadingsLines.length}:\n${callsLog}`);
          assert.equal(
            telemetryReadingsLines[0].replace(/^telemetry-respawn-readings /, ''),
            readingsLines[0].replace(/^respawn-readings /, ''),
            'expected the telemetry respawn row to carry the same readings as the chase-respawn line'
          );
        } finally {
          fs.rmSync(root, { recursive: true, force: true });
        }
      }),
      { numRuns: 8 }
    );
    assert.ok(draws >= 5);
  },
  SUBPROCESS_HEAVY_TIMEOUT_MS
);

test(
  'property (BL-1652 invariant 2) non-vacuity: without the per-sweep cap, N stuck items would fire N respawns - proven against a scratch copy, then restored',
  () => {
    const original = fs.readFileSync(CHASE, 'utf8');
    const marker = '@respawned-this-sweep? nil\n                     :else (do (reset! respawned-this-sweep? true) "respawned"))]';
    assert.ok(original.includes(marker), 'expected to find the BL-1652 per-sweep cap clause to remove for the non-vacuity probe');
    const broken = original.replace(marker, ':else (do (reset! respawned-this-sweep? true) "respawned"))]');
    assert.notEqual(broken, original, 'expected the textual removal to actually change the file');

    const brokenPath = path.join(path.dirname(CHASE), `bl1652-non-vacuity-scratch2-${process.pid}-${Date.now()}.bb`);
    fs.writeFileSync(brokenPath, broken);
    const brokenRunner = path.join(path.dirname(CHASE_SWEEP_RUNNER), `bl1652-non-vacuity-runner-${process.pid}-${Date.now()}.bb`);
    const runnerOriginal = fs.readFileSync(CHASE_SWEEP_RUNNER, 'utf8');
    fs.writeFileSync(brokenRunner, runnerOriginal.replace('".." "chase_sweep_lib.bb"', `".." "${path.basename(brokenPath)}"`));
    const root = buildFixture(5);
    try {
      const result = spawnSync('bb', [brokenRunner, root, String(NOW_MS), 'dead', String(LAST_ACTIVITY_MS), 'QA'], {
        encoding: 'utf8',
        env: {
          ...process.env,
          CHASE_TIMEOUT_SECONDS: String(CHASE_TIMEOUT_S),
          STUCK_TIMEOUT_SECONDS: String(STUCK_TIMEOUT_S),
          MAX_CHASES: String(MAX_CHASES),
        },
      });
      assert.equal(result.status, 0, `expected the scratch runner to succeed: ${result.stderr}`);
      const callsLog = fs.readFileSync(path.join(root, 'calls.log'), 'utf8');
      const respawnLines = callsLog.split('\n').filter((l) => /^respawn QA$/.test(l));
      assert.equal(
        respawnLines.length,
        5,
        `expected the cap-removed sweep to fire one respawn per stuck item (5), got ${respawnLines.length} - proving the real per-sweep cap is load-bearing:\n${callsLog}`
      );
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
      fs.rmSync(brokenPath, { force: true });
      fs.rmSync(brokenRunner, { force: true });
    }
  },
  SUBPROCESS_HEAVY_TIMEOUT_MS
);
