'use strict';

// BL-1726's one declared invariant: "The janitor never signals a
// llama-server unless its command line shows it is ollama's own worker:
// its executable inside an ollama lib directory and its --model an ollama
// model blob."
//
// Send-back D1 (2026-09-25, backlog/evidence/BL-1726-bounce-20260925.md):
// drives reapable-ollama-ghost? (orphan_janitor_lib.bb) over a CONSTRUCTED
// command-line space - the executable (inside an ollama lib dir / a
// llama.cpp build / PATH-resolved / `ollama runner`) x the model (an
// ollama blob / any other path) x parent liveness, age and the
// live-window flag - and asserts: whenever the predicate reaps a
// llama-server, both ownership marks (ollama-own-llama-server-cmdline?)
// are true. `ollama runner` is constructed too (it is one of the four
// command-line shapes the janitor classifies), but it reaps by name alone
// (BL-1705) - its own expected value never depends on the llama-server
// ownership marks, so it is asserted separately, never folded into the
// D1 implication itself.
//
// All 64 cases are evaluated in ONE bb process (BL-1724's lesson applied
// to a new file: a fresh bb load per case is the exact per-file cost this
// epic exists to avoid), never fc-sampled - BL-1697/BL-1703's own
// precedent for a state space this small: random sampling over few
// discrete values can miss a value entirely.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { mkTmpDir } = require('./helpers/tmpDir');

const LIB = path.join(__dirname, '..', '..', 'swarmforge', 'scripts', 'orphan_janitor_lib.bb');

// `marksExecutable`/`marksModel` are this test's OWN, independent ground
// truth for each constructed shape - never derived by calling the
// predicate under test. Deriving "expected" from the same function the
// test drives is vacuous: a mutation that drops the --model check still
// makes reap and a marks value computed via that same broken function
// agree with each other (confirmed empirically - the first draft of this
// file passed unchanged against exactly that mutation).
const EXECUTABLES = [
  { label: 'ollama-lib', shape: 'llama-server', cmd: '/usr/lib/ollama/llama-server', marksExecutable: true },
  { label: 'llama-cpp-build', shape: 'llama-server', cmd: '/home/u/llama.cpp/build/bin/llama-server', marksExecutable: false },
  { label: 'path-resolved', shape: 'llama-server', cmd: 'llama-server', marksExecutable: false },
  { label: 'ollama-runner', shape: 'ollama-runner', cmd: 'ollama runner', marksExecutable: false },
];

const MODELS = [
  { label: 'ollama-blob', arg: '--model /home/u/.ollama/models/blobs/sha256-64b53b64abc123', marksModel: true },
  { label: 'other-path', arg: '--model /data/models/local.gguf', marksModel: false },
];

const BOOLS = [true, false];
const AGES = [0, 999999999];

function buildCases() {
  const cases = [];
  for (const exe of EXECUTABLES) {
    for (const model of MODELS) {
      for (const parentLiveOllamaServe of BOOLS) {
        for (const inLiveWindowSet of BOOLS) {
          for (const ageMs of AGES) {
            const id = `${cases.length}`;
            const cmdline = `${exe.cmd} ${model.arg}`;
            cases.push({
              id,
              exe,
              model,
              parentLiveOllamaServe,
              inLiveWindowSet,
              ageMs,
              cmdline,
              key: `${exe.label}:${model.label}:${parentLiveOllamaServe}:${inLiveWindowSet}:${ageMs}`,
            });
          }
        }
      }
    }
  }
  return cases;
}

// One form per case, printing `id\treap` - reap from the real
// reapable-ollama-ghost?. Ownership marks are this test's OWN ground
// truth (see EXECUTABLES/MODELS above), never re-derived by also calling
// ollama-own-llama-server-cmdline? here.
function runAllCases(cases) {
  const forms = cases
    .map(
      ({ id, cmdline, parentLiveOllamaServe, inLiveWindowSet, ageMs }) => `(print "${id}")(print "\\t")
(println (orphan-janitor-lib/reapable-ollama-ghost? {:in-live-window-set? ${inLiveWindowSet} :cmdline "${cmdline}" :parent-orphaned? false :parent-live-ollama-serve? ${parentLiveOllamaServe} :age-ms ${ageMs} :grace-ms 1800000}))`
    )
    .join('\n');
  const script = `(load-file "${LIB}")\n${forms}`;
  const scriptFile = path.join(mkTmpDir('bl1726-script-'), 'probe.bb');
  fs.writeFileSync(scriptFile, script);
  const out = execFileSync('bb', [scriptFile], { encoding: 'utf8' });
  const results = {};
  for (const line of out.split('\n')) {
    const tab = line.indexOf('\t');
    if (tab === -1) continue;
    results[line.slice(0, tab)] = line.slice(tab + 1) === 'true';
  }
  for (const { id } of cases) {
    assert.ok(Object.prototype.hasOwnProperty.call(results, id), `no output line for case "${id}"`);
  }
  return results;
}

test('invariant: a llama-server is reaped only when both ownership marks are present, across every executable/model/parent/live-window/age combination; `ollama runner` reaps by name alone', () => {
  const cases = buildCases();
  const results = runAllCases(cases);
  const reach = new Set();

  for (const c of cases) {
    reach.add(c.key);
    const reap = results[c.id];
    const expectedMarks = c.exe.marksExecutable && c.model.marksModel;

    const expectedReap = c.inLiveWindowSet
      ? false
      : c.exe.shape === 'ollama-runner'
        ? !c.parentLiveOllamaServe
        : expectedMarks && !c.parentLiveOllamaServe;

    assert.equal(
      reap,
      expectedReap,
      `reap mismatch for ${JSON.stringify({ exe: c.exe.label, model: c.model.label, parentLiveOllamaServe: c.parentLiveOllamaServe, inLiveWindowSet: c.inLiveWindowSet, ageMs: c.ageMs })}`
    );

    // The D1 property itself, stated directly (already implied by the
    // equality above for the llama-server shape, restated so the
    // send-back's exact claim is traceable to one assertion): whenever
    // the predicate reaps a llama-server, both marks are present.
    if (c.exe.shape === 'llama-server' && reap) {
      assert.equal(expectedMarks, true, `reaped a llama-server without both ownership marks: ${c.cmdline}`);
    }
  }

  assert.equal(reach.size, EXECUTABLES.length * MODELS.length * 2 * 2 * 2, 'reach floor: expected every combination to be constructed');
});
