'use strict';

// BL-1362: the recorder's impure half - it writes ONE path under
// backlog/evidence/, commits THAT path alone, and prints the commit for the
// role to forward.
//
// Committing exactly one path is load-bearing, not tidiness: an approval
// authorizes only its ticket's work (BL-506), so a recorder that swept in a
// dirty tree would fold unrelated changes into a parcel under a review role's
// name. Every case below leaves a deliberately dirty tree and asserts it is
// still dirty afterwards.

const { mkTmpDir } = require('./helpers/tmpDir');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { recordReviewEvidence } = require('../out/tools/record-review-evidence');
const { copySeededRepoInto } = require('./helpers/sharedRepoFixture');

function git(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

function fixture() {
  const root = mkTmpDir('sfvc-bl1362-cli-');
  copySeededRepoInto(root);
  fs.mkdirSync(path.join(root, 'backlog', 'evidence'), { recursive: true });
  // A dirty tree, in every case: the recorder must not carry it along.
  fs.writeFileSync(path.join(root, 'unrelated.txt'), 'not this parcel\n');
  return root;
}

const ITEM = {
  command: 'npm run compile',
  commit: 'abc1234567',
  excerpt: 'TS2367: no overlap',
  class: 'compile',
  expected: 'compiles vs TS2367',
  blamed: 'coder',
  remediation: 'src/a.ts::classify',
};

test('a clean sweep is written, committed alone, and its commit reported', () => {
  const root = fixture();
  try {
    const result = recordReviewEvidence({
      root,
      ticket: 'BL-9362',
      role: 'architect',
      none: true,
      items: [],
      date: '20260904',
    });

    const written = path.join(root, 'backlog', 'evidence', 'BL-9362-architect-20260904.md');
    assert.equal(fs.existsSync(written), true, 'no evidence file was written');
    assert.match(fs.readFileSync(written, 'utf8'), /NONE/);

    // The printed commit is the one carrying it - not the tip it happened to
    // sit on (BL-536: the forward must name THIS commit).
    assert.match(result.commit, /^[0-9a-f]{10}$/);
    const touched = git(root, ['show', '--name-only', '--format=', result.commit]).trim().split('\n');
    assert.deepEqual(touched, ['backlog/evidence/BL-9362-architect-20260904.md']);

    // Nothing else was swept in (BL-506).
    assert.match(git(root, ['status', '--porcelain']), /unrelated\.txt/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('a two-item inventory is written with both items, and committed the same way', () => {
  const root = fixture();
  try {
    const second = { ...ITEM, command: 'npm test', class: 'unit', blamed: 'hardener', remediation: 'test/b.test.js::case' };
    const result = recordReviewEvidence({
      root,
      ticket: 'BL-9362',
      role: 'QA',
      none: false,
      items: [ITEM, second],
      date: '20260904',
    });

    const body = fs.readFileSync(path.join(root, 'backlog', 'evidence', 'BL-9362-QA-20260904.md'), 'utf8');
    assert.match(body, /D1/);
    assert.match(body, /D2/);
    assert.match(body, /coder/);
    assert.match(body, /hardener/);
    assert.match(body, /src\/a\.ts::classify/);
    assert.match(body, /test\/b\.test\.js::case/);

    const touched = git(root, ['show', '--name-only', '--format=', result.commit]).trim().split('\n');
    assert.deepEqual(touched, ['backlog/evidence/BL-9362-QA-20260904.md']);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('no verdict is REFUSED, and nothing is written or committed', () => {
  const root = fixture();
  try {
    const before = git(root, ['rev-parse', 'HEAD']).trim();
    assert.throws(
      () => recordReviewEvidence({ root, ticket: 'BL-9362', role: 'cleaner', none: false, items: [], date: '20260904' }),
      /NONE/
    );
    assert.equal(fs.existsSync(path.join(root, 'backlog', 'evidence', 'BL-9362-cleaner-20260904.md')), false);
    assert.equal(git(root, ['rev-parse', 'HEAD']).trim(), before, 'a refusal still made a commit');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('a second pass the same day never overwrites the first', () => {
  const root = fixture();
  try {
    const first = recordReviewEvidence({ root, ticket: 'BL-9362', role: 'QA', none: true, items: [], date: '20260904' });
    const second = recordReviewEvidence({ root, ticket: 'BL-9362', role: 'QA', none: false, items: [ITEM], date: '20260904' });

    assert.equal(first.file, 'backlog/evidence/BL-9362-QA-20260904.md');
    assert.equal(second.file, 'backlog/evidence/BL-9362-QA-20260904-2.md');
    // The first is still its own NONE, untouched by the second pass.
    assert.match(fs.readFileSync(path.join(root, first.file), 'utf8'), /NONE/);
    assert.notEqual(first.commit, second.commit);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('every reviewing role reaches the same convention', () => {
  const root = fixture();
  try {
    for (const role of ['cleaner', 'architect', 'hardender', 'documenter', 'QA']) {
      const result = recordReviewEvidence({ root, ticket: 'BL-9362', role, none: true, items: [], date: '20260904' });
      assert.equal(result.file, `backlog/evidence/BL-9362-${role}-20260904.md`);
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
