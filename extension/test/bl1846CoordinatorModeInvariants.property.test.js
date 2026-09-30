'use strict';

// BL-1846 declared invariants (coder first authorship — BL-654):
//
// 1. "handoffd holds no ranking of its own: every ticket it promotes is
//    chosen and gated by promote_and_route_next.sh, and it never moves a
//    ticket file from paused to active itself." This quantifies over the
//    SHAPE of handoffd.bb's own implementation (delegating the whole
//    promote/route decision to a real subprocess, never a parallel
//    git-mv of its own) rather than over a pure, generator-drawable input
//    space - it is proven by the acceptance feature's own real
//    end-to-end runs (BL-1846's four scenarios: a refused candidate never
//    moves, a promoted one moves exactly as the script decided) and by
//    inspection (deterministic-promote-and-route! in handoffd.bb has
//    exactly one write path to backlog/, the subprocess call to
//    promote_and_route_next.sh <project-root> with NO ticket id - there is
//    no second, handoffd-authored git-mv/rename anywhere in that
//    function). No executable property encoding here: this is a
//    process/architecture invariant, not a testable module's pure
//    behavior (Invariants section's own stated-reason escape hatch).
//
// 2. "A pack whose conf does not declare coordinator_mode deterministic
//    behaves exactly as today: the open-slot note, its cooldown and its
//    escalation are unchanged, and handoffd promotes nothing." The
//    promote/route and note-based paths are exercised end to end by the
//    acceptance feature's own scenarios 01/02 (real subprocess, real
//    mailbox); this property test covers the part of the invariant that
//    the REAL gate function decides and that a fast generator can reach
//    directly - coordinator-config-lib/deterministic-coordinator? must
//    read true for the ONE literal spelling and false for every other
//    conf-text this generator can produce, including near-misses a hand-
//    written example list would likely miss (wrong case, an unrelated
//    real mode word, blank/absent, noise around the key).
//
// Non-vacuity, production code (authored 2026-09-30): loosening
// deterministic-coordinator-mode-value's comparison in
// coordinator_config_lib.bb from `=` to a `str/includes?` substring check
// made this fail on the very first generated near-miss (a conf line whose
// value merely CONTAINS "deterministic" as a substring, e.g.
// "deterministic-ish"); restored to `=` and the property holds.
//
// Non-vacuity, this test's own generator (authored 2026-09-30, two
// findings against the CORRECT implementation above, both real
// false-positives caught by running this suite for real rather than
// eyeballing it): an empty suffix-noise draw made "deterministic" + ""
// build the exact literal (asserted true, not false), and 'deterministic'
// left in the other-real-mode value pool did the same directly. Both fixed
// (never-empty suffix pool; the literal excluded from the other-real-mode
// pool), plus a standing per-run guard (below) that would catch a third
// instance of the same shape rather than rediscovering it by rerunning.
//
// Runs ONLY via `npm run test:properties`.

const assert = require('node:assert/strict');
const fc = require('fast-check');
const { execFileSync } = require('node:child_process');
const path = require('node:path');
const { SUBPROCESS_HEAVY_TIMEOUT_MS } = require('./helpers/subprocessHeavyTimeout');

const REPO_ROOT = path.join(__dirname, '..', '..');
const COORDINATOR_CONFIG = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'coordinator_config_lib.bb');

function deterministicCoordinator(confText) {
  const out = execFileSync(
    'bb',
    [
      '-e',
      `(load-file "${COORDINATOR_CONFIG}") (println (coordinator-config-lib/deterministic-coordinator? ${JSON.stringify(confText)}))`,
    ],
    { encoding: 'utf8' }
  ).trim();
  return out === 'true';
}

// Every generated non-deterministic near-miss is built by CONSTRUCTION
// from the one literal that DOES flip it true, never drawn independently -
// each case is a genuine near-miss of "config coordinator_mode
// deterministic" by construction, not a string that might coincidentally
// happen to differ.
const NEAR_MISS_KINDS = ['wrong-case', 'suffix-noise', 'other-real-mode', 'blank-value', 'absent-key', 'wrong-key'];

function buildConfText(kind, otherMode) {
  switch (kind) {
    case 'wrong-case':
      // Exercises every letter position, not only the first.
      return `config coordinator_mode ${otherMode}\n`;
    case 'suffix-noise':
      return `config coordinator_mode deterministic${otherMode}\n`;
    case 'other-real-mode':
      return `config coordinator_mode ${otherMode}\n`;
    case 'blank-value':
      return 'config coordinator_mode   \n';
    case 'absent-key':
      return `config active_backlog_max_depth 3\nconfig coordinator_model ${otherMode}\n`;
    case 'wrong-key':
      return `config coordinator_mode_typo deterministic\nconfig active_backlog_max_depth ${otherMode}\n`;
    default:
      throw new Error(`unknown near-miss kind ${kind}`);
  }
}

function mixedCaseVariant(word, mask) {
  return [...word].map((ch, i) => (mask & (1 << i) ? ch.toUpperCase() : ch)).join('');
}

test(
  'BL-1846/BL-654 invariant 2: only the literal "deterministic" value reads deterministic-coordinator? true',
  () => {
    let draws = 0;
    const reach = { 'wrong-case': 0, 'suffix-noise': 0, 'other-real-mode': 0, 'blank-value': 0, 'absent-key': 0, 'wrong-key': 0 };
    fc.assert(
      fc.property(
        fc.constantFrom(...NEAR_MISS_KINDS),
        fc.integer({ min: 1, max: 1023 }),
        // Never 'deterministic': placed verbatim into the coordinator_mode
        // value for 'other-real-mode', so including it there would build
        // the exact literal, not a near-miss (the same class of bug the
        // suffix-noise fix above guards against).
        fc.constantFrom('model', 'aider', 'router', '3'),
        // Never empty: "deterministic" + "" IS the exact literal, not a
        // near-miss (the bug this comment replaces - caught by the
        // non-vacuity run below reproducing it live).
        fc.constantFrom('-ish', 'X', ' extra', '2'),
        (kind, caseMask, otherModeBase, suffixNoise) => {
          draws += 1;
          reach[kind] += 1;
          const otherMode = kind === 'wrong-case' ? mixedCaseVariant('deterministic', caseMask) : kind === 'suffix-noise' ? suffixNoise : otherModeBase;
          // For every kind that places `otherMode` verbatim into the
          // coordinator_mode value itself (wrong-case, suffix-noise,
          // other-real-mode), it must never coincidentally BE the exact
          // literal - two authoring bugs of exactly this shape were caught
          // live by this guard (an empty suffix-noise string, and
          // 'deterministic' left in the other-real-mode pool) before the
          // fix below; kept as a standing guard against a third.
          if (kind === 'wrong-case' || kind === 'suffix-noise' || kind === 'other-real-mode') {
            const impliedValue = kind === 'suffix-noise' ? `deterministic${otherMode}` : otherMode;
            assert.notEqual(
              impliedValue,
              'deterministic',
              `${kind} generator produced the exact literal, not a near-miss: otherMode=${JSON.stringify(otherMode)}`
            );
          }
          const confText = buildConfText(kind, otherMode);
          assert.equal(
            deterministicCoordinator(confText),
            false,
            `expected false for near-miss (${kind}): ${JSON.stringify(confText)}`
          );
        }
      ),
      // 6 equally-likely kinds: at 24 runs, P(missing a kind) ~= 9% - too
      // flaky for a reach-floor assertion below. 90 runs drives that below
      // 1-in-10000.
      { numRuns: 90 }
    );
    assert.ok(draws >= 80);
    for (const kind of NEAR_MISS_KINDS) {
      assert.ok(reach[kind] >= 1, `generator never reached the '${kind}' near-miss shape`);
    }

    // The one positive case, asserted directly (not drawn - there is
    // exactly one literal that must read true).
    assert.equal(deterministicCoordinator('config coordinator_mode deterministic\n'), true);
    assert.equal(deterministicCoordinator('# a comment\nconfig active_backlog_max_depth 3\nconfig coordinator_mode deterministic\n'), true);
  },
  SUBPROCESS_HEAVY_TIMEOUT_MS
);
