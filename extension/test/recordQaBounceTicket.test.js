const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { mkTmpDir } = require('./helpers/tmpDir');
const { updateTicketBounceHistory } = require('../out/tools/recordQaBounceTicket');

// BL-608: direct unit coverage for the fs edges of the ticket-record merge -
// bounceHistory.test.js covers the pure merge core; recordQaBounceCli.test.js
// covers the CLI end to end. This file isolates findActiveTicketYamlPath's
// selection logic and the catch-all error path, neither of which needs a
// full CLI invocation to exercise.

function entry(overrides = {}) {
  return {
    at: '2026-07-23',
    by: 'QA',
    blamed: 'coder',
    failureClass: 'behavior',
    commit: '1f7987dd4a',
    evidence: 'backlog/evidence/BL-608-qa-bounce-20260723.md',
    ...overrides,
  };
}

function activeDir(root) {
  const dir = path.join(root, 'backlog', 'active');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

test('updateTicketBounceHistory reports not-found when backlog/active/ does not exist at all', () => {
  const root = mkTmpDir('sfvc-record-qa-bounce-ticket-');
  const result = updateTicketBounceHistory(root, 'BL-340', entry());
  assert.deepEqual(result, { updated: false, reason: 'not-found' });
});

// Selector probe (2+ candidates): a file that matches the ticket PREFIX but
// not the .yaml extension must never be treated as a match on its own.
test('updateTicketBounceHistory ignores a same-prefixed file with the wrong extension', () => {
  const root = mkTmpDir('sfvc-record-qa-bounce-ticket-');
  const dir = activeDir(root);
  fs.writeFileSync(path.join(dir, 'BL-340-notes.txt'), 'id: BL-340\n');
  const result = updateTicketBounceHistory(root, 'BL-340', entry());
  assert.equal(result.updated, false);
  assert.equal(result.reason, 'not-found');
});

// Selector probe (2+ candidates): a .yaml file for a DIFFERENT ticket must
// never be treated as a match just because the extension is right.
test('updateTicketBounceHistory ignores a differently-prefixed yaml file', () => {
  const root = mkTmpDir('sfvc-record-qa-bounce-ticket-');
  const dir = activeDir(root);
  fs.writeFileSync(path.join(dir, 'BL-999-other.yaml'), 'id: BL-999\n');
  const result = updateTicketBounceHistory(root, 'BL-340', entry());
  assert.equal(result.updated, false);
  assert.equal(result.reason, 'not-found');
  // the decoy is untouched
  assert.equal(fs.readFileSync(path.join(dir, 'BL-999-other.yaml'), 'utf8'), 'id: BL-999\n');
});

test('updateTicketBounceHistory updates the one file that matches both the ticket prefix and the .yaml extension', () => {
  const root = mkTmpDir('sfvc-record-qa-bounce-ticket-');
  const dir = activeDir(root);
  const ticketPath = path.join(dir, 'BL-340-fixture.yaml');
  fs.writeFileSync(ticketPath, 'id: BL-340\ntitle: "fixture"\n');
  const result = updateTicketBounceHistory(root, 'BL-340', entry());
  assert.equal(result.updated, true);
  assert.match(fs.readFileSync(ticketPath, 'utf8'), /bounce_count: 1/);
});

// The catch-all error path (error instanceof Error ? error.message :
// 'unknown-error') never sees a non-Error throw from any real fs or
// bounceHistory call - it is defensive against whatever might be thrown at
// this boundary. Exercised by temporarily replacing fs.readFileSync with one
// that throws a plain string, restored in `finally` regardless of outcome.
test('updateTicketBounceHistory degrades to reason "unknown-error" when a non-Error value is thrown', () => {
  const root = mkTmpDir('sfvc-record-qa-bounce-ticket-');
  const dir = activeDir(root);
  fs.writeFileSync(path.join(dir, 'BL-340-fixture.yaml'), 'id: BL-340\n');
  const originalReadFileSync = fs.readFileSync;
  fs.readFileSync = () => {
    throw 'non-error-throw';
  };
  try {
    const result = updateTicketBounceHistory(root, 'BL-340', entry());
    assert.equal(result.updated, false);
    assert.equal(result.reason, 'unknown-error');
  } finally {
    fs.readFileSync = originalReadFileSync;
  }
});
