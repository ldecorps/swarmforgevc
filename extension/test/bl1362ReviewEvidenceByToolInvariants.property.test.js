'use strict';

// BL-1362: PROPERTY tests over the three invariants the ticket YAML declares
// (coder-authored first, per BL-654). Runs ONLY via `npm run test:properties`.
//
//   P1 a-recorded-commit-always-satisfies-the-gate - whatever verdict is
//      recorded, the reported commit is committed and contributes content, so
//      the role can forward THAT commit (BL-536/BL-1293). Driven through the
//      REAL review_forward_evidence_gate_lib.bb, with the bare received hash
//      as a control that must STILL be refused - a one-sided property would
//      pass against a gate this parcel had weakened.
//   P2 none-and-an-inventory-take-the-same-path - a clean sweep is recorded,
//      never skipped, and never through a second code path: for every verdict
//      the same three things hold (a file at the conventional name, a commit
//      touching exactly that path, the commit reported).
//   P3 the-verdict-is-recorded-never-derived - an inventory that is neither
//      NONE nor a defect list is refused, and a refusal writes NO file and
//      makes NO commit.
//
// GENERATOR REACH is CONSTRUCTED. The interesting states are not reached by
// drawing strings: the same-day collision needs the SAME ticket, role and date
// drawn twice (so the second recording is built, not hoped for), and the
// refusal needs the empty-and-not-NONE shape specifically. Each pass asserts
// the shapes it needed were exercised.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const fc = require('fast-check');
const { execFileSync } = require('node:child_process');
const { mkTmpDir } = require('./helpers/tmpDir');
const { recordReviewEvidence } = require('../out/tools/record-review-evidence');
const { copySeededRepoInto } = require('./helpers/sharedRepoFixture');

const REPO_ROOT = path.join(__dirname, '..', '..');
const PROBE = path.join(REPO_ROOT, 'specs', 'pipeline', 'steps', 'lib', 'bl1362ReviewEvidenceGateProbe.bb');
const ROLES = ['cleaner', 'architect', 'hardender', 'documenter', 'QA'];

const roleArb = fc.constantFrom(...ROLES);
const ticketArb = fc.integer({ min: 9000, max: 9999 }).map((n) => `BL-${n}`);
const dateArb = fc.integer({ min: 1, max: 28 }).map((d) => `202609${String(d).padStart(2, '0')}`);

const itemArb = fc.record({
  command: fc.constantFrom('npm run compile', 'npm test', 'npm run test:properties'),
  commit: fc.stringMatching(/^[0-9a-f]{10}$/),
  excerpt: fc.stringMatching(/^[a-zA-Z0-9 :]{5,40}$/),
  class: fc.constantFrom('compile', 'unit', 'integration', 'acceptance', 'behavior'),
  expected: fc.stringMatching(/^[a-zA-Z0-9 ]{5,40}$/),
  blamed: fc.constantFrom('coder', 'cleaner', 'architect', 'hardener', 'documenter'),
  remediation: fc.constantFrom('src/a.ts::f', 'test/b.test.js::case', 'specs/features/x.feature::01'),
});

function git(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

function fixture() {
  const root = mkTmpDir('sfvc-bl1362-property-');
  copySeededRepoInto(root);
  fs.mkdirSync(path.join(root, 'backlog', 'evidence'), { recursive: true });
  // Every case runs against a DIRTY tree: an approval authorizes only its
  // ticket's work (BL-506), so a recorder that swept would be a defect.
  fs.writeFileSync(path.join(root, 'unrelated.txt'), 'not this parcel\n');
  return root;
}

// The three things that must hold for EVERY verdict (P2): one file, one
// commit touching exactly it, and that commit reported.
function assertRecordedTheSameWay(root, result, ticket, role, date) {
  assert.ok(
    result.file.startsWith(`backlog/evidence/${ticket}-${role}-${date}`),
    `the file does not follow the convention: ${result.file}`
  );
  assert.equal(fs.existsSync(path.join(root, result.file)), true, 'no file was written');
  assert.match(result.commit, /^[0-9a-f]{10}$/);
  const touched = git(root, ['show', '--name-only', '--format=', result.commit]).trim().split('\n');
  assert.deepEqual(touched, [result.file], 'the commit did not touch exactly the evidence path');
  assert.match(git(root, ['status', '--porcelain']), /unrelated\.txt/, 'the dirty tree was swept in');
}

test('BL-1362/BL-654 P2+P3: every verdict takes the same path, and a non-verdict is refused writing nothing', () => {
  const reach = { none: 0, items: 0, refused: 0, collision: 0 };

  fc.assert(
    fc.property(ticketArb, roleArb, dateArb, fc.array(itemArb, { minLength: 1, maxLength: 3 }), (ticket, role, date, items) => {
      const root = fixture();
      try {
        // NONE and an inventory, in the same run and the same fixture, so
        // "the same path" is a comparison rather than an assertion about one.
        const noneResult = recordReviewEvidence({ root, ticket, role, none: true, items: [], date });
        reach.none += 1;
        assertRecordedTheSameWay(root, noneResult, ticket, role, date);
        assert.match(fs.readFileSync(path.join(root, noneResult.file), 'utf8'), /NONE/);

        // Constructed collision: the SAME ticket, role and date again.
        const itemsResult = recordReviewEvidence({ root, ticket, role, none: false, items, date });
        reach.items += 1;
        reach.collision += 1;
        assertRecordedTheSameWay(root, itemsResult, ticket, role, date);
        assert.notEqual(itemsResult.file, noneResult.file, 'the second pass overwrote the first');
        assert.match(fs.readFileSync(path.join(root, noneResult.file), 'utf8'), /NONE/);

        const body = fs.readFileSync(path.join(root, itemsResult.file), 'utf8');
        items.forEach((item, index) => {
          assert.ok(body.includes(`D${index + 1}`), `item D${index + 1} is missing`);
          assert.ok(body.includes(item.blamed), `item D${index + 1} lost its blamed role`);
          assert.ok(body.includes(item.remediation), `item D${index + 1} lost its remediation pointer`);
        });

        // P3: neither NONE nor items. No file, no commit.
        const before = git(root, ['rev-parse', 'HEAD']).trim();
        const filesBefore = fs.readdirSync(path.join(root, 'backlog', 'evidence')).length;
        assert.throws(() => recordReviewEvidence({ root, ticket, role, none: false, items: [], date }), /NONE/);
        reach.refused += 1;
        assert.equal(git(root, ['rev-parse', 'HEAD']).trim(), before, 'a refusal still committed');
        assert.equal(fs.readdirSync(path.join(root, 'backlog', 'evidence')).length, filesBefore, 'a refusal still wrote a file');
        return true;
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    }),
    { numRuns: 4 }
  );

  for (const shape of Object.keys(reach)) {
    assert.ok(reach[shape] > 0, `never exercised the ${shape} shape`);
  }
});

test('BL-1362/BL-654 P1: the reported commit satisfies the real gate, which still refuses the bare received hash', () => {
  let reached = 0;

  fc.assert(
    fc.property(ticketArb, roleArb, fc.boolean(), fc.array(itemArb, { minLength: 1, maxLength: 2 }), (ticket, role, none, items) => {
      const root = fixture();
      try {
        const received = git(root, ['rev-parse', '--short=10', 'HEAD']).trim();
        const result = recordReviewEvidence({ root, ticket, role, none, items: none ? [] : items, date: '20260904' });
        reached += 1;

        const out = execFileSync('bb', [PROBE, root, received, result.commit, `${ticket}-a-fixture-pass`], {
          encoding: 'utf8',
          timeout: 300000,
        });
        const verdicts = JSON.parse(out.trim().split('\n').pop());
        assert.equal(verdicts.blockedForwardingRecorded, false, `the gate refused a recorded ${none ? 'NONE' : 'inventory'} commit`);
        // Two-sided: the gate is satisfied by construction, not weakened.
        assert.equal(verdicts.blockedForwardingReceived, true, 'the gate no longer refuses the bare received hash');
        return true;
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    }),
    { numRuns: 3 }
  );

  assert.ok(reached > 0, 'the gate property never ran');
});
