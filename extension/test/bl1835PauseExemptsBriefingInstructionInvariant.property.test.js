'use strict';

// BL-1835 (BL-654: coder owns first authorship of each declared
// invariant's property test): the ticket declares two invariants.
//
// Invariant 2 ("the instruction text every briefing trigger sends is one
// the pause lets through: one literal across the TypeScript and Babashka
// senders, BL-897") is ALREADY fully encoded by the pre-existing BL-897
// mirror - bl1458BriefingTriggerInvariants.property.test.js's own
// invariant 2, which asserts the two literal-producing functions are
// byte-identical over a generated spread of dates, with its own
// non-vacuity proof. Neither function moved for this ticket, so that
// coverage stands unchanged (re-run as part of qa_e2e_procedure, not
// restated here).
//
// This file encodes invariant 1 only: "While a control pause is active,
// ready_for_next serves a role nothing from its inbox except a briefing
// instruction addressed to the documenter; every other parcel stays in
// new/, never moved or quarantined." Targets the exact function this
// ticket changes - handoff_lib.bb's partition-pause-held - via a REAL bb
// subprocess per draw, never a re-implementation of the exemption
// predicate in JS. Runs ONLY via `npm run test:properties`
// (vitest.properties.config.mjs) - excluded from unit/coverage/mutation.
//
// QA bounce (D1, 2026-10-01): the first cut's candidate generator only
// ever drew a single-role `to:`, so it never exercised a BROADCAST copy
// (`to:` naming more than one role while `recipient:` - the per-copy
// inbox-owner header a real delivery stamps, handoff-protocol.md - names
// only the one role this physical file belongs to). The fixed predicate
// decides from `recipient:` alone; the generator below now draws that
// shape explicitly so a regression back to `to:`-membership would be
// caught here, not just at the unit level.

const assert = require('node:assert/strict');
const fc = require('fast-check');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { SUBPROCESS_HEAVY_TIMEOUT_MS } = require('./helpers/subprocessHeavyTimeout');
const { mkTmpDir } = require('./helpers/tmpDir');

const REPO_ROOT = path.join(__dirname, '..', '..');
const LIB = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'handoff_lib.bb');

const ROLES = ['documenter', 'coder', 'QA', 'architect'];

// `to` may list more than one role (a broadcast); `recipient` is always
// the ONE role whose inbox this physical copy sits in - exactly what a
// real delivered file carries (handoff-protocol.md).
function noteContent(to, recipient, message) {
  return `id: t\nfrom: coordinator\nto: ${to}\nrecipient: ${recipient}\npriority: 00\ntype: note\nmessage: ${message}\n\n${message}\n`;
}

function gitHandoffContent(to, recipient, task) {
  return `id: t\nfrom: qa\nto: ${to}\nrecipient: ${recipient}\npriority: 50\ntype: git_handoff\ntask: ${task}\ncommit: abc\n\nmerge_and_process qa abc\n`;
}

const dayKeyArbitrary = fc
  .tuple(fc.integer({ min: 2026, max: 2030 }), fc.integer({ min: 1, max: 12 }), fc.integer({ min: 1, max: 28 }))
  .map(([y, m, d]) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`);

// No newline (would break the one-header-line-per-line shape) and never an
// accidental collision with the real prefix (would silently stop testing
// the "noise" case this arm exists for).
const noiseArb = fc
  .string({ minLength: 0, maxLength: 20 })
  .filter((s) => !s.includes('\n') && !s.startsWith('produce the morning briefing for'));

// A broadcast co-recipient distinct from the copy's own `recipient` -
// drawn so `to:` always lists at least one OTHER role alongside it,
// mirroring a real multi-recipient note (BL-1835 D1's exact shape:
// `to: coder,documenter`, `recipient: coder`).
function otherRoleArb(recipient) {
  return fc.constantFrom(...ROLES.filter((r) => r !== recipient));
}

// Each candidate is EXACTLY ONE of:
//  - 'briefing': the real briefing instruction for a drawn day-key, single
//    recipient (to === recipient).
//  - 'broadcast-briefing': the SAME real instruction, but `to:` also names
//    another role - the D1 shape. Exempt iff recipient === 'documenter',
//    regardless of who else is named in `to`.
//  - 'noise-note' / 'noise-git-handoff': random text, never exempt.
// Constructed by explicit kind, never left to a uniform draw to maybe
// produce a given shape by luck.
const candidateArb = fc.oneof(
  fc.record({ kind: fc.constant('briefing'), recipient: fc.constantFrom(...ROLES), dayKey: dayKeyArbitrary }),
  fc
    .record({ kind: fc.constant('broadcast-briefing'), recipient: fc.constantFrom(...ROLES), dayKey: dayKeyArbitrary })
    .chain((c) => otherRoleArb(c.recipient).map((otherRole) => ({ ...c, otherRole }))),
  fc.record({ kind: fc.constant('noise-note'), recipient: fc.constantFrom(...ROLES), text: noiseArb }),
  fc.record({ kind: fc.constant('noise-git-handoff'), recipient: fc.constantFrom(...ROLES), text: noiseArb })
);

function candidateToFixture(root, idx, candidate) {
  const file = path.join(root, `${String(idx).padStart(2, '0')}_item.handoff`);
  if (candidate.kind === 'briefing') {
    fs.writeFileSync(file, noteContent(candidate.recipient, candidate.recipient, `produce the morning briefing for ${candidate.dayKey}`));
  } else if (candidate.kind === 'broadcast-briefing') {
    const to = [candidate.recipient, candidate.otherRole].sort().join(',');
    fs.writeFileSync(file, noteContent(to, candidate.recipient, `produce the morning briefing for ${candidate.dayKey}`));
  } else if (candidate.kind === 'noise-note') {
    fs.writeFileSync(file, noteContent(candidate.recipient, candidate.recipient, candidate.text));
  } else {
    fs.writeFileSync(file, gitHandoffContent(candidate.recipient, candidate.recipient, candidate.text));
  }
  return {
    file,
    content: fs.readFileSync(file, 'utf8'),
    expectedExempt: (candidate.kind === 'briefing' || candidate.kind === 'broadcast-briefing') && candidate.recipient === 'documenter',
  };
}

// files is an array of PATHS THIS TEST CONSTRUCTED (predictable
// "<root>/NN_item.handoff" strings, never drawn content) - the only thing
// interpolated into the bb source, so arbitrary generated note/task text
// never has to be escaped into it.
function runPartitionPauseHeld(libPath, files, active) {
  const script = `
(load-file "${libPath}")
(require '[cheshire.core :as json])
(let [files ${JSON.stringify(files)}
      {:keys [held valid]} (handoff-lib/partition-pause-held files (constantly ${active}))]
  (println (json/generate-string {:held (mapv str held) :valid (mapv str valid)})))
`;
  const out = execFileSync('bb', ['-e', script], { encoding: 'utf8' });
  return JSON.parse(out.trim().split('\n').pop());
}

test(
  'property (BL-1835 invariant 1): an active pause serves nothing but a briefing instruction addressed to the documenter; everything else stays held, unmoved, unquarantined',
  () => {
    let draws = 0;
    let sawExempt = 0;
    let sawHeld = 0;
    let sawBroadcastHeld = 0;
    fc.assert(
      fc.property(fc.array(candidateArb, { minLength: 0, maxLength: 6 }), (candidates) => {
        draws += 1;
        const root = mkTmpDir('bl1835-invariant1-');
        const fixtures = candidates.map((c, idx) => ({ ...candidateToFixture(root, idx, c), kind: c.kind }));
        const { held, valid } = runPartitionPauseHeld(LIB, fixtures.map((f) => f.file), true);
        for (const f of fixtures) {
          if (f.expectedExempt) {
            sawExempt += 1;
            assert.ok(valid.includes(f.file), `expected the briefing instruction addressed to documenter to be served: ${f.file}`);
            assert.ok(!held.includes(f.file), `expected the exempt candidate to never also be reported held: ${f.file}`);
          } else {
            sawHeld += 1;
            if (f.kind === 'broadcast-briefing') {
              sawBroadcastHeld += 1;
            }
            assert.ok(held.includes(f.file), `expected a non-exempt candidate to stay held: ${f.file}`);
            assert.ok(!valid.includes(f.file), `expected a held candidate to never also be reported served: ${f.file}`);
            assert.equal(fs.readFileSync(f.file, 'utf8'), f.content, `expected a held candidate's content to be untouched: ${f.file}`);
          }
        }
      }),
      { numRuns: 30 }
    );
    assert.ok(draws >= 15);
    // Reachability floor (engineering.prompt / BL-1062): the exempt
    // branch, the generic held branch, and specifically a non-documenter
    // broadcast copy staying held (BL-1835 D1's own regression shape)
    // were all actually exercised.
    assert.ok(sawExempt >= 1, 'expected at least one exempt (served) candidate across all draws');
    assert.ok(sawHeld >= 1, 'expected at least one non-exempt (held) candidate across all draws');
    assert.ok(sawBroadcastHeld >= 1, 'expected at least one non-documenter broadcast copy to stay held across all draws');
  },
  SUBPROCESS_HEAVY_TIMEOUT_MS
);

test('property (BL-1835 invariant 1): an inactive pause serves every candidate, exempt or not (unchanged legacy behavior)', () => {
  fc.assert(
    fc.property(fc.array(candidateArb, { minLength: 0, maxLength: 6 }), (candidates) => {
      const root = mkTmpDir('bl1835-inactive-');
      const fixtures = candidates.map((c, idx) => candidateToFixture(root, idx, c));
      const { held, valid } = runPartitionPauseHeld(LIB, fixtures.map((f) => f.file), false);
      assert.deepEqual(held, [], 'expected nothing held while the pause is inactive');
      assert.deepEqual(new Set(valid), new Set(fixtures.map((f) => f.file)), 'expected every candidate served while the pause is inactive');
    }),
    { numRuns: 10 }
  );
});

test('property (BL-1835 invariant 1) non-vacuity: deciding from `to:` list membership (BL-1835 D1\'s actual bug) instead of the per-copy `recipient:` header would wrongly serve a broadcast\'s non-documenter copy - proven against a scratch copy, then restored', () => {
  const original = fs.readFileSync(LIB, 'utf8');
  const marker =
    '(and (= "note" (header-field file "type"))\n       (= "documenter" (header-field file "recipient"))\n       (str/starts-with? (or (header-field file "message") "") briefing-due-instruction-prefix))';
  assert.ok(original.includes(marker), 'expected to find the full briefing-instruction-note? predicate to narrow for the non-vacuity probe');
  const broken = original.replace(
    marker,
    '(and (= "note" (header-field file "type"))\n       (some #(= "documenter" %) (str/split (or (header-field file "to") "") #","))\n       (str/starts-with? (or (header-field file "message") "") briefing-due-instruction-prefix))'
  );
  assert.notEqual(broken, original, 'expected the textual swap to actually change the file');

  const brokenPath = path.join(path.dirname(LIB), `handoff_lib-non-vacuity-scratch-${process.pid}-${Date.now()}.bb`);
  fs.writeFileSync(brokenPath, broken, { mode: 0o644 });
  const root = mkTmpDir('bl1835-non-vacuity-');
  try {
    // BL-1835 D1's exact shape: a broadcast to coder,documenter, this
    // physical copy delivered into CODER's own inbox (recipient: coder).
    const file = path.join(root, '00_item.handoff');
    const message = 'produce the morning briefing for 2026-10-01';
    fs.writeFileSync(file, noteContent('coder,documenter', 'coder', message));
    const { held, valid } = runPartitionPauseHeld(brokenPath, [file], true);
    assert.ok(valid.includes(file), "expected the broken (to:-membership) exemption to wrongly serve the coder's own copy of the broadcast");
    assert.ok(!held.includes(file), 'expected the broken exemption to wrongly NOT hold it either');
  } finally {
    fs.rmSync(brokenPath, { force: true });
  }
});
