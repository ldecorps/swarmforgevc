const assert = require('node:assert/strict');
const {
  classifyMutationGateHealth,
  buildMutationGateHealthVerdict,
  formatMutationGateHealthVerdict,
} = require('../out/mutation/mutationGateHealth');

// ── classifyMutationGateHealth (pure) — BL-446 mutation-gate-zero-kill-broken-01 ──

test('any killed mutant reads healthy, even with survivors alongside it', () => {
  assert.equal(classifyMutationGateHealth(8, 0), 'healthy');
  assert.equal(classifyMutationGateHealth(5, 3), 'healthy');
});

test('zero killed with survivors present reads zero-kill-suspect', () => {
  assert.equal(classifyMutationGateHealth(0, 94), 'zero-kill-suspect');
});

test('zero killed and zero survived (nothing to mutate) reads no-mutants', () => {
  assert.equal(classifyMutationGateHealth(0, 0), 'no-mutants');
});

// ── buildMutationGateHealthVerdict (pure) ───────────────────────────────────

test('buildMutationGateHealthVerdict carries the counts alongside the health', () => {
  assert.deepEqual(buildMutationGateHealthVerdict(0, 94), { health: 'zero-kill-suspect', killed: 0, survived: 94 });
  assert.deepEqual(buildMutationGateHealthVerdict(8, 0), { health: 'healthy', killed: 8, survived: 0 });
  assert.deepEqual(buildMutationGateHealthVerdict(0, 0), { health: 'no-mutants', killed: 0, survived: 0 });
});

// ── formatMutationGateHealthVerdict (pure) — BL-446 mutation-gate-zero-kill-broken-02 ──

test('formatMutationGateHealthVerdict surfaces a zero-kill run as suspect with its counts, not a clean pass', () => {
  const text = formatMutationGateHealthVerdict(buildMutationGateHealthVerdict(0, 94));
  assert.match(text, /suspect/i);
  assert.match(text, /0 killed/);
  assert.match(text, /94 survived/);
  assert.doesNotMatch(text, /healthy/);
});

test('formatMutationGateHealthVerdict reports a healthy run as healthy with its counts', () => {
  const text = formatMutationGateHealthVerdict(buildMutationGateHealthVerdict(5, 3));
  assert.match(text, /healthy/);
  assert.match(text, /5 killed/);
  assert.match(text, /3 survived/);
});

test('formatMutationGateHealthVerdict reports no-mutants distinctly from healthy or suspect', () => {
  const text = formatMutationGateHealthVerdict(buildMutationGateHealthVerdict(0, 0));
  assert.match(text, /no mutants/i);
  assert.doesNotMatch(text, /suspect/i);
});
