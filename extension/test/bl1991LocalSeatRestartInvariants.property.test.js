'use strict';

// BL-1991's two declared invariants (property authorship rests with the
// coder, first pass - BL-654). Runs ONLY via `npm run test:properties`
// (vitest.properties.config.mjs).
//
//   invariant 1  No hook ever refuses a tool call: the repeat guard and
//                this check stay warnings or restarts, never a deny.
//   invariant 2  A parcel's seat is restarted at most twice for a missed
//                write, and never after it made the named write since
//                that compaction.
//
// Both drive the REAL local_model_repeat_guard.bb, load-file'd straight
// from swarmforge/scripts/ (never restated), over generated call
// sequences. Invariant 2's simulation runs entirely inside one `bb`
// process per trial - a loop over `restart-decision`, the pure function
// the hook itself calls - so a restart and the fresh-transcript turn it
// starts are modeled without ever touching a filesystem or a real
// process (the ticket's own direction: fixture transcripts and a fake
// process controller, never the live seat).

const assert = require('node:assert/strict');
const fs = require('node:fs');
const fc = require('fast-check');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { assertReachFloor, runsPerCell } = require('./helpers/reachFloors');
const { mkTmpDir } = require('./helpers/tmpDir');

const SCRIPTS = path.join(__dirname, '..', '..', 'swarmforge', 'scripts');
const GUARD = path.join(SCRIPTS, 'local_model_repeat_guard.bb');
const NAMED_PATH = 'specs/pipeline/steps/bl1928SeatToolingFromOriginMainSteps.js';

// `spawnCwd` pins the `bb` SUBPROCESS's own working directory (never the
// event's "cwd" field, which is a separate string inside `forms`/`program`
// itself). This exists so a test can probe the "no event cwd" hazard
// (BL-1991's own commit message: "the old fallback to this process's own
// cwd let a stray test invocation write real state and kill a real parent
// process") WITHOUT risking a real write: if the code under test were ever
// to regress to that fallback, `System/getProperty "user.dir"` reads
// THIS pinned sandbox, never the real worktree - defaults to the real repo
// (today's correct, inert behavior writes nothing there either way).
function callGuardLib(forms, spawnCwd) {
  const program = `
(require '[cheshire.core :as json])
(load-file "${GUARD}")
(defn emit [v] (println (str "BL1991|" (json/generate-string v))))
${forms}`;
  const r = spawnSync('bb', ['-e', program], { encoding: 'utf8', timeout: 120000, cwd: spawnCwd });
  if (r.status !== 0) throw new Error(`bb failed (${r.status}): ${r.stderr}\n${r.stdout}`);
  return `${r.stdout}`
    .split('\n')
    .filter((line) => line.startsWith('BL1991|'))
    .map((line) => JSON.parse(line.slice('BL1991|'.length)));
}

// Encodes a call-sequence simulation entirely in Clojure so one `bb`
// process drives the whole trial: on a restart, the entries vector is
// reset to just the original compaction (a fresh qwen turn whose only
// message resumes the same outstanding next step), the durable count
// bumps, and the next call in the sequence is decided against that fresh
// state - exactly what write-restart-request!/the launcher loop produce.
function simulateForms(calls, namedPath) {
  const ednCalls = `[${calls
    .map((c) => `{:type ${JSON.stringify(c.type)} :probe ${JSON.stringify(c.probe || '')}}`)
    .join(' ')}]`;
  return `
(defn simulate [calls path0]
  (let [base [{:kind :compaction :next-step (str "Write " path0 " and run its feature.")}]]
    (loop [entries base restart-count 0 remaining calls restarts-done 0]
      (if (empty? remaining)
        {:restarts restarts-done}
        (let [c (first remaining)
              write? (= (:type c) "write")
              name (if write? "write_file" "read_file")
              args (if write? {"file_path" path0} {"file_path" (:probe c)})
              entries2 (conj entries {:kind :call :record (count entries) :name name :args args})
              decision (local-model-repeat-guard/restart-decision entries2 name args "/does-not-matter" restart-count)]
          (if decision
            (recur base (inc restart-count) (rest remaining) (inc restarts-done))
            (recur entries2 restart-count (rest remaining) restarts-done)))))))
(emit (simulate ${ednCalls} ${JSON.stringify(namedPath)}))`;
}

function simulate(calls) {
  const [result] = callGuardLib(simulateForms(calls, NAMED_PATH));
  return result;
}

const probeName = fc.string({ minLength: 1, maxLength: 8 }).map((s) => `/probe-${s.replace(/[^a-zA-Z0-9]/g, 'x') || 'p'}`);
const otherRun = (min, max) =>
  fc.array(probeName, { minLength: min, maxLength: max }).map((probes) => probes.map((probe) => ({ type: 'other', probe })));

const CELLS = ['writesBeforeThird', 'neverWrites', 'writeAfterRestartsAreCapped'];
const DRAWS = 15;
const CELL_FLOOR = runsPerCell(DRAWS, CELLS.length);

test('property (BL-1991 invariant 2): a parcel restarts at most twice, and never again once it made the named write', () => {
  const cellCoverage = {};
  for (let i = 0; i < DRAWS; i += 1) {
    const cell = CELLS[i % CELLS.length];
    cellCoverage[cell] = (cellCoverage[cell] || 0) + 1;

    if (cell === 'writesBeforeThird') {
      // At most two non-matching calls, then the write: never a restart.
      const n = fc.sample(fc.integer({ min: 0, max: 2 }), 1)[0];
      const others = fc.sample(otherRun(n, n), 1)[0];
      const calls = [...others, { type: 'write' }];
      const { restarts } = simulate(calls);
      assert.equal(restarts, 0, `a write within the first two calls must never restart the seat (n=${n})`);
    } else if (cell === 'neverWrites') {
      // Long enough to exhaust both restarts; the cap must bind at
      // exactly 2, never more, however long the seat keeps reading.
      const n = fc.sample(fc.integer({ min: 9, max: 20 }), 1)[0];
      const others = fc.sample(otherRun(n, n), 1)[0];
      const { restarts } = simulate(others);
      assert.equal(restarts, 2, `a seat that never writes must be restarted exactly twice over ${n} other calls, never more or fewer`);
    } else {
      // Use up exactly ONE of the two restarts with a pure "other" run,
      // THEN write, THEN keep making other calls past the third-call
      // trigger point again. restart-count is only 1 here (< the cap of
      // 2), so the cap alone cannot explain a lack of a second restart -
      // only "the write already happened since this compaction" can. A
      // tail of at least 3 guarantees (by construction, not luck) that the
      // post-write run reaches its own third-call trigger point.
      const preExhaust = fc.sample(otherRun(3, 3), 1)[0];
      const tailLen = fc.sample(fc.integer({ min: 3, max: 6 }), 1)[0];
      const tail = fc.sample(otherRun(tailLen, tailLen), 1)[0];
      const calls = [...preExhaust, { type: 'write' }, ...tail];
      const { restarts } = simulate(calls);
      assert.equal(
        restarts,
        1,
        `only the pre-write restart may count; chatter past the trigger point after the write must never add a second (tail=${tailLen})`
      );
    }
  }
  assertReachFloor(cellCoverage, CELLS, CELL_FLOOR, 'BL-1991 restart-count cell');
});

// Invariant 1: whatever the hook decides, it is never a refusal. A refusal
// would be a PreToolUse-shaped "permissionDecision"/"deny"/"block" field;
// this hook only ever answers PostToolUse with additionalContext, or with
// nothing. Generated over arbitrary tool names/args and transcript shapes,
// including malformed ones, run through the REAL `answer`.
function callAnswer(event, transcriptLines, spawnCwd) {
  const ednLines = `[${transcriptLines.map((l) => JSON.stringify(l)).join(' ')}]`;
  // The event crosses into Clojure as a JSON STRING literal, parsed with
  // json/parse-string on the Clojure side - JSON.stringify's `"key":` is
  // not EDN and fails to parse pasted straight into a bb form (BL-1344's
  // own fixture hits the identical trap).
  const program = `
(def lines ${ednLines})
(def event (json/parse-string ${JSON.stringify(JSON.stringify(event))}))
(def out (local-model-repeat-guard/answer event (fn [_] lines) (fn [] nil)))
(emit {:out out})`;
  return callGuardLib(program, spawnCwd)[0];
}

const toolName = fc.constantFrom('read_file', 'run_shell_command', 'edit', 'write_file', 'weird_tool');
const toolArgs = fc.oneof(
  fc.constant({}),
  fc.record({ file_path: fc.string({ maxLength: 20 }) }),
  fc.record({ command: fc.string({ maxLength: 20 }) })
);
const transcriptLine = fc.oneof(
  fc.constant('not json'),
  fc.string({ maxLength: 10 }),
  fc.record({ type: fc.constant('assistant'), message: fc.constant({ role: 'model', parts: [] }) }).map((o) => JSON.stringify(o))
);

test('property (BL-1991 invariant 1): the hook never answers with a refusal, only a note or nothing', () => {
  fc.assert(
    fc.property(toolName, toolArgs, fc.array(transcriptLine, { maxLength: 6 }), (name, args, lines) => {
      const { out } = callAnswer({ tool_name: name, tool_input: args, transcript_path: '/does-not-matter', cwd: '/does-not-matter' }, lines);
      if (out == null) return true;
      const parsed = JSON.parse(out);
      assert.ok(parsed.hookSpecificOutput, `expected a hookSpecificOutput envelope, got: ${out}`);
      assert.equal(parsed.hookSpecificOutput.hookEventName, 'PostToolUse');
      assert.ok(!('permissionDecision' in parsed.hookSpecificOutput), `the hook must never carry permissionDecision: ${out}`);
      assert.ok(!('decision' in parsed.hookSpecificOutput), `the hook must never carry a decision field: ${out}`);
      return true;
    }),
    { numRuns: 40 }
  );
});

// BL-1991 hardening: the ticket's own words name TWO trigger verbs, "a
// write or an edit" (approval_context, the feature's own title and intro),
// and named-write-path's regex has a dedicated alternation for each
// (write|writes|edit|edits) - but every acceptance scenario, and the
// property test above, only ever drives a next-step reading "Write ...".
// Hand-mutating out the edit|edits alternative left the acceptance suite,
// the BL-1971 shell regression, and this property test's own invariants
// all green: nothing exercised the second half of the FIRM-approved verb
// set. Pinned directly against the real named-write-path/restart-decision,
// one `bb` call, no filesystem or process.
test('named-write-path recognizes "edit"/"edits" exactly as it recognizes "write"/"writes" - the ticket names both verbs', () => {
  const forms = `
(emit {:edit (local-model-repeat-guard/named-write-path "Edit ${NAMED_PATH} to add the missing case.")
       :edits (local-model-repeat-guard/named-write-path "The next step edits ${NAMED_PATH}.")
       :write (local-model-repeat-guard/named-write-path "Write ${NAMED_PATH} now.")
       :writes (local-model-repeat-guard/named-write-path "The next step writes ${NAMED_PATH}.")
       :neither (local-model-repeat-guard/named-write-path "Review ${NAMED_PATH} for correctness.")})`;
  const [result] = callGuardLib(forms);
  assert.equal(result.edit, NAMED_PATH, `"Edit <path>" must name the path, got: ${JSON.stringify(result.edit)}`);
  assert.equal(result.edits, NAMED_PATH, `"edits <path>" must name the path, got: ${JSON.stringify(result.edits)}`);
  assert.equal(result.write, NAMED_PATH);
  assert.equal(result.writes, NAMED_PATH);
  assert.equal(result.neither, null, `a next step with neither verb must name nothing, got: ${JSON.stringify(result.neither)}`);

  // And restart-decision itself: an "edit"-phrased next step, three other
  // calls, no cap hit yet - must decide to restart exactly as a
  // "write"-phrased one does (scenario 01's own shape, with the verb
  // swapped).
  const decisionForms = `
(emit (local-model-repeat-guard/restart-decision
        [{:kind :compaction :next-step "Edit ${NAMED_PATH} to add the missing case."}
         {:kind :call :record 0 :name "read_file" :args {"file_path" "/probe-1"}}
         {:kind :call :record 1 :name "read_file" :args {"file_path" "/probe-2"}}]
        "read_file" {"file_path" "/probe-3"} "/does-not-matter" 0))`;
  const [decision] = callGuardLib(decisionForms);
  assert.ok(decision, `an "edit"-phrased next step must restart on the third non-matching call, got: ${JSON.stringify(decision)}`);
  assert.equal(decision['next-step'], `Edit ${NAMED_PATH} to add the missing case.`);
  assert.equal(decision.path, NAMED_PATH);
});

// ── BL-1991 hazard the ticket's own commit message names: no event cwd ──
//
// "the old fallback to this process's own cwd let a stray test invocation
// write real state and kill a real parent process in this very worktree -
// restart state now only ever reads an explicit event cwd". Every other
// test here (and the step handler's own fixtures) always sets an explicit
// `cwd`, so nothing exercises the inert path itself. Hand-mutating the
// `(and entries (string? restart-cwd))` guard away - reintroducing the
// fallback to `System/getProperty "user.dir"` - left the acceptance suite,
// the BL-1971 shell regression, the launch-script shell test, AND both
// property invariants above all green: nothing caught the exact hazard the
// ticket was written to close.
//
// `spawnCwd` pins the `bb` SUBPROCESS to a disposable sandbox (never the
// event's own cwd, which this test omits entirely) - even if the code
// under test were to regress to the `user.dir` fallback, the write would
// land in the sandbox, never a real worktree, and this test would still
// catch it by finding a stray file there.
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

test('a missing event cwd leaves restart completely inert - never kills, never writes state, even under a sandbox that stands in for the real process cwd', () => {
  const sandbox = mkTmpDir('bl1991-no-cwd-sandbox-');
  // in-process-handoff-name requires a real in_process dir with a file in
  // it (restart-state-file's own precondition) - without this, the test
  // would be VACUOUS: restart-state-file returns nil regardless of cwd
  // correctness, so it could never discriminate the mutant either way.
  const inProcessDir = path.join(sandbox, '.swarmforge', 'handoffs', 'inbox', 'in_process');
  fs.mkdirSync(inProcessDir, { recursive: true });
  fs.writeFileSync(path.join(inProcessDir, 'parcel-01.handoff'), 'type: git_handoff\nto: coder@2\n');
  const nextStep = `Write ${NAMED_PATH} and run its feature.`;
  const lines = [compactionLine(nextStep), callLine('read_file', { file_path: '/probe-1' }), callLine('read_file', { file_path: '/probe-2' })];
  // The third non-matching call - the exact trigger point scenario 01
  // uses - with NO "cwd" key in the event at all.
  const event = { tool_name: 'read_file', tool_input: { file_path: '/probe-3' }, transcript_path: '/does-not-matter' };
  const { out } = callAnswer(event, lines, sandbox);

  const restartDir = path.join(sandbox, '.swarmforge', 'local-seat-restart');
  assert.ok(!fs.existsSync(restartDir), `a missing event cwd must never create restart state anywhere, found: ${restartDir}`);
  // Invariant 1 still applies: no refusal shape, whatever notes (if any) came back.
  if (out != null) {
    const parsed = JSON.parse(out);
    assert.ok(!('permissionDecision' in (parsed.hookSpecificOutput || {})));
  }
});
