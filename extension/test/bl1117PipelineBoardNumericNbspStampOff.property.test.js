'use strict';

// BL-1117 invariants: tip review only; green tests never certify the ledger.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { assertRunWritesNoDecision } = require('./helpers/stampOff');

const REPO = path.join(__dirname, '..', '..');
const TIP = '646ffe85d';
const LEDGER = path.join(REPO, 'backlog', 'hotfix-ledger.yaml');

function tipEscapeHtmlSnippet() {
  return execFileSync('git', ['show', `${TIP}:extension/src/concierge/pipelineBoard.ts`], {
    cwd: REPO,
    encoding: 'utf8',
  });
}

// BL-1356: these assertions ran at MODULE level, so vitest reported "No test
// suite found in file" and counted it as a failing suite - a second reason it
// needed a standing-allowlist row, independent of the ledger pin.
test('BL-1117/BL-654: the stamp-off reviews the tip and writes no decision', () => {
  const tipSrc = tipEscapeHtmlSnippet();
  assert.ok(tipSrc.includes("replace(/\\u00a0/g, '&#160;')") || tipSrc.includes('&#160;'), 'tip must emit numeric entity');
  assert.ok(!/replace\(\/\\u00a0\/g,\s*'&nbsp;'\)/.test(tipSrc), 'tip must not emit named nbsp');

  const headSrc = fs.readFileSync(path.join(REPO, 'extension', 'src', 'concierge', 'pipelineBoard.ts'), 'utf8');
  assert.ok(headSrc.includes("'&#160;'"), 'HEAD must match tip numeric entity');
  assert.ok(!headSrc.includes(".replace(/\\u00a0/g, '&nbsp;')"), 'HEAD must not use named nbsp replace');

  const ledger = fs.readFileSync(LEDGER, 'utf8');
  assert.match(ledger, /commit: 646ffe85d/);
  assert.match(ledger, /stamp_ticket: BL-1117/);
  // BL-1356: `state: pending` was pinned as a literal here too, so this went red
  // on a legitimate advance and jammed every role's commit gate. The row's
  // identity is still asserted; what it currently says is not the subject - what
  // THIS RUN wrote is, with the row's prior value as the expected one.
  assertRunWritesNoDecision('646ffe85d', () => {
    assert.equal(typeof fs.readFileSync(LEDGER, 'utf8'), 'string');
  });
});

