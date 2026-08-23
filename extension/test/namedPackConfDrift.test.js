'use strict';

const assert = require('node:assert/strict');
const {
  extractNamedPackConfs,
  isIllustrativePackPlaceholder,
  findAbsentNamedPackConfs,
} = require('../out/docs/namedPackConfDrift');

test('isIllustrativePackPlaceholder recognises ALL-CAPS stems only', () => {
  assert.equal(isIllustrativePackPlaceholder('NAME'), true);
  assert.equal(isIllustrativePackPlaceholder('PACK'), true);
  assert.equal(isIllustrativePackPlaceholder('qwen-mono-router'), false);
  assert.equal(isIllustrativePackPlaceholder('qwen-code-mono-router'), false);
  assert.equal(isIllustrativePackPlaceholder('Name'), false);
});

test('extractNamedPackConfs dedupes and keeps stem', () => {
  const refs = extractNamedPackConfs(
    'see swarmforge/packs/foo.conf and again swarmforge/packs/foo.conf plus swarmforge/packs/NAME.conf'
  );
  assert.deepEqual(
    refs.map((r) => r.namedPath),
    ['swarmforge/packs/foo.conf', 'swarmforge/packs/NAME.conf']
  );
});

test('findAbsentNamedPackConfs skips placeholders and existing packs', () => {
  const docs = [
    'launch swarmforge/packs/qwen-code-mono-router.conf',
    'or swarmforge/packs/NAME.conf',
    'or swarmforge/packs/qwen-mono-router.conf',
  ];
  const existing = new Set(['swarmforge/packs/qwen-mono-router.conf']);
  assert.deepEqual(findAbsentNamedPackConfs(docs, existing), [
    'swarmforge/packs/qwen-code-mono-router.conf',
  ]);
});

test('findAbsentNamedPackConfs skips the shipped-work log by path', () => {
  const docs = [
    {
      relativePath: 'docs/reference/Specification.MD',
      text: 'historical swarmforge/packs/qwen-code-mono-router.conf',
    },
    {
      relativePath: 'docs/index.md',
      text: 'live swarmforge/packs/missing-pack.conf',
    },
  ];
  assert.deepEqual(findAbsentNamedPackConfs(docs, []), ['swarmforge/packs/missing-pack.conf']);
});
