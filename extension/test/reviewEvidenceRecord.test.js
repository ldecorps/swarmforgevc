'use strict';

// BL-1362: a review pass records its evidence by tool.
//
// Article 4.4 makes every review pass leave one evidence file, and
// review_forward_evidence_gate_lib.bb refuses a forward that carries none.
// The gate has been hardened three times (BL-536, BL-806, BL-1293) and there
// has never been a writer: 2182 of 12903 non-merge commits in 45 days carry
// nothing but a backlog/evidence/ file, every one composed from scratch.
//
// These cover the PURE half - what a verdict is, where the file goes, what it
// says. The commit half is driven end to end in recordReviewEvidenceCli.test.js.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  ARTICLE_44_ITEM_FIELDS,
  parseVerdict,
  evidenceFileName,
  renderEvidence,
} = require('../out/tools/reviewEvidenceRecord');

const REPO_ROOT = path.join(__dirname, '..', '..');

// ── the verdict: recorded, never derived (invariant 3) ──────────────────────

test('NONE is a verdict in its own right, and the tool records it as one', () => {
  assert.deepEqual(parseVerdict({ none: true, items: [] }), { kind: 'none' });
});

test('a defect inventory is a verdict, carried through item by item', () => {
  const items = [
    { command: 'npm run compile', commit: 'abc1234567', excerpt: 'TS2367', class: 'compile', expected: 'compiles vs TS2367', blamed: 'coder', remediation: 'src/a.ts::f' },
    { command: 'npm test', commit: 'abc1234567', excerpt: 'AssertionError', class: 'unit', expected: 'green vs 1 failed', blamed: 'hardener', remediation: 'test/b.test.js::case' },
  ];
  const verdict = parseVerdict({ none: false, items });
  assert.equal(verdict.kind, 'items');
  assert.equal(verdict.items.length, 2);
});

test('neither NONE nor items is REFUSED, naming what a verdict must be', () => {
  assert.throws(
    () => parseVerdict({ none: false, items: [] }),
    (err) => {
      // The refusal has to say what to supply - a role reading "invalid" learns
      // nothing it did not already know.
      assert.match(err.message, /NONE/);
      assert.match(err.message, /D1/);
      return true;
    }
  );
});

test('NONE and items together is refused too - a clean sweep with defects is not a verdict', () => {
  assert.throws(
    () => parseVerdict({ none: true, items: [{ command: 'x', commit: 'a', excerpt: 'e', class: 'unit', expected: 'x', blamed: 'coder', remediation: 'p' }] }),
    /both/i
  );
});

test('an item missing a required field is refused, naming the field', () => {
  assert.throws(
    () => parseVerdict({ none: false, items: [{ command: 'npm test', commit: 'abc1234567', excerpt: 'e', class: 'unit', expected: 'x', blamed: 'coder' }] }),
    /remediation/
  );
});

// ── the fields are the constitution's, not a second copy (BL-897) ───────────

test('the item fields this tool writes are exactly the five QA.prompt states, plus blamed role and remediation', () => {
  // BL-897: a constant mirrored across a boundary needs a test asserting both
  // literals agree. The prompt is the constitution's own wording; this tool
  // must never drift from it silently.
  const prompt = fs.readFileSync(path.join(REPO_ROOT, 'swarmforge', 'roles', 'QA.prompt'), 'utf8');
  const numbered = prompt
    .split('\n')
    .filter((line) => /^\s{4}\d\. \*\*/.test(line))
    .map((line) => line.replace(/^\s*\d\. \*\*/, '').replace(/\*\*.*$/, '').trim());

  assert.deepEqual(
    numbered,
    ['Failing command', 'Commit hash', 'First error excerpt', 'Failure class', 'Expected vs observed'],
    'QA.prompt no longer states the five fields in the form this test reads'
  );
  for (const label of numbered) {
    assert.ok(
      ARTICLE_44_ITEM_FIELDS.some((f) => f.label === label),
      `the tool does not carry the constitution's field "${label}"`
    );
  }
  assert.ok(ARTICLE_44_ITEM_FIELDS.some((f) => f.label === 'Blamed role'));
  assert.ok(ARTICLE_44_ITEM_FIELDS.some((f) => f.label === 'Remediation pointer'));
});

// ── the path: the corpus's own convention, and its collision form ───────────

test('the file is named for the ticket, the role and the date', () => {
  assert.equal(
    evidenceFileName('BL-9362', 'architect', '20260904', () => false),
    'BL-9362-architect-20260904.md'
  );
});

test('every reviewing role reaches the same convention, its own name included', () => {
  for (const role of ['cleaner', 'architect', 'hardender', 'documenter', 'QA']) {
    assert.equal(
      evidenceFileName('BL-9362', role, '20260904', () => false),
      `BL-9362-${role}-20260904.md`
    );
  }
});

test('a second pass on the same day never overwrites the first - the corpus qualifier is used', () => {
  // BL-1166 and BL-1204 both carry this exact form on disk, which is why the
  // tool emits it rather than inventing one.
  const taken = new Set(['BL-9362-QA-20260904.md']);
  assert.equal(
    evidenceFileName('BL-9362', 'QA', '20260904', (name) => taken.has(name)),
    'BL-9362-QA-20260904-2.md'
  );
  taken.add('BL-9362-QA-20260904-2.md');
  assert.equal(
    evidenceFileName('BL-9362', 'QA', '20260904', (name) => taken.has(name)),
    'BL-9362-QA-20260904-3.md'
  );
});

// ── the body ───────────────────────────────────────────────────────────────

test('a clean sweep records an explicit NONE, never an empty file', () => {
  const body = renderEvidence({ ticket: 'BL-9362', role: 'architect', date: '20260904', verdict: { kind: 'none' } });
  assert.match(body, /NONE/);
  assert.match(body, /BL-9362/);
  assert.match(body, /architect/);
});

test('an inventory lists every item with its blamed role and remediation pointer', () => {
  const items = [
    { command: 'npm run compile', commit: 'abc1234567', excerpt: 'TS2367 no overlap', class: 'compile', expected: 'compiles vs TS2367', blamed: 'coder', remediation: 'src/a.ts::f' },
    { command: 'npm test', commit: 'abc1234567', excerpt: 'AssertionError: 1 !== 2', class: 'unit', expected: 'green vs 1 failed', blamed: 'hardener', remediation: 'test/b.test.js::case' },
  ];
  const body = renderEvidence({ ticket: 'BL-9362', role: 'QA', date: '20260904', verdict: { kind: 'items', items } });
  assert.match(body, /D1/);
  assert.match(body, /D2/);
  assert.match(body, /coder/);
  assert.match(body, /hardener/);
  assert.match(body, /src\/a\.ts::f/);
  assert.match(body, /test\/b\.test\.js::case/);
  // Every constitution field is present for every item, by label.
  for (const field of ARTICLE_44_ITEM_FIELDS) {
    assert.ok(body.includes(field.label), `the rendered item omits "${field.label}"`);
  }
});

test('the body carries a role byline, as every commit and record in this repo does', () => {
  const body = renderEvidence({ ticket: 'BL-9362', role: 'cleaner', date: '20260904', verdict: { kind: 'none' } });
  assert.match(body, /By cleaner\./);
});
