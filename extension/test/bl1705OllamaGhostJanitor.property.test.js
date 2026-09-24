'use strict';

// BL-1705's one declared invariant: "The janitor never signals an ollama
// serve process, nor a runner whose parent is a live ollama serve."
//
// reapable-ollama-ghost? (orphan_janitor_lib.bb) is pure over a small
// boolean/enum row - exhaustively constructed here, never fc-sampled
// (BL-1697/BL-1703's own precedent for a state space this small: random
// sampling over few discrete values can miss a value entirely).

const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const path = require('node:path');

const LIB = path.join(__dirname, '..', '..', 'swarmforge', 'scripts', 'orphan_janitor_lib.bb');

function bbEval(expr) {
  const out = execFileSync('bb', ['-e', `(load-file "${LIB}") ${expr}`], { encoding: 'utf8' });
  return out.trim();
}

function reapable({ inLiveWindowSet, cmdline, parentOrphaned, parentLiveOllamaServe, ageMs, graceMs }) {
  const edn =
    `{:in-live-window-set? ${inLiveWindowSet}` +
    ` :cmdline "${cmdline}"` +
    ` :parent-orphaned? ${parentOrphaned}` +
    ` :parent-live-ollama-serve? ${parentLiveOllamaServe}` +
    ` :age-ms ${ageMs}` +
    ` :grace-ms ${graceMs}}`;
  return bbEval(`(println (orphan-janitor-lib/reapable-ollama-ghost? ${edn}))`) === 'true';
}

const BOOLS = [true, false];
const AGES = [0, 999999999];

test('invariant: "ollama serve" is never reaped, across every other signal', () => {
  const reach = new Set();
  for (const inLiveWindowSet of BOOLS) {
    for (const parentOrphaned of BOOLS) {
      for (const parentLiveOllamaServe of BOOLS) {
        for (const ageMs of AGES) {
          for (const graceMs of AGES) {
            reach.add(`${inLiveWindowSet}:${parentOrphaned}:${parentLiveOllamaServe}:${ageMs}:${graceMs}`);
            const result = reapable({
              inLiveWindowSet,
              cmdline: 'ollama serve',
              parentOrphaned,
              parentLiveOllamaServe,
              ageMs,
              graceMs,
            });
            assert.equal(
              result,
              false,
              `expected "ollama serve" to never be reaped for ${JSON.stringify({ inLiveWindowSet, parentOrphaned, parentLiveOllamaServe, ageMs, graceMs })}`
            );
          }
        }
      }
    }
  }
  assert.equal(reach.size, 32, 'reach floor: expected all 32 combinations to be constructed');
});

test('invariant: a model runner whose parent is a live ollama serve is never reaped, across every other signal and both runner cmdline shapes', () => {
  const reach = new Set();
  for (const cmdline of ['llama-server --model m.gguf', 'ollama runner --model m.gguf']) {
    for (const inLiveWindowSet of BOOLS) {
      for (const parentOrphaned of BOOLS) {
        for (const ageMs of AGES) {
          for (const graceMs of AGES) {
            reach.add(`${cmdline}:${inLiveWindowSet}:${parentOrphaned}:${ageMs}:${graceMs}`);
            const result = reapable({
              inLiveWindowSet,
              cmdline,
              parentOrphaned,
              parentLiveOllamaServe: true,
              ageMs,
              graceMs,
            });
            assert.equal(
              result,
              false,
              `expected a live-server-owned runner to never be reaped for ${JSON.stringify({ cmdline, inLiveWindowSet, parentOrphaned, ageMs, graceMs })}`
            );
          }
        }
      }
    }
  }
  assert.equal(reach.size, 2 * 2 * 2 * 2 * 2, 'reach floor: expected every combination to be constructed');
});

// The run-client grace check is `(>= age-ms grace-ms)` - the feature's own
// Scenario Outline only exercises 2h-vs-30min-default (clearly over) and
// 5min-vs-30min-default (clearly under), so it never reaches age-ms ==
// grace-ms and cannot tell `>=` from `>`. Confirmed by hand-mutation during
// this hardening pass: >= -> > on this exact fixture flipped a reaped
// verdict to kept until this boundary case was added.
test('invariant: a detached run client at EXACTLY the grace period is reaped (>= is inclusive)', () => {
  const atBoundary = reapable({
    inLiveWindowSet: false,
    cmdline: 'ollama run some-model',
    parentOrphaned: true,
    parentLiveOllamaServe: false,
    ageMs: 1800000,
    graceMs: 1800000,
  });
  assert.equal(atBoundary, true, 'expected a run client exactly at the grace period to be reaped');

  const justUnder = reapable({
    inLiveWindowSet: false,
    cmdline: 'ollama run some-model',
    parentOrphaned: true,
    parentLiveOllamaServe: false,
    ageMs: 1799999,
    graceMs: 1800000,
  });
  assert.equal(justUnder, false, 'expected a run client one ms under the grace period to be kept');
});
