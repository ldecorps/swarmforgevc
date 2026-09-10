'use strict';

// BL-1505 declared invariant (coder first authorship — BL-654):
// "For any parcel and any sequence of chase sweeps, the chase count the
// sidecar records equals the number of sweeps that decided to chase it,
// independent of whether each wake's text was injected or dedup-suppressed."
//
// Drives chase_sweep_lib.bb's real run-sweep! (never a reimplementation)
// against a single stale, unheld, non-terminal parcel across a generated
// sequence of :send-wake-up! outcomes: a chase-poke-and-notify!-shaped
// {:attempted true :landed bool} map for every sweep that entered :wake
// mode (landed or dedup-suppressed, chase-poke-and-notify!'s :skip branch
// is out of scope - the ticket keeps it uncounted and untouched), asserting
// the sidecar's chaseCount after N sweeps equals N regardless of the
// landed/suppressed mix. A second test proves the {:attempted false}
// boundary (no attempt made) contributes nothing, and that legacy plain-
// boolean adapters (every pre-BL-1505 fixture) keep meaning exactly what
// they did before.
//
// Non-vacuity: reverting apply-inbox-item-action!'s "chased" branch to gate
// on the adapter's raw truthy return (the pre-BL-1505 shape) undercounts a
// mixed landed/suppressed sequence - proven below, then restored.
//
// Runs ONLY via `npm run test:properties`.

const assert = require('node:assert/strict');
const fc = require('fast-check');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { SUBPROCESS_HEAVY_TIMEOUT_MS } = require('./helpers/subprocessHeavyTimeout');
const { mkTmpDir } = require('./helpers/tmpDir');

const REPO_ROOT = path.join(__dirname, '..', '..');
const CHASE = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'chase_sweep_lib.bb');

const BASE_MS = 1751500000000;
const CHASE_TIMEOUT_SECONDS = 30;
const STALE_MTIME_MS = BASE_MS - (CHASE_TIMEOUT_SECONDS + 5) * 1000;
// A large gap between sweeps: compute-chase-backoff-seconds grows as
// base(1s) * 2^chaseCount, capped at stuckInProcessTimeoutSeconds (set huge
// below) - at chaseCount 6 (this test's max sequence length) that is 64s,
// comfortably under this 200s step, so every generated sweep's
// decide-item-action still answers "chased" rather than being backed off.
const SWEEP_STEP_MS = 200000;

function mkFixture() {
  const root = mkTmpDir('bl1505-prop-');
  for (const sub of ['new', 'in_process', 'completed', 'abandoned']) {
    fs.mkdirSync(path.join(root, 'inbox', sub), { recursive: true });
  }
  const handoffPath = path.join(root, 'inbox', 'new', '00_item.handoff');
  fs.writeFileSync(
    handoffPath,
    'id: t\nfrom: specifier\nto: coder\npriority: 50\ntype: note\nmessage: hi\ncreated_at: 2026-07-01T00:00:00Z\n\nhi\n'
  );
  fs.utimesSync(handoffPath, new Date(STALE_MTIME_MS), new Date(STALE_MTIME_MS));
  return { root, handoffPath };
}

// Runs run-sweep! exactly once at nowMs, with :send-wake-up! returning
// wakeResultLiteral verbatim (a babashka literal: "true", "false", or a map
// like "{:attempted true :landed false}").
function runOneSweep(root, nowMs, wakeResultLiteral) {
  const script = `
(load-file "${CHASE}")
(def adapters
  {:get-liveness (fn [_role] "alive")
   :send-wake-up! (fn [_role] ${wakeResultLiteral})
   :trigger-respawn! (fn [_role] nil)
   :log-dead-letter! (fn [_role _path] nil)
   :get-last-activity-ms (fn [_role] ${nowMs})
   :on-stuck-escalation! (fn [_role _escalated] nil)
   :log-telemetry! (fn [_event _now-ms] nil)
   :get-rate-limit-cooldown-until-ms (fn [_role] nil)
   :get-rate-limit-cooldown-woken-marker (fn [_role] nil)
   :mark-rate-limit-cooldown-woken! (fn [_role _until-ms] nil)})
(chase-sweep-lib/run-sweep!
 [{:role "coder"
   :inbox-new-dir "${path.join(root, 'inbox', 'new')}"
   :in-process-dir "${path.join(root, 'inbox', 'in_process')}"
   :completed-dir "${path.join(root, 'inbox', 'completed')}"
   :abandoned-dir "${path.join(root, 'inbox', 'abandoned')}"}]
 ${nowMs}
 {:chaseIntervalSeconds 1 :chaseTimeoutSeconds ${CHASE_TIMEOUT_SECONDS} :maxChases 1000
  :stuckInProcessTimeoutSeconds 1000000 :respawnCooldownSeconds 300}
 adapters)
`;
  execFileSync('bb', ['-e', script], { encoding: 'utf8' });
}

function readChaseCount(handoffPath) {
  const sidecarPath = `${handoffPath}.chase.json`;
  if (!fs.existsSync(sidecarPath)) return 0;
  return JSON.parse(fs.readFileSync(sidecarPath, 'utf8')).chaseCount;
}

test(
  'BL-1505/BL-654 invariant: chaseCount equals attempted sweeps regardless of landed vs dedup-suppressed',
  () => {
    let draws = 0;
    fc.assert(
      fc.property(fc.array(fc.boolean(), { minLength: 1, maxLength: 6 }), (landedFlags) => {
        draws += 1;
        const { root, handoffPath } = mkFixture();
        try {
          landedFlags.forEach((landed, i) => {
            const nowMs = BASE_MS + (i + 1) * SWEEP_STEP_MS;
            runOneSweep(root, nowMs, `{:attempted true :landed ${landed}}`);
          });
          const got = readChaseCount(handoffPath);
          assert.equal(
            got,
            landedFlags.length,
            `expected chaseCount ${landedFlags.length} after a mixed landed/suppressed sequence ${JSON.stringify(landedFlags)}, got ${got}`
          );
        } finally {
          fs.rmSync(root, { recursive: true, force: true });
        }
      }),
      { numRuns: 8 }
    );
    assert.ok(draws >= 4);
  },
  SUBPROCESS_HEAVY_TIMEOUT_MS
);

test(
  'BL-1505/BL-654 invariant boundary: an unattempted wake contributes nothing, legacy booleans unchanged',
  () => {
    const { root, handoffPath } = mkFixture();
    try {
      // {:attempted false} - no attempt was made (pane busy / injection
      // disabled) - must not advance the counter at all.
      runOneSweep(root, BASE_MS + SWEEP_STEP_MS, '{:attempted false :landed false}');
      assert.equal(readChaseCount(handoffPath), 0, 'expected no chase count for an unattempted wake');

      // Legacy plain-boolean adapters (every pre-BL-1505 fixture) keep
      // meaning exactly what they always did: false = not counted.
      runOneSweep(root, BASE_MS + SWEEP_STEP_MS * 2, 'false');
      assert.equal(readChaseCount(handoffPath), 0, 'expected a legacy false return to still count as not attempted');

      // ...and true = counted (attempted and landed).
      runOneSweep(root, BASE_MS + SWEEP_STEP_MS * 3, 'true');
      assert.equal(readChaseCount(handoffPath), 1, 'expected a legacy true return to still count as attempted/landed');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  },
  SUBPROCESS_HEAVY_TIMEOUT_MS
);

// Non-vacuity: the pre-BL-1505 shape gates "chased" on the adapter's raw
// truthy return (equivalent to :landed, not :attempted). A dedup-suppressed
// sweep ({:landed false}) is truthy as a map, so a naive revert back to
// `(when (adapter-call) ...)` would OVER-count (every map is truthy) rather
// than under-count - proving the fix must key on :attempted specifically,
// not merely stop gating on a raw boolean. Exercised against a hand-built
// broken copy of chase_sweep_lib.bb (never the checked-out file), removed
// after the assertion, so this never leaves a modified production file
// behind.
test(
  'BL-1505/BL-654 non-vacuity: keying on the raw adapter return (not :attempted) misclassifies a dedup-suppressed sweep',
  () => {
    const original = fs.readFileSync(CHASE, 'utf8');
    const brokenMarker = '"chased" (when (wake-result->attempted? ((:send-wake-up! adapters) role))';
    assert.ok(original.includes(brokenMarker), 'expected to find the BL-1505 :attempted gate to revert for the non-vacuity probe');
    const broken = original.replace(brokenMarker, '"chased" (when ((:send-wake-up! adapters) role)');
    assert.notEqual(broken, original, 'expected the textual revert to actually change the file');

    // Written ALONGSIDE the real scripts (never to os.tmpdir()) so its own
    // sibling load-file calls (handoff_lib.bb et al, resolved relative to
    // *file*'s own parent dir) still find them - same idiom
    // bl943FixtureCleanupVerdictSteps.js's injected-failure scratch copy
    // uses for the identical reason.
    const brokenPath = path.join(path.dirname(CHASE), `bl1505-non-vacuity-scratch-${process.pid}-${Date.now()}.bb`);
    fs.writeFileSync(brokenPath, broken);
    const { root, handoffPath } = mkFixture();
    try {
      const script = `
(load-file "${brokenPath}")
(def adapters
  {:get-liveness (fn [_role] "alive")
   :send-wake-up! (fn [_role] {:attempted false :landed false})
   :trigger-respawn! (fn [_role] nil)
   :log-dead-letter! (fn [_role _path] nil)
   :get-last-activity-ms (fn [_role] ${BASE_MS + SWEEP_STEP_MS})
   :on-stuck-escalation! (fn [_role _escalated] nil)
   :log-telemetry! (fn [_event _now-ms] nil)
   :get-rate-limit-cooldown-until-ms (fn [_role] nil)
   :get-rate-limit-cooldown-woken-marker (fn [_role] nil)
   :mark-rate-limit-cooldown-woken! (fn [_role _until-ms] nil)})
(chase-sweep-lib/run-sweep!
 [{:role "coder"
   :inbox-new-dir "${path.join(root, 'inbox', 'new')}"
   :in-process-dir "${path.join(root, 'inbox', 'in_process')}"
   :completed-dir "${path.join(root, 'inbox', 'completed')}"
   :abandoned-dir "${path.join(root, 'inbox', 'abandoned')}"}]
 ${BASE_MS + SWEEP_STEP_MS}
 {:chaseIntervalSeconds 1 :chaseTimeoutSeconds ${CHASE_TIMEOUT_SECONDS} :maxChases 1000
  :stuckInProcessTimeoutSeconds 1000000 :respawnCooldownSeconds 300}
 adapters)
`;
      execFileSync('bb', ['-e', script], { encoding: 'utf8' });
      const got = readChaseCount(handoffPath);
      assert.notEqual(
        got,
        0,
        'expected the broken (raw-truthy) gate to misclassify an {:attempted false} map as a chase (proving the fix must read :attempted, not just any truthy return)'
      );
    } finally {
      fs.rmSync(brokenPath, { force: true });
      fs.rmSync(root, { recursive: true, force: true });
    }
  },
  SUBPROCESS_HEAVY_TIMEOUT_MS
);
