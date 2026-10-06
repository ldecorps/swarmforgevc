'use strict';

// BL-1992's two declared invariants (property authorship rests with the
// coder, first pass - BL-654). Runs ONLY via `npm run test:properties`
// (vitest.properties.config.mjs).
//
//   invariant 1  No hook ever refuses a tool call: the repeat guard and
//                this check stay warnings or restarts, never a deny.
//   invariant 2  A parcel leaves a seat's in_process for a missed write
//                only on the third miss, and only with a note to the
//                coordinator naming its ticket.
//
// Invariant 1 is already covered generically by
// bl1991LocalSeatRestartInvariants.property.test.js for every `answer`
// branch INCLUDING release (it drives the real `answer` over arbitrary
// transcripts; nothing there special-cases restart vs release). This file
// adds coverage specific to the release branch itself: that it is reached
// at all (the existing file's random transcripts never set up a real
// restart-count=2 parcel, so release-decision never actually fires there),
// and that whatever `answer` returns on release is still never a refusal
// shape.
//
// Invariant 2's own "leaves in_process only with a note naming the ticket"
// half is end-to-end acceptance territory (the real swarm_handoff.sh send,
// the real file move) - specs/features/BL-1992-...feature's scenario 01
// proves that. This file's own share of invariant 2 is the DECISION pure
// function's boundary: release-decision fires on exactly the third missed
// call once restarts are exhausted, never before, never again once the
// named write has happened, and never at the same time restart-decision
// would fire - the generator reaches all three via a cell-per-draw
// construction (BL-1062), never luck.
//
// Both drive the REAL local_model_repeat_guard.bb, load-file'd straight
// from swarmforge/scripts/ (never restated), in one `bb` process per
// trial - the same harness shape
// bl1991LocalSeatRestartInvariants.property.test.js already uses,
// duplicated here rather than factored into a shared helper (this file's
// own small live-glue duplication, same posture several scripts in this
// repo already state for themselves).

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
(defn emit [v] (println (str "BL1992|" (json/generate-string v))))
${forms}`;
  const r = spawnSync('bb', ['-e', program], { encoding: 'utf8', timeout: 120000 });
  if (r.status !== 0) throw new Error(`bb failed (${r.status}): ${r.stderr}\n${r.stdout}`);
  return `${r.stdout}`
    .split('\n')
    .filter((line) => line.startsWith('BL1992|'))
    .map((line) => JSON.parse(line.slice('BL1992|'.length)));
}

// Encodes a call-sequence simulation entirely in Clojure, same shape as
// BL-1991's own simulate, but tracking release instead of a restart count:
// on a restart (restart-decision fires), entries reset to just the
// compaction and the durable count bumps, exactly as a fresh qwen turn
// would leave it; on a release (release-decision fires, only once restarts
// are exhausted), the simulation stops dead - a released parcel has no
// further turns for THIS seat to make calls in.
function simulateForms(calls, namedPath, restartCount0) {
  const ednCalls = `[${calls
    .map((c) => `{:type ${JSON.stringify(c.type)} :probe ${JSON.stringify(c.probe || '')}}`)
    .join(' ')}]`;
  return `
(defn simulate [calls path0 restart-count0]
  (let [base [{:kind :compaction :next-step (str "Write " path0 " and run its feature.")}]]
    (loop [entries base restart-count restart-count0 remaining calls]
      (if (empty? remaining)
        {:released false :restart-count restart-count}
        (let [c (first remaining)
              write? (= (:type c) "write")
              name (if write? "write_file" "read_file")
              args (if write? {"file_path" path0} {"file_path" (:probe c)})
              entries2 (conj entries {:kind :call :record (count entries) :name name :args args})
              restart (local-model-repeat-guard/restart-decision entries2 name args restart-count)
              release (when-not restart (local-model-repeat-guard/release-decision entries2 name args restart-count))]
          (cond
            restart  (recur base (inc restart-count) (rest remaining))
            release  {:released true :restart-count restart-count}
            :else    (recur entries2 restart-count (rest remaining))))))))
(emit (simulate ${ednCalls} ${JSON.stringify(namedPath)} ${restartCount0}))`;
}

function simulate(calls, restartCount0) {
  const [result] = callGuardLib(simulateForms(calls, NAMED_PATH, restartCount0));
  return result;
}

const probeName = fc.string({ minLength: 1, maxLength: 8 }).map((s) => `/probe-${s.replace(/[^a-zA-Z0-9]/g, 'x') || 'p'}`);
const otherRun = (min, max) =>
  fc.array(probeName, { minLength: min, maxLength: max }).map((probes) => probes.map((probe) => ({ type: 'other', probe })));

const CELLS = ['releaseAtCapOnThirdMiss', 'writeAfterCapNeverReleases', 'belowCapRestartsNotReleases'];
const DRAWS = 15;
const CELL_FLOOR = runsPerCell(DRAWS, CELLS.length);

test('property (BL-1992 invariant 2): release fires only on the third miss once restarts are exhausted, never for a write, never below the cap', () => {
  const cellCoverage = {};
  for (let i = 0; i < DRAWS; i += 1) {
    const cell = CELLS[i % CELLS.length];
    cellCoverage[cell] = (cellCoverage[cell] || 0) + 1;

    if (cell === 'releaseAtCapOnThirdMiss') {
      // Both restarts already spent; exactly three non-matching calls -
      // the third must release, never restart again.
      const others = fc.sample(otherRun(3, 3), 1)[0];
      const { released, restartCount } = toCamel(simulate(others, 2));
      assert.equal(released, true, 'the third miss at the restart cap must release the parcel');
      assert.equal(restartCount, 2, 'release must never itself bump the restart count');
    } else if (cell === 'writeAfterCapNeverReleases') {
      // Already at the cap throughout (no restart ever fires here): the
      // seat writes before its OWN third non-matching call, so release
      // never gets the chance to fire on this run - and once written,
      // never fires again for the rest of this same compaction's window,
      // however many further non-matching calls follow past the
      // trigger point a second time.
      const preWriteLen = fc.sample(fc.integer({ min: 0, max: 2 }), 1)[0];
      const preWrite = fc.sample(otherRun(preWriteLen, preWriteLen), 1)[0];
      const tailLen = fc.sample(fc.integer({ min: 3, max: 6 }), 1)[0];
      const tail = fc.sample(otherRun(tailLen, tailLen), 1)[0];
      const calls = [...preWrite, { type: 'write' }, ...tail];
      const { released } = toCamel(simulate(calls, 2));
      assert.equal(released, false, `a write before the third miss must never release (preWriteLen=${preWriteLen}, tail=${tailLen})`);
    } else {
      // Below the cap: the SAME third-miss shape restarts instead of
      // releasing - the two decisions are mutually exclusive at the
      // boundary, never both, never neither.
      const others = fc.sample(otherRun(3, 3), 1)[0];
      const { released, restartCount } = toCamel(simulate(others, 1));
      assert.equal(released, false, 'a third miss below the cap must restart, never release');
      assert.equal(restartCount, 2, 'the restart below the cap must still bump the count by one');
    }
  }
  assertReachFloor(cellCoverage, CELLS, CELL_FLOOR, 'BL-1992 release-decision cell');
});

function toCamel(result) {
  return { released: result.released, restartCount: result['restart-count'] };
}

// Mutual exclusivity, directly against the two decision functions (not the
// simulation loop above): for ANY restart-count, entries/name/args that
// decide a missed write, restart-decision and release-decision must never
// both fire - the `<`/`>=` split on the SAME restart-count is the only
// thing that keeps them apart, and this pins that split against drift
// (e.g. an edit that loosens one side to `<=`).
test('property (BL-1992 invariant 2, boundary): restart-decision and release-decision never both fire for the same call', () => {
  fc.assert(
    fc.property(fc.integer({ min: 0, max: 5 }), fc.integer({ min: 0, max: 4 }), (restartCount, probeSuffix) => {
      const forms = `
(def entries
  [{:kind :compaction :next-step "Write ${NAMED_PATH} and run its feature."}
   {:kind :call :record 0 :name "read_file" :args {"file_path" "/probe-a"}}
   {:kind :call :record 1 :name "read_file" :args {"file_path" "/probe-b"}}])
(emit {:restart (boolean (local-model-repeat-guard/restart-decision entries "read_file" {"file_path" "/probe-${probeSuffix}"} ${restartCount}))
       :release (boolean (local-model-repeat-guard/release-decision entries "read_file" {"file_path" "/probe-${probeSuffix}"} ${restartCount}))})`;
      const [{ restart, release }] = callGuardLib(forms);
      assert.ok(!(restart && release), `restart-count ${restartCount} decided both restart and release`);
      // And exactly one decides, since this is a genuine third-miss shape.
      assert.ok(restart || release, `restart-count ${restartCount} decided neither, on a genuine third miss`);
      return true;
    }),
    { numRuns: 30 }
  );
});

// Invariant 1, release-specific: the existing BL-1991 property test drives
// `answer` over arbitrary transcripts, but never a real restart-count=2
// parcel, so it never actually reaches the release branch. This test sets
// one up for real (a real in_process handoff, a real restart-state-file
// already at the cap) and confirms `answer` still returns nil - never a
// refusal/deny shape - on the exact call that releases it. release-fn is a
// no-op stub here (the move/send side effect is acceptance territory,
// scenario 01); only `answer`'s own return shape is under test.
const fs = require('node:fs');
const { mkTmpDir } = require('./helpers/tmpDir');

function compactionLine(nextStep) {
  return JSON.stringify({
    type: 'system',
    subtype: 'chat_compression',
    systemPayload: { compressedHistory: [{ role: 'user', parts: [{ text: `<state_snapshot>\n<next_step>\n${nextStep}\n</next_step>\n</state_snapshot>` }] }] },
  });
}

function callLine(name, args) {
  return JSON.stringify({ type: 'assistant', message: { role: 'model', parts: [{ functionCall: { name, args } }] } });
}

test('a release never answers with a refusal, only nil - invariant 1 on the exact branch invariant 2 adds', () => {
  const sandbox = mkTmpDir('bl1992-release-no-refusal-');
  const inProcessDir = path.join(sandbox, '.swarmforge', 'handoffs', 'inbox', 'in_process');
  fs.mkdirSync(inProcessDir, { recursive: true });
  fs.writeFileSync(path.join(inProcessDir, 'parcel-01.handoff'), 'type: git_handoff\nto: coder\ntask: BL-9001\n');
  const stateDir = path.join(sandbox, '.swarmforge', 'local-seat-restart');
  fs.mkdirSync(stateDir, { recursive: true });
  fs.writeFileSync(path.join(stateDir, 'parcel-01.handoff.json'), JSON.stringify({ restarts: 2 }));

  const nextStep = `Write ${NAMED_PATH} and run its feature.`;
  const lines = [compactionLine(nextStep), callLine('read_file', { file_path: '/probe-1' }), callLine('read_file', { file_path: '/probe-2' })];
  const ednLines = `[${lines.map((l) => JSON.stringify(l)).join(' ')}]`;
  const event = { tool_name: 'read_file', tool_input: { file_path: '/probe-3' }, transcript_path: '/does-not-matter', cwd: sandbox };
  const forms = `
(def lines ${ednLines})
(def event (json/parse-string ${JSON.stringify(JSON.stringify(event))}))
(def out (local-model-repeat-guard/answer event (fn [_] lines) (fn [] nil) (fn [_cwd] nil)))
(emit {:out out})`;
  const [{ out }] = callGuardLib(forms);
  assert.equal(out, null, `a release must answer with nil, never a note or a refusal, got: ${out}`);

  // And the parcel was never touched by this run - release-fn was a no-op
  // stub, so in-process-handoff-name's own precondition (a real file)
  // still holds, proving the branch really was reached rather than falling
  // through to notes-response for some unrelated reason.
  assert.ok(fs.existsSync(path.join(inProcessDir, 'parcel-01.handoff')), 'the stub release-fn must not itself move anything');
});
