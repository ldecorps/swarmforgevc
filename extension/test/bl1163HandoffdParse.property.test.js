'use strict';

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const fc = require('fast-check');

// BL-1163 invariant: handoffd.bb loads under Babashka without unmatched-delimiter
// / EOF-while-reading on the paths BL-728 already exercises.

const REPO = path.join(__dirname, '..', '..');
const HANDOFFD = path.join(REPO, 'swarmforge', 'scripts', 'handoffd.bb');

test('invariant: handoffd.bb is balanced enough for babashka to start reading it', () => {
  const text = fs.readFileSync(HANDOFFD, 'utf8');
  let depth = 0;
  for (const ch of text) {
    if (ch === '(') depth += 1;
    if (ch === ')') depth -= 1;
    assert.ok(depth >= 0, 'closing paren before open');
  }
  assert.equal(depth, 0, `unbalanced parens; depth=${depth}`);
});

test('invariant property: bb load of handoffd never reports EOF-while-reading / unmatched', () => {
  // Single-path property (generator reaches the live file); fail shape locked.
  fc.assert(
    fc.property(fc.constant(HANDOFFD), (file) => {
      const r = spawnSync('bb', ['-e', `(load-file "${file}")`], {
        encoding: 'utf8',
        timeout: 60000,
      });
      const out = `${r.stdout || ''}${r.stderr || ''}`;
      assert.doesNotMatch(out, /EOF while reading/i);
      assert.doesNotMatch(out, /Unmatched delimiter/i);
      assert.doesNotMatch(out, /expected \)/i);
    }),
    { numRuns: 1 }
  );
});

test('non-vacuous: deliberately truncated handoffd excerpt would fail balance check', () => {
  const text = fs.readFileSync(HANDOFFD, 'utf8');
  const broken = text.replace(/\(defn- post-qa-branch-sweep-role-dirty\?[\s\S]*?\)\)\n/, '(defn- post-qa-branch-sweep-role-dirty? [worktree-path]\n');
  let depth = 0;
  let wentNegative = false;
  for (const ch of broken) {
    if (ch === '(') depth += 1;
    if (ch === ')') depth -= 1;
    if (depth < 0) wentNegative = true;
  }
  assert.ok(depth !== 0 || wentNegative, 'truncated excerpt must be unbalanced');
});
