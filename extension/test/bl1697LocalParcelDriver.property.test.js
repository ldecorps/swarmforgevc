'use strict';

// BL-1697's three declared invariants.
//
// Invariant 1 ("the driver queues a git_handoff only when all five
// [conditions] hold... every other outcome ends in exactly one escalation
// naming the FIRST failed condition"): red-check-decision and
// green-gate-decision are pure functions - exhaustively enumerated here
// (2x2x2x2 = 16 combinations for the gate, 2 for the red check), never
// fc-sampled - too small a space for random sampling to reliably reach
// every combination (BL-1703's own precedent for exactly this class of
// state space).
//
// Invariant 2 ("while the driver owns a seat, every text... is typed by
// the driver; no other handoffd injection reaches it") quantifies over
// handoffd's own dispatch loop, not a pure module a generator can drive -
// encoded by the acceptance feature's own scenario 06, which runs the
// REAL daemon (test_handoffd_driver_seat_injection_skip.sh) - the same
// disposition BL-1691/BL-1718 recorded for an invariant whose exhaustive
// check IS the acceptance scenario.
//
// Invariant 3 ("every seat whose provider lacks the parcel-driver
// capability ... is unchanged"): driver-seat? is pure - exhaustively
// checked here against every OTHER member of provider-capabilities'
// supported-agents set, crossed with both a driving and a non-driving
// role, so the property is reached for every real provider this file
// could ever be asked about, not just "aider" and one hand-picked other.

const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');

const LIB = require('node:path').join(__dirname, '..', '..', 'swarmforge', 'scripts', 'local_parcel_driver_lib.bb');

function bbEval(expr) {
  const out = execFileSync('bb', ['-e', `(load-file "${LIB}") ${expr}`], { encoding: 'utf8' });
  return out.trim();
}

function greenGateDecision(input) {
  const edn = `{:acceptance-passes? ${input.acceptancePasses} :has-commit? ${input.hasCommit} :spec-bytes-identical? ${input.specBytesIdentical} :touched-paths [${input.touchedPaths.map((p) => `"${p}"`).join(' ')}] :editable-set #{${input.editableSet.map((p) => `"${p}"`).join(' ')}}}`;
  const raw = bbEval(`(println (local-parcel-driver-lib/green-gate-decision ${edn}))`);
  return raw;
}

function expectedReason({ acceptancePasses, hasCommit, specBytesIdentical, touchedWithinEditable }) {
  if (!hasCommit) return 'no model commit';
  if (!acceptancePasses) return 'acceptance still failing';
  if (!specBytesIdentical) return 'spec changed';
  if (!touchedWithinEditable) return 'edited outside its files';
  return null; // pass
}

const BOOLS = [true, false];

test('invariant 1: green-gate-decision reports the first-violated condition, in the ticket table\'s own priority order, across every combination', () => {
  const reach = new Set();
  for (const hasCommit of BOOLS) {
    for (const acceptancePasses of BOOLS) {
      for (const specBytesIdentical of BOOLS) {
        for (const touchedWithinEditable of BOOLS) {
          reach.add(`${hasCommit}:${acceptancePasses}:${specBytesIdentical}:${touchedWithinEditable}`);
          const touchedPaths = touchedWithinEditable ? ['a.ts'] : ['b.ts'];
          const editableSet = ['a.ts'];
          const raw = greenGateDecision({
            acceptancePasses,
            hasCommit,
            specBytesIdentical,
            touchedPaths,
            editableSet,
          });
          const reason = expectedReason({ acceptancePasses, hasCommit, specBytesIdentical, touchedWithinEditable });
          if (reason === null) {
            assert.match(raw, /:pass true/, `expected a pass for ${JSON.stringify({ hasCommit, acceptancePasses, specBytesIdentical, touchedWithinEditable })}, got: ${raw}`);
          } else {
            assert.match(
              raw,
              new RegExp(`:reason ${reason.replace(/ /g, ' ')}`),
              `expected reason "${reason}" for ${JSON.stringify({ hasCommit, acceptancePasses, specBytesIdentical, touchedWithinEditable })}, got: ${raw}`
            );
          }
        }
      }
    }
  }
  assert.equal(reach.size, 16, 'reach floor: expected all 16 combinations to be constructed');
});

test('invariant 1: red-check-decision escalates on a pre-passing acceptance and only that case', () => {
  const passRaw = bbEval('(println (local-parcel-driver-lib/red-check-decision false))');
  const failRaw = bbEval('(println (local-parcel-driver-lib/red-check-decision true))');
  assert.match(passRaw, /:pass true/);
  assert.match(failRaw, /:reason acceptance passed before any edit/);
});

// The editable-set check is `(every? editable-set touched-paths)` - the
// 16-combination sweep above never gives touched-paths more than one
// element, so it cannot tell `every?` from `some` (a fold-over-collection
// mutant needs two DISAGREEING members to discriminate; one member always
// agrees with itself). Confirmed by hand-mutation during this hardening
// pass: `every?` -> `some` on this exact fixture survived the sweep above
// (reported :pass true instead of "edited outside its files") until this
// two-path, disagreeing fixture was added.
test('invariant 1: green-gate-decision requires EVERY touched path to be editable, not just one of several', () => {
  const allEditable = greenGateDecision({
    acceptancePasses: true,
    hasCommit: true,
    specBytesIdentical: true,
    touchedPaths: ['a.ts', 'b.ts'],
    editableSet: ['a.ts', 'b.ts'],
  });
  assert.match(allEditable, /:pass true/, `expected a pass when every touched path is editable, got: ${allEditable}`);

  const oneOutside = greenGateDecision({
    acceptancePasses: true,
    hasCommit: true,
    specBytesIdentical: true,
    touchedPaths: ['a.ts', 'unlisted.ts'],
    editableSet: ['a.ts', 'b.ts'],
  });
  assert.match(
    oneOutside,
    /:reason edited outside its files/,
    `expected a fail when one of several touched paths is outside the editable set, got: ${oneOutside}`
  );
});

test('invariant 3: driver-seat? is false for every provider other than aider, for both a driving and a non-driving role', () => {
  const supportedAgentsRaw = bbEval('(require (quote [clojure.string :as str])) (print (str/join "," prompt-engine-lib/supported-agents))');
  const agents = supportedAgentsRaw.split(',').filter(Boolean);
  assert.ok(agents.includes('aider'), 'reach floor: expected "aider" in the real supported-agents set');
  assert.ok(agents.length >= 8, 'reach floor: expected the real multi-provider set, not a stub');

  const reach = new Set();
  for (const agent of agents) {
    for (const role of ['coder', 'cleaner']) {
      reach.add(`${agent}:${role}`);
      const raw = bbEval(`(println (local-parcel-driver-lib/driver-seat? "${agent}" "${role}"))`);
      if (agent === 'aider' && role === 'coder') {
        assert.equal(raw, 'true', `expected aider+coder to be a driver seat`);
      } else {
        assert.equal(raw, 'false', `expected ${agent}+${role} NOT to be a driver seat, got: ${raw}`);
      }
    }
  }
  assert.equal(reach.size, agents.length * 2, 'reach floor: expected every (agent, role) pair to be constructed');
});

test('invariant 3: driver-seat? recognizes a mixed-pack second seat (coder@2) the same as coder', () => {
  const raw = bbEval('(println (local-parcel-driver-lib/driver-seat? "aider" "coder@2"))');
  assert.equal(raw, 'true', 'expected coder@2 (BL-1702\'s mixed-pack second seat) to be recognized as a driver seat');
});

// forbidden-chat-path? backs the ticket's own FIRM approval_context clause
// ("no pipeline script is ever in the seat's chat") and, before this pass,
// had no test naming it anywhere in the tree - only exercised indirectly
// through fixtures whose editable path is always plain source, never a
// pipeline path. Each of the three prefixes is asserted separately: a
// single combined regex would not tell which prefix (if any) a future edit
// dropped.
test('invariant (FIRM approval_context): forbidden-chat-path? blocks every pipeline-script prefix and nothing else', () => {
  const forbidden = [
    'swarmforge/scripts/seat',
    'swarmforge/roles/coder.prompt',
    'swarmforge/constitution/articles/01_roles.md',
  ];
  for (const p of forbidden) {
    const raw = bbEval(`(println (local-parcel-driver-lib/forbidden-chat-path? "${p}"))`);
    assert.equal(raw, 'true', `expected "${p}" to be a forbidden chat path, got: ${raw}`);
  }
  const allowed = ['extension/src/foo.ts', 'backlog/active/BL-9.yaml', 'swarmforge.conf'];
  for (const p of allowed) {
    const raw = bbEval(`(println (local-parcel-driver-lib/forbidden-chat-path? "${p}"))`);
    assert.equal(raw, 'false', `expected "${p}" NOT to be a forbidden chat path, got: ${raw}`);
  }
});

// editable-paths' own Scope-section cutoff: it must stop collecting at an
// "Out of scope:" bullet, never merely at the next "## " header - a path
// named only to say it is EXCLUDED must never be handed to the model as
// editable (the function's own docstring). Untested by name before this
// pass.
test('editable-paths stops at "Out of scope:" and never hands back a path named only there', () => {
  const content = [
    'description: |',
    '  ## Scope',
    '  - `extension/src/foo.ts`',
    '  Out of scope: `extension/src/bar.ts` (unrelated)',
    '  ## Notes',
    '  - `extension/src/should-not-appear.ts`',
    '',
    'required_wiring:',
    "  - 'extension/src/baz.ts::wiring::anchor'",
    '',
  ].join('\\n');
  const raw = bbEval(`(println (local-parcel-driver-lib/editable-paths "${content}"))`);
  assert.equal(
    raw,
    '[extension/src/baz.ts extension/src/foo.ts]',
    `expected only the in-scope and required_wiring paths, got: ${raw}`
  );
});
