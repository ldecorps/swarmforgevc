'use strict';

// BL-1193: the RETIRED-token extractor names what the marker retires.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { mkTmpDir } = require('./helpers/tmpDir');
const {
  extractRetiredReferents,
  loadRetiredTokens,
  deprecateCheck,
} = require('../out/tools/deprecate-check');

// The live docs line that started this: its RETIRED marker names `type: bug`,
// and the old extractor took "Mint" - the first word on the row, two table
// columns away - plus the path in the same row.
const LIVE_ROW =
  '| Mint hygiene (`backlog_hygiene_lib.bb`) | `type: bug` → `RETIRED-TICKET-TYPE … use type: defect` |';

test('the marker names the mapped referent, not the first word on the line', () => {
  assert.deepEqual(extractRetiredReferents(LIVE_ROW), ['type: bug']);
});

test('a line that only mentions the word retires nothing', () => {
  assert.deepEqual(extractRetiredReferents('- All `depends_on` are done, but the description still names **RETIRED**'), []);
  assert.deepEqual(extractRetiredReferents('`RETIRED-TICKET-TYPE`, rename the type and re-run the gate.'), []);
  assert.deepEqual(
    extractRetiredReferents('- [Expedite lane is defect-only](x.md) — predicate + mint `RETIRED-TICKET-TYPE`.'),
    []
  );
});

test('predication and announcement shapes both name their referent', () => {
  assert.deepEqual(extractRetiredReferents('the legacy-verb path is now RETIRED'), ['legacy-verb']);
  assert.deepEqual(extractRetiredReferents('RETIRED: legacy-verb'), ['legacy-verb']);
  assert.deepEqual(extractRetiredReferents('the old `swarm_old_lib.bb` helper was RETIRED in BL-900'), [
    'swarm_old_lib.bb',
  ]);
});

test('every arrow spelling maps the same way', () => {
  for (const arrow of ['->', '=>', '→', '⇒', '=']) {
    assert.deepEqual(
      extractRetiredReferents(`\`old_thing.bb\` ${arrow} \`RETIRED-SURFACE\``),
      ['old_thing.bb'],
      `arrow ${arrow}`
    );
  }
});

test('a line with two markers names both referents', () => {
  assert.deepEqual(
    extractRetiredReferents('`first_lib.bb` → RETIRED, and `second_lib.bb` → RETIRED'),
    ['first_lib.bb', 'second_lib.bb']
  );
});

test('loadRetiredTokens over the live docs yields only the genuine referent', () => {
  const tokens = loadRetiredTokens(path.join(__dirname, '..', '..'));
  assert.deepEqual(tokens, ['type: bug']);
  // The four the old extractor produced, three of which are ordinary project
  // vocabulary that held real tickets before every promotion.
  for (const falsePositive of ['Mint', 'All', 'Expedite', 'backlog_hygiene_lib.bb']) {
    assert.ok(!tokens.includes(falsePositive), `"${falsePositive}" is still extracted as a retired token`);
  }
});

// ── end to end through the gate ─────────────────────────────────────────

function fixtureRoot(docLine, description) {
  const root = mkTmpDir('bl1193-');
  fs.mkdirSync(path.join(root, 'docs', 'how-to'), { recursive: true });
  fs.writeFileSync(path.join(root, 'docs', 'how-to', 'note.md'), `${docLine}\n`);
  fs.mkdirSync(path.join(root, 'backlog', 'paused'), { recursive: true });
  fs.mkdirSync(path.join(root, 'backlog', 'done'), { recursive: true });
  fs.writeFileSync(path.join(root, 'backlog', 'done', 'BL-1-dep.yaml'), 'id: BL-1\n');
  fs.writeFileSync(
    path.join(root, 'backlog', 'paused', 'BL-77-fixture.yaml'),
    `id: BL-77\ndepends_on: [BL-1]\ndescription: ${description}\n`
  );
  return root;
}

test('a ticket naming only the co-occurring word is allowed', () => {
  const root = fixtureRoot(LIVE_ROW, 'builds a Mint durability gate');
  assert.equal(deprecateCheck(root, 'BL-77').decision, 'allow');
});

test('a ticket naming the genuine retired item still holds, and the reason names it', () => {
  const root = fixtureRoot(LIVE_ROW, 'still promotes on type: bug candidates');
  const decision = deprecateCheck(root, 'BL-77');
  assert.equal(decision.decision, 'hold');
  assert.match(decision.reason, /type: bug/);
});

test('a ticket naming both is held for the genuine item only', () => {
  const root = fixtureRoot(LIVE_ROW, 'the Mint gate still promotes on type: bug candidates');
  const decision = deprecateCheck(root, 'BL-77');
  assert.equal(decision.decision, 'hold');
  assert.match(decision.reason, /type: bug/);
  assert.ok(!/\bMint\b/.test(decision.reason), `the reason still names the co-occurring word: ${decision.reason}`);
});
