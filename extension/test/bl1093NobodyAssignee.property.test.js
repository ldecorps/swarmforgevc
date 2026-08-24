'use strict';

// BL-1093 declared invariants (coder first authorship — BL-654):
//
// 1. An active ticket is always reachable by exactly one sweep — a value
//    that names nobody makes it unassigned (coordinator nudge), never an
//    assignee (auto-route), and no value leaves it invisible to both.
// 2. A handoff the daemon generates is one the daemon could itself send —
//    the auto-route never emits a recipient swarm_handoff will reject.
// 3. A failed auto-route records WHY it failed (operator-refusal-log-line
//    carries the validator reason, not only a draft path).
//
// Non-vacuity: (1) a real assignee is a gap not unassigned; (2) forcing
// draft-lines with assigned-to coder emits to: coder; (3) stderr without
// the formatter has no gate= prefix. Restored.
//
// Runs ONLY via `npm run test:properties`.

const assert = require('node:assert/strict');
const fc = require('fast-check');
const { execFileSync } = require('node:child_process');
const path = require('node:path');
const { SUBPROCESS_HEAVY_TIMEOUT_MS } = require('./helpers/subprocessHeavyTimeout');

const REPO_ROOT = path.join(__dirname, '..', '..');
const CHASE = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'chase_sweep_lib.bb');
const COHERENCE = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'task_commit_coherence_gate_lib.bb');

function bbChase(expr) {
  return execFileSync('bb', ['-e', `(load-file "${CHASE}")\n${expr}`], { encoding: 'utf8' }).trim();
}

function bbCoh(expr) {
  return execFileSync('bb', ['-e', `(load-file "${COHERENCE}")\n${expr}`], { encoding: 'utf8' }).trim();
}

const NOBODY = ['none', 'unassigned', '', 'NONE'];

test(
  'BL-1093/BL-654 invariant 1: nobody spellings are unassigned xor gap, never both/neither',
  () => {
    let draws = 0;
    fc.assert(
      fc.property(fc.constantFrom(...NOBODY, 'coder', 'specifier'), (spelling) => {
        draws += 1;
        const nobody = bbChase(
          `(println (chase-sweep-lib/nobody-assigned? ${spelling === '' ? '""' : JSON.stringify(spelling)}))`
        );
        const isNobody = nobody === 'true';
        if (spelling === 'coder' || spelling === 'specifier') {
          assert.equal(isNobody, false);
        } else {
          assert.equal(isNobody, true);
        }
        // Partition: draft-lines nil iff nobody.
        const draft = bbChase(
          `(println (pr-str (chase-sweep-lib/dispatch-gap-draft-lines {:id "BL-1" :assigned-to ${
            spelling === '' ? '""' : JSON.stringify(spelling)
          }} "aaaaaaaaaa")))`
        );
        if (isNobody) {
          assert.equal(draft, 'nil');
        } else {
          assert.match(draft, new RegExp(`"to: ${spelling}"`));
        }
      }),
      { numRuns: 12 }
    );
    assert.ok(draws >= 4);
  },
  SUBPROCESS_HEAVY_TIMEOUT_MS
);

test(
  'BL-1093/BL-654 invariant 2: auto-route draft never names a nobody recipient',
  () => {
    let draws = 0;
    fc.assert(
      fc.property(fc.constantFrom('none', 'unassigned', 'None'), (spelling) => {
        draws += 1;
        const draft = bbChase(
          `(println (pr-str (chase-sweep-lib/dispatch-gap-draft-lines {:id "BL-777" :assigned-to ${JSON.stringify(
            spelling
          )}} "aaaaaaaaaa")))`
        );
        assert.equal(draft, 'nil');
        assert.doesNotMatch(draft, /to: none|to: unassigned/i);
        // Non-vacuity: real assignee still emits.
        const ok = bbChase(
          `(println (pr-str (chase-sweep-lib/dispatch-gap-draft-lines {:id "BL-777" :assigned-to "coder"} "aaaaaaaaaa")))`
        );
        assert.match(ok, /"to: coder"/);
      }),
      { numRuns: 6 }
    );
    assert.ok(draws >= 2);
  },
  SUBPROCESS_HEAVY_TIMEOUT_MS
);

test(
  'BL-1093/BL-654 invariant 3: refusal log line carries the validator reason',
  () => {
    const stderr =
      "HANDOFF INVALID: /tmp/draft.txt\n\nErrors:\n- Unknown recipient role 'none'.\n";
    let draws = 0;
    fc.assert(
      fc.property(fc.constant(null), () => {
        draws += 1;
        const line = bbCoh(
          `(println (task-commit-coherence-gate-lib/operator-refusal-log-line ${JSON.stringify(stderr)}))`
        );
        assert.match(line, /^gate=/);
        assert.match(line, /Unknown recipient role 'none'/);
        // Non-vacuity: bare draft path alone is not enough — reason= must
        // include the Errors body, not only HANDOFF INVALID.
        assert.match(line, /reason=/);
        const bare = 'HANDOFF INVALID: /tmp/x';
        const bareLine = bbCoh(
          `(println (task-commit-coherence-gate-lib/operator-refusal-log-line ${JSON.stringify(bare)}))`
        );
        assert.match(bareLine, /gate=handoff-validation/);
        assert.doesNotMatch(bareLine, /Unknown recipient/);
      }),
      { numRuns: 3 }
    );
    assert.ok(draws >= 1);
  },
  SUBPROCESS_HEAVY_TIMEOUT_MS
);
