'use strict';

// BL-1083 property test (coder-authored, two DECLARED invariants).
//
//   Invariant 1: "Every path that moves a ticket into backlog/active takes its
//   verdict from the one promotion-gates chokepoint — a second copy of the
//   rules, in any language, is the defect and not the fix."
//
//   Invariant 2: "A refused promotion leaves the ticket exactly where it was
//   and tells the operator which gate refused it and why — never a silent
//   no-op."
//
// Invariant 1 is not a claim about inputs, so it is not quantified over them:
// it is a claim about the SOURCE TREE, and P1/P2 below state it that way -
// every mover consults the chokepoint, and no mover outside the chokepoint
// carries the rules. Generating fake movers would test the detector rather
// than the tree.
//
// Invariant 2 IS quantified: over every gate that can refuse, and over the
// mover's whole observable effect. P3 states it as a CONJUNCTION - the ticket
// did not move, the folder listing is byte-identical, AND a named reason came
// back - because each half without the other is a defect wearing the other
// half's costume. A refusal that moves the file is worse than no gate; a
// refusal that says nothing is the silent no-op the invariant forbids.
//
// P4 is the armed-ness backstop, and it is not optional: P1, P2 and P3 are all
// satisfied by a mover that refuses EVERYTHING. That would leave the gate
// perfectly honest and the Expedite verb dead, which is the over-correction
// the ticket's own QA step 5 warns about.
//
// Non-vacuity PROVEN at authoring time (2026-08-23), each break restored:
//   - promoteToActive moves the file BEFORE consulting the gates .... P3
//   - a refusal returns { moved: false } with no reason ............. P3
//   - the gates fail OPEN when the CLI cannot be reached ............ P3
//   - the mover refuses every promotion ............................. P4
// Counts are recorded in backlog/evidence/BL-1083-coder-pass-20260823.md.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
// BL-420/BL-971: the shared fixture-dir helper, never a raw mkdtemp - it is
// what registers the dir for sweeping, and tmpDirMigrationGuard.test.js gates
// the whole tree on it.
const { mkTmpDir } = require('./helpers/tmpDir');
const {
  findActivePromotionSources,
  referencesPromotionGates,
  gateRuleNamesInCode,
  GATE_RULE_NAMES,
} = require(path.join(__dirname, '..', '..', 'specs', 'pipeline', 'steps', 'lib', 'activePromotionSources.js'));
const { installPromotionGates } = require(path.join(__dirname, '..', '..', 'specs', 'pipeline', 'steps', 'lib', 'promotionGatesFixture.js'));
const { promoteToActive } = require('../out/panel/backlogWriter');

const CHOKEPOINT = 'swarmforge/scripts/promotion_gates_lib.bb';

// Every gate that can refuse, with the smallest fixture that trips exactly it.
// Quantifying over the GATES is what makes invariant 2 a property rather than
// three examples: a fourth gate added later inherits the guarantee only if the
// property is written this way.
const REFUSING_GATES = [
  {
    gate: 'hold marker',
    build: (root, id) => {
      write(root, 'hold', id, 'human_approval: approved\ndepends_on: []\n');
      return 'hold';
    },
  },
  {
    gate: 'human_approval',
    build: (root, id) => {
      write(root, 'paused', id, 'human_approval: pending\ndepends_on: []\n');
      return 'paused';
    },
  },
  {
    gate: 'depends_on',
    build: (root, id) => {
      write(root, 'active', 'BL-8888', '');
      write(root, 'paused', id, 'human_approval: approved\ndepends_on: [BL-8888]\n');
      return 'paused';
    },
  },
  {
    gate: 'active_backlog_max_depth',
    maxDepth: 1,
    build: (root, id) => {
      write(root, 'active', 'BL-8889', '');
      write(root, 'paused', id, 'human_approval: approved\ndepends_on: []\n');
      return 'paused';
    },
  },
];

function write(root, folder, id, extra) {
  const dir = path.join(root, 'backlog', folder);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${id}-p.yaml`), `id: ${id}\ntitle: t\n${extra}`);
}

function listing(root) {
  const out = {};
  for (const folder of ['active', 'paused', 'hold', 'done']) {
    try {
      out[folder] = fs.readdirSync(path.join(root, 'backlog', folder)).sort();
    } catch {
      out[folder] = [];
    }
  }
  return out;
}

function withFixture(opts, fn) {
  const root = installPromotionGates(mkTmpDir('bl1083-prop-'), opts);
  try {
    return fn(root);
  } finally {
    // BL-971: in a finally, so a failed assertion cannot leak the fixture.
    fs.rmSync(root, { recursive: true, force: true });
  }
}

test('P1 (invariant 1): every source that moves a ticket into active consults the chokepoint', () => {
  const sources = findActivePromotionSources();
  // Non-vacuity first: one path proves nothing, because the defect WAS the
  // second path nobody looked at.
  assert.ok(sources.length > 1, `expected more than one promotion path, found: ${sources.join(', ')}`);
  const ungated = sources.filter((f) => !referencesPromotionGates(f));
  assert.deepEqual(ungated, [], `ungated promotion paths: ${ungated.join(', ')}`);
});

test('P2 (invariant 1): no promotion path outside the chokepoint carries a copy of the rules', () => {
  const offenders = findActivePromotionSources()
    .filter((f) => f !== CHOKEPOINT)
    .map((f) => ({ file: f, names: gateRuleNamesInCode(f) }))
    .filter((r) => r.names.length > 0);
  assert.deepEqual(offenders, [], `gate rules restated outside ${CHOKEPOINT}: ${JSON.stringify(offenders)}`);
  // And the names really are the rules - otherwise P2 is looking for nothing.
  assert.deepEqual([...gateRuleNamesInCode(CHOKEPOINT)].sort(), [...GATE_RULE_NAMES].sort());
});

test('P3 (invariant 2): every refusing gate leaves the tree untouched AND names itself', () => {
  for (const spec of REFUSING_GATES) {
    withFixture({ maxDepth: spec.maxDepth ?? 50 }, (root) => {
      const id = 'BL-7001';
      spec.build(root, id);
      const before = listing(root);

      const result = promoteToActive(root, id);

      // Not moved...
      assert.equal(result.moved, false, `${spec.gate}: a refused promotion must not report moved`);
      // ...and the tree is byte-identical, not merely "the ticket is somewhere
      // sensible". A gate that refuses and still shuffles files is worse than
      // no gate, because the operator is told nothing happened.
      assert.deepEqual(listing(root), before, `${spec.gate}: the folders must be untouched`);
      // ...and the operator can act on it.
      assert.ok(result.refusal, `${spec.gate}: a refusal must be reported, never a silent no-op`);
      assert.equal(result.refusal.gate, spec.gate, `${spec.gate}: the refusal must name its own gate`);
      assert.ok(
        result.refusal.reason && result.refusal.reason.length > 0,
        `${spec.gate}: the refusal must carry a reason, not just a gate name`
      );
    });
  }
});

test('P3 (invariant 2): an unreachable chokepoint refuses, names itself, and changes nothing', () => {
  // A gate that fails open is not a gate. The fixture deliberately has NO
  // swarmforge/scripts at all.
  const root = mkTmpDir('bl1083-prop-nogate-');
  try {
    write(root, 'paused', 'BL-7002', 'human_approval: approved\ndepends_on: []\n');
    const before = listing(root);
    const result = promoteToActive(root, 'BL-7002');
    assert.equal(result.moved, false);
    assert.deepEqual(listing(root), before);
    assert.ok(result.refusal, 'an unconsultable gate must still report why');
    assert.equal(result.refusal.gate, 'promotion_gates');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('P4 (armed-ness): a ticket no gate refuses is still promoted, so the verb is not dead', () => {
  // Without this, refusing everything satisfies P1, P2 and P3 completely and
  // kills Expedite - the over-correction the ticket's QA step 5 warns about.
  withFixture({ maxDepth: 50 }, (root) => {
    const id = 'BL-7003';
    write(root, 'paused', id, 'human_approval: approved\ndepends_on: []\n');

    const result = promoteToActive(root, id);

    assert.equal(result.moved, true, `expected a clear ticket to promote, got: ${JSON.stringify(result)}`);
    assert.equal(result.refusal, undefined);
    assert.deepEqual(listing(root).active, [`${id}-p.yaml`]);
    assert.deepEqual(listing(root).paused, []);
  });
});

test('P4 (armed-ness): a satisfied dependency does not refuse - the gate discriminates', () => {
  // The depends_on gate must be a gate, not a blanket refusal: the same ticket
  // with its dependency LANDED is promoted.
  withFixture({ maxDepth: 50 }, (root) => {
    const id = 'BL-7004';
    write(root, 'done', 'BL-8890', '');
    write(root, 'paused', id, 'human_approval: approved\ndepends_on: [BL-8890]\n');

    const result = promoteToActive(root, id);

    assert.equal(result.moved, true, `a landed dependency must not refuse: ${JSON.stringify(result.refusal)}`);
  });
});
