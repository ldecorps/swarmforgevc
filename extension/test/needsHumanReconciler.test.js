const assert = require('node:assert/strict');
const { NeedsHumanReconciler } = require('../out/panel/needsHumanReconciler');

test('question source alone: emits true then false as it changes', () => {
  const r = new NeedsHumanReconciler();
  assert.deepEqual(r.applyQuestionEvents([{ role: 'coder', needsHuman: true }]), [
    { role: 'coder', needsHuman: true }
  ]);
  assert.deepEqual(r.applyQuestionEvents([{ role: 'coder', needsHuman: false }]), [
    { role: 'coder', needsHuman: false }
  ]);
});

test('stuck source alone: emits true then false as escalation set changes', () => {
  const r = new NeedsHumanReconciler();
  assert.deepEqual(r.applyStuckRoles(['hardender']), [{ role: 'hardender', needsHuman: true }]);
  assert.deepEqual(r.applyStuckRoles([]), [{ role: 'hardender', needsHuman: false }]);
});

test('BL-067 race: stuck escalation stays true even when the question detector flips false for the same role', () => {
  const r = new NeedsHumanReconciler();
  // Chaser escalates hardender (idle, chases exhausted).
  assert.deepEqual(r.applyStuckRoles(['hardender']), [{ role: 'hardender', needsHuman: true }]);
  // Independently, the pane's captured text never matched a question pattern
  // (or briefly did and stopped) -- the question detector reports false for
  // the same role. Before the fix this cleared the tile outright.
  assert.deepEqual(r.applyQuestionEvents([{ role: 'hardender', needsHuman: false }]), []);
});

test('BL-067 race, other direction: question-detector false does not mask a still-true stuck escalation once both have reported', () => {
  const r = new NeedsHumanReconciler();
  r.applyQuestionEvents([{ role: 'hardender', needsHuman: true }]);
  r.applyStuckRoles(['hardender']);
  // Question resolved (human answered), but the chaser has not recovered yet.
  assert.deepEqual(r.applyQuestionEvents([{ role: 'hardender', needsHuman: false }]), []);
});

test('combined state only clears once BOTH sources report false', () => {
  const r = new NeedsHumanReconciler();
  r.applyQuestionEvents([{ role: 'hardender', needsHuman: true }]);
  r.applyStuckRoles(['hardender']);
  // Question resolves first: still escalated by the chaser, no clear yet.
  assert.deepEqual(r.applyQuestionEvents([{ role: 'hardender', needsHuman: false }]), []);
  // Chaser recovers too: now both are false, tile clears.
  assert.deepEqual(r.applyStuckRoles([]), [{ role: 'hardender', needsHuman: false }]);
});

test('independent roles do not interfere with each other', () => {
  const r = new NeedsHumanReconciler();
  assert.deepEqual(
    r.applyQuestionEvents([
      { role: 'coder', needsHuman: true },
      { role: 'cleaner', needsHuman: true }
    ]),
    [
      { role: 'coder', needsHuman: true },
      { role: 'cleaner', needsHuman: true }
    ]
  );
  assert.deepEqual(r.applyStuckRoles(['architect']), [{ role: 'architect', needsHuman: true }]);
  assert.deepEqual(r.applyQuestionEvents([{ role: 'coder', needsHuman: false }]), [
    { role: 'coder', needsHuman: false }
  ]);
});

test('re-applying the same stuck set emits no deltas', () => {
  const r = new NeedsHumanReconciler();
  r.applyStuckRoles(['QA']);
  assert.deepEqual(r.applyStuckRoles(['QA']), []);
});

test('re-applying an unchanged question event for an untracked role emits no deltas', () => {
  const r = new NeedsHumanReconciler();
  assert.deepEqual(r.applyQuestionEvents([{ role: 'documenter', needsHuman: false }]), []);
});
