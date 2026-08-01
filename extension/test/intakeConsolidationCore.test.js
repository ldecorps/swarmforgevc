const assert = require('node:assert/strict');
const { mergeIntakes, splitIntake, isConsolidationTarget } = require('../out/tools/intakeConsolidationCore');

// ── mergeIntakes (N:1) ──────────────────────────────────────────────────

test('mergeIntakes unions every source directive verbatim, deduped, first-seen order', () => {
  const merged = mergeIntakes([
    { intakeId: 'INTAKE-A', directives: ['do the thing', 'shared directive'] },
    { intakeId: 'INTAKE-B', directives: ['shared directive', 'do the other thing'] },
  ]);
  assert.deepEqual(merged.sourceIntakeIds, ['INTAKE-A', 'INTAKE-B']);
  assert.deepEqual(merged.directives, ['do the thing', 'shared directive', 'do the other thing']);
});

test('mergeIntakes supports more than two sources', () => {
  const merged = mergeIntakes([
    { intakeId: 'INTAKE-A', directives: ['a'] },
    { intakeId: 'INTAKE-B', directives: ['b'] },
    { intakeId: 'INTAKE-C', directives: ['c'] },
  ]);
  assert.deepEqual(merged.sourceIntakeIds, ['INTAKE-A', 'INTAKE-B', 'INTAKE-C']);
  assert.deepEqual(merged.directives, ['a', 'b', 'c']);
});

test('mergeIntakes refuses fewer than two sources', () => {
  assert.throws(() => mergeIntakes([{ intakeId: 'INTAKE-A', directives: ['a'] }]), /at least two/);
  assert.throws(() => mergeIntakes([]), /at least two/);
});

// ── splitIntake (1:N) ───────────────────────────────────────────────────

test('splitIntake maps every part onto its own ticket and points the intake at all of them', () => {
  const result = splitIntake('INTAKE-X', [
    { ticketId: 'BL-901', mechanism: 'walker' },
    { ticketId: 'BL-902', mechanism: 'telemetry' },
    { ticketId: 'BL-903', mechanism: 'burn meter' },
  ]);
  assert.equal(result.sourceIntakeId, 'INTAKE-X');
  assert.deepEqual(
    result.parts.map((p) => p.ticketId),
    ['BL-901', 'BL-902', 'BL-903']
  );
  assert.deepEqual(
    result.parts.map((p) => p.mechanism),
    ['walker', 'telemetry', 'burn meter']
  );
});

test('splitIntake refuses a mechanism named in more than one resulting ticket', () => {
  assert.throws(
    () =>
      splitIntake('INTAKE-X', [
        { ticketId: 'BL-901', mechanism: 'walker' },
        { ticketId: 'BL-902', mechanism: 'walker' },
      ]),
    /exactly one/
  );
});

test('splitIntake refuses a duplicate resulting ticket id', () => {
  assert.throws(
    () =>
      splitIntake('INTAKE-X', [
        { ticketId: 'BL-901', mechanism: 'walker' },
        { ticketId: 'BL-901', mechanism: 'telemetry' },
      ]),
    /distinct/
  );
});

test('splitIntake refuses fewer than two resulting tickets', () => {
  assert.throws(() => splitIntake('INTAKE-X', [{ ticketId: 'BL-901', mechanism: 'walker' }]), /at least two/);
  assert.throws(() => splitIntake('INTAKE-X', []), /at least two/);
});

// ── isConsolidationTarget (spec-time-only bound) ────────────────────────

test('isConsolidationTarget allows paused tickets and operator intake files', () => {
  assert.equal(isConsolidationTarget('backlog/paused/BL-901-walker.yaml'), true);
  assert.equal(isConsolidationTarget('.swarmforge/operator/INTAKE-walker.md'), true);
});

test('isConsolidationTarget refuses anything under the active backlog', () => {
  assert.equal(isConsolidationTarget('backlog/active/BL-680-specifier-consolidation-authority.yaml'), false);
});

test('isConsolidationTarget refuses paths outside both allowed roots', () => {
  assert.equal(isConsolidationTarget('backlog/done/BL-042-shipped.yaml'), false);
  assert.equal(isConsolidationTarget('backlog/hold/BL-590-onboarding-facilitator-agent.yaml'), false);
});
