'use strict';

// BL-1117 invariants: tip review only; green tests never certify the ledger.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const REPO = path.join(__dirname, '..', '..');
const TIP = '646ffe85d';
const LEDGER = path.join(REPO, 'backlog', 'hotfix-ledger.yaml');

function tipEscapeHtmlSnippet() {
  return execFileSync('git', ['show', `${TIP}:extension/src/concierge/pipelineBoard.ts`], {
    cwd: REPO,
    encoding: 'utf8',
  });
}

const tipSrc = tipEscapeHtmlSnippet();
assert.ok(tipSrc.includes("replace(/\\u00a0/g, '&#160;')") || tipSrc.includes('&#160;'), 'tip must emit numeric entity');
assert.ok(!/replace\(\/\\u00a0\/g,\s*'&nbsp;'\)/.test(tipSrc), 'tip must not emit named nbsp');

const headSrc = fs.readFileSync(path.join(REPO, 'extension', 'src', 'concierge', 'pipelineBoard.ts'), 'utf8');
assert.ok(headSrc.includes("'&#160;'"), 'HEAD must match tip numeric entity');
assert.ok(!headSrc.includes(".replace(/\\u00a0/g, '&nbsp;')"), 'HEAD must not use named nbsp replace');

const ledger = fs.readFileSync(LEDGER, 'utf8');
assert.match(ledger, /commit: 646ffe85d/);
assert.match(ledger, /stamp_ticket: BL-1117/);
assert.ok(!/commit: 646ffe85d[\s\S]*?state: certified/.test(ledger.split('- commit: 646ffe85d')[1]?.slice(0, 200) || ''), 'tests must not certify');
const row = ledger.split('- commit: 646ffe85d')[1].split('- commit:')[0];
assert.match(row, /state: pending/);
assert.match(row, /human_decision: null/);

console.log('bl1117_stamp_off_property: ALL PROPERTIES HOLD');
