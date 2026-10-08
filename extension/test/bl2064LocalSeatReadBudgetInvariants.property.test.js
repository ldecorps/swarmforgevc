'use strict';

// BL-2064's two declared invariants (property authorship rests with the
// coder, first pass - BL-654). Runs ONLY via `npm run test:properties`
// (vitest.properties.config.mjs).
//
//   invariant 1  The read count resets on exactly what read-budget-resets?
//                resets (an edit/write_file, or a state-changing shell
//                command) - never a bare compaction.
//   invariant 2  A read-budget restart and a missed-write restart draw on
//                one per-parcel restart count; no parcel is restarted more
//                than max-restarts times for either reason, and the next
//                overrun releases it (BL-1992).
//
// Both drive the REAL local_model_repeat_guard.bb, load-file'd straight
// from swarmforge/scripts/ (never restated), following the subprocess
// pattern bl1991LocalSeatRestartInvariants.property.test.js already uses
// (one `bb -e` call per trial, printing EDN/JSON results through stdout).

const assert = require('node:assert/strict');
const fc = require('fast-check');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { assertReachFloor, runsPerCell } = require('./helpers/reachFloors');

const SCRIPTS = path.join(__dirname, '..', '..', 'swarmforge', 'scripts');
const GUARD = path.join(SCRIPTS, 'local_model_repeat_guard.bb');
const NAMED_PATH = 'specs/pipeline/steps/bl1928SeatToolingFromOriginMainSteps.js';

function callGuardLib(forms) {
  const program = `
(require '[cheshire.core :as json])
(load-file "${GUARD}")
(defn emit [v] (println (str "BL2064|" (json/generate-string v))))
${forms}`;
  const r = spawnSync('bb', ['-e', program], { encoding: 'utf8', timeout: 120000 });
  if (r.status !== 0) throw new Error(`bb failed (${r.status}): ${r.stderr}\n${r.stdout}`);
  return `${r.stdout}`
    .split('\n')
    .filter((line) => line.startsWith('BL2064|'))
    .map((line) => JSON.parse(line.slice('BL2064|'.length)));
}

// ── Invariant 1: a bare compaction never resets the read budget ─────────

const specKind = fc.constantFrom('read', 'compaction', 'edit', 'shell-reset', 'other');

function entryForm(spec, idx) {
  switch (spec) {
    case 'read':
      return `{:kind :call :record ${idx} :name "read_file" :args {"file_path" "/probe-${idx}"}}`;
    case 'compaction':
      return `{:kind :compaction :next-step "keep going"}`;
    case 'edit':
      return `{:kind :call :record ${idx} :name "edit" :args {"file_path" "/x" "old_string" "a" "new_string" "b"}}`;
    case 'shell-reset':
      return `{:kind :call :record ${idx} :name "run_shell_command" :args {"command" "git commit -m wip"}}`;
    case 'other':
      return `{:kind :call :record ${idx} :name "run_shell_command" :args {"command" "echo hi"}}`;
    default:
      throw new Error(`unknown spec kind: ${spec}`);
  }
}

// The reference count a correct implementation must produce: only an edit
// or a shell-reset starts the window over; a compaction and "other" pass
// through uncounted, exactly reads-since-write's own documented contract.
function expectedReadsSinceWrite(specs) {
  let sinceReset = 0;
  for (const s of specs) {
    if (s === 'edit' || s === 'shell-reset') sinceReset = 0;
    else if (s === 'read') sinceReset += 1;
  }
  return sinceReset;
}

function realReadsSinceWrite(specs) {
  const entries = `[${specs.map((s, i) => entryForm(s, i)).join(' ')}]`;
  const [result] = callGuardLib(
    `(emit (local-model-repeat-guard/reads-since-write ${entries} "read_file" {"file_path" "/probe-final"}))`
  );
  return result;
}

const CELLS_1 = ['withCompaction', 'withoutCompaction'];
const DRAWS_1 = 24;
const CELL_FLOOR_1 = runsPerCell(DRAWS_1, CELLS_1.length);

test('property (BL-2064 invariant 1): reads-since-write counts reads since the last edit/write or state-changing command, and a bare compaction never resets it', () => {
  const cellCoverage = {};
  for (let i = 0; i < DRAWS_1; i += 1) {
    const cell = CELLS_1[i % CELLS_1.length];
    cellCoverage[cell] = (cellCoverage[cell] || 0) + 1;
    const drawn = fc.sample(fc.array(specKind, { minLength: 0, maxLength: 25 }), 1)[0];
    // Construct the cell rather than hope a random draw lands in it
    // (BL-1062): "withCompaction" guarantees at least one compaction is
    // present; "withoutCompaction" strips every one out.
    const specs = cell === 'withCompaction' ? [...drawn, 'compaction'] : drawn.filter((s) => s !== 'compaction');
    const expected = expectedReadsSinceWrite(specs);
    const actual = realReadsSinceWrite(specs);
    assert.equal(actual, expected, `specs=${JSON.stringify(specs)}`);
  }
  assertReachFloor(cellCoverage, CELLS_1, CELL_FLOOR_1, 'BL-2064 invariant-1 cell');
});

test('property (BL-2064 invariant 1) non-vacuity: a compaction placed right before the budget threshold would hide an overrun under the OLD (resets-window?) reset rule, but not under read-budget-resets?', () => {
  // 20 reads, a compaction, 3 more reads, one more read in flight: 24 total.
  // resets-window? (the superseded rule) WOULD treat the compaction as a
  // reset and report only 3; read-budget-resets? (the real rule) must not.
  const specs = [...Array(20).fill('read'), 'compaction', ...Array(3).fill('read')];
  assert.equal(realReadsSinceWrite(specs), 23, 'the in-flight call is not counted by reads-since-write itself');
  assert.equal(expectedReadsSinceWrite(specs), 23);
});

// ── Invariant 2: one shared per-parcel restart count ─────────────────────
//
// read-budget-restart-decision/read-budget-release-decision and
// restart-decision/release-decision are each gated on the identical
// `restart-count < max-restarts` / `>= max-restarts` threshold, over the
// SAME restart-count value answer reads from one state file per parcel
// (restart-state-file keys only on the in-process handoff name, never on
// the reason) - proving the gate is identical for both proves the count
// they draw on in production is the same one.

function decisionForms(kind, restartCount) {
  // 23 prior reads + the in-flight call = 24 total: exactly the read-budget
  // threshold, with no compaction at all (so missed-write can never fire -
  // named-write-path of a nil next-step is nil - isolating the read-budget
  // decision pair).
  const entries = `[${Array.from({ length: 23 }, (_, i) => entryForm('read', i)).join(' ')}]`;
  const fn = kind === 'restart' ? 'read-budget-restart-decision' : 'read-budget-release-decision';
  return `(emit (local-model-repeat-guard/${fn} ${entries} "read_file" {"file_path" "/probe-final"} ${restartCount}))`;
}

test('property (BL-2064 invariant 2): a read-budget overrun restarts below max-restarts and releases at or past it - never both, never neither', () => {
  fc.assert(
    fc.property(fc.integer({ min: 0, max: 5 }), (restartCount) => {
      const [restart] = callGuardLib(decisionForms('restart', restartCount));
      const [release] = callGuardLib(decisionForms('release', restartCount));
      if (restartCount < 2) {
        assert.ok(restart, `restart-count ${restartCount} < max-restarts must restart`);
        assert.equal(release, null, `restart-count ${restartCount} < max-restarts must not also release`);
      } else {
        assert.equal(restart, null, `restart-count ${restartCount} >= max-restarts must not restart`);
        assert.ok(release, `restart-count ${restartCount} >= max-restarts must release`);
      }
      return true;
    }),
    { numRuns: 12 }
  );
});

test('property (BL-2064 invariant 2) shared counter: a missed write already restarted once leaves only ONE read-budget restart before the parcel is released, never two', () => {
  // A compaction naming a real write path, one non-matching call since it
  // (not three - missed-write never fires here), then enough prior reads
  // that the in-flight call is the 24th read overall: read-budget fires
  // independently of missed-write's own trigger, sharing restart-count.
  const priorReads = Array.from({ length: 22 }, (_, i) => entryForm('read', i));
  const compaction = `{:kind :compaction :next-step "Write ${NAMED_PATH} and run its feature."}`;
  const postCompactionRead = entryForm('read', 22);
  const entries = `[${priorReads.join(' ')} ${compaction} ${postCompactionRead}]`;
  const inFlight = '"read_file" {"file_path" "/probe-final"}';

  // Sanity: at this exact shape, missed-write must NOT fire (only one
  // non-matching call since the compaction, not three) - otherwise this
  // test would not isolate what it claims to.
  const [missedWriteAtZero] = callGuardLib(`(emit (local-model-repeat-guard/missed-write ${entries} ${inFlight} "/does-not-matter"))`);
  assert.equal(missedWriteAtZero, null, 'this fixture must not also trigger a missed-write decision');

  // restart-count 1 (one restart already spent, by either reason): the
  // read-budget overrun still restarts - the shared counter's last slot.
  const [restartAtOne] = callGuardLib(`(emit (local-model-repeat-guard/read-budget-restart-decision ${entries} ${inFlight} 1))`);
  assert.ok(restartAtOne, 'the second restart, from a different reason than the first, must still be allowed');

  // restart-count 2 (both slots already spent): the SAME overrun now
  // releases instead of restarting a third time.
  const [restartAtTwo] = callGuardLib(`(emit (local-model-repeat-guard/read-budget-restart-decision ${entries} ${inFlight} 2))`);
  const [releaseAtTwo] = callGuardLib(`(emit (local-model-repeat-guard/read-budget-release-decision ${entries} ${inFlight} 2))`);
  assert.equal(restartAtTwo, null, 'no third restart, whichever reason asks for it');
  assert.ok(releaseAtTwo, 'the parcel releases once both shared slots are spent');
});

// ── Invariant 2, end-to-end cap (read-budget-only, mirrors BL-1991's own
//    "neverWrites" cell for the missed-write path) ───────────────────────

function simulateReadOnlyForms(n) {
  return `
(defn simulate-read-only [n]
  (loop [entries [] restart-count 0 i 0 restarts-done 0 releases-done 0]
    (if (>= i n)
      {:restarts restarts-done :releases releases-done}
      (let [args {"file_path" (str "/probe-" i)}
            entries2 (conj entries {:kind :call :record (count entries) :name "read_file" :args args})
            rb (local-model-repeat-guard/read-budget-restart-decision entries2 "read_file" args restart-count)
            rel (when-not rb (local-model-repeat-guard/read-budget-release-decision entries2 "read_file" args restart-count))]
        (cond
          rb (recur [] (inc restart-count) (inc i) (inc restarts-done) releases-done)
          rel (recur entries2 restart-count (inc i) restarts-done (inc releases-done))
          :else (recur entries2 restart-count (inc i) restarts-done releases-done)))))
  )
(emit (simulate-read-only ${n}))`;
}

test('property (BL-2064 invariant 2) end-to-end: a seat that only ever reads is restarted via the read budget at most max-restarts times, and every overrun past the cap releases it', () => {
  // Two restarts each consume their own fresh 24-read window (calls 1-24,
  // 25-48); the first release is the 24th read of the THIRD window, at
  // call 72 (0-indexed i=71) - releases-done is then exactly n-71 for
  // n>71, since nothing ever resets the window again.
  for (const n of [72, 90, 130]) {
    const [result] = callGuardLib(simulateReadOnlyForms(n));
    assert.equal(result.restarts, 2, `a long read-only run of ${n} calls must restart exactly twice, never more or fewer`);
    assert.equal(result.releases, n - 71, `expected exactly ${n - 71} releases over ${n} calls, got: ${JSON.stringify(result)}`);
  }
});
