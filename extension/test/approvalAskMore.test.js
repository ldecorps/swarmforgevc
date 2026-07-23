const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { mkTmpDir } = require('./helpers/tmpDir');

const {
  formatApprovalMoreText,
  approvalMoreContentFromItem,
  loadApprovalMoreText,
  APPROVAL_MORE_TELEGRAM_CAP,
} = require('../out/concierge/approvalAskMore');

test('formatApprovalMoreText: renders Spec and Gherkin sections', () => {
  const text = formatApprovalMoreText({
    backlogId: 'BL-525',
    title: 'ModelFactory',
    spec: 'Full APS prose here.',
    gherkin: 'Scenario: cold then hot swap\n  Given a role',
  });
  assert.match(text, /^BL-525 — ModelFactory\n/);
  assert.match(text, /— Spec —\nFull APS prose here\./);
  assert.match(text, /— Gherkin —\nScenario: cold then hot swap/);
});

test('formatApprovalMoreText: missing spec and gherkin degrade to explicit placeholders', () => {
  const text = formatApprovalMoreText({ backlogId: 'BL-1' });
  assert.match(text, /— Spec —\n\(no spec on disk for this ticket\)/);
  assert.match(text, /— Gherkin —\n\(no Gherkin scenarios on disk for this ticket\)/);
});

test('formatApprovalMoreText: truncates oversized bodies for Telegram', () => {
  const text = formatApprovalMoreText({
    backlogId: 'BL-1',
    spec: 'S'.repeat(APPROVAL_MORE_TELEGRAM_CAP),
    gherkin: 'G'.repeat(500),
  });
  assert.ok(text.length <= APPROVAL_MORE_TELEGRAM_CAP);
  assert.match(text, /… \(truncated for Telegram\)$/);
});

test('approvalMoreContentFromItem: prefers description over notes for the Spec section', () => {
  const content = approvalMoreContentFromItem(
    { id: 'BL-1', title: 'T', status: 'todo', description: 'desc', notes: 'notes' },
    'Feature: x'
  );
  assert.equal(content.spec, 'desc');
  assert.equal(content.gherkin, 'Feature: x');
});

test('loadApprovalMoreText: loads description + feature file from a real backlog fixture', () => {
  const root = mkTmpDir('approval-more-');
  const featureRel = 'specs/features/BL-1-demo.feature';
  fs.mkdirSync(path.join(root, 'backlog', 'paused'), { recursive: true });
  fs.mkdirSync(path.join(root, 'specs', 'features'), { recursive: true });
  fs.writeFileSync(
    path.join(root, 'backlog', 'paused', 'BL-1-demo.yaml'),
    [
      'id: BL-1',
      'title: "Demo ticket"',
      'status: todo',
      'human_approval: pending',
      'description: |',
      '  The full spec body.',
      `acceptance: ${featureRel}`,
      '',
    ].join('\n')
  );
  fs.writeFileSync(
    path.join(root, featureRel),
    ['Feature: Demo', '', 'Scenario: works', '  Given a thing', ''].join('\n')
  );
  const text = loadApprovalMoreText(root, 'BL-1');
  assert.match(text, /BL-1 — Demo ticket/);
  assert.match(text, /The full spec body\./);
  assert.match(text, /Scenario: works/);
});

test('loadApprovalMoreText: unknown ticket still returns placeholders (never throws)', () => {
  const root = mkTmpDir('approval-more-missing-');
  fs.mkdirSync(path.join(root, 'backlog', 'paused'), { recursive: true });
  const text = loadApprovalMoreText(root, 'BL-999');
  assert.match(text, /no spec on disk/);
  assert.match(text, /no Gherkin scenarios on disk/);
});
