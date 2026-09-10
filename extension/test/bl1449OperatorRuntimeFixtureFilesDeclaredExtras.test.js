const assert = require('node:assert/strict');
const { buildOperatorRuntimeBbFiles } = require('../../specs/pipeline/steps/lib/operatorRuntimeBbFixtureFiles');

// BL-1449 hardening: OPERATOR_RUNTIME_BB_DECLARED_EXTRAS is empty today, so
// no test exercising the LIVE module can tell "extras appended" apart from
// "extras silently dropped" - a hand-mutation check confirmed removing the
// concat entirely left every scenario and unit test green. This drives the
// extracted append function directly with a non-empty extras list so the
// mechanism itself is proven, independent of what the live constant holds.

test('buildOperatorRuntimeBbFiles appends every declared extra onto the closure', () => {
  const result = buildOperatorRuntimeBbFiles(['a_lib.bb', 'b_lib.bb'], ['zz_extra_lib.bb']);
  assert.deepEqual(result, ['a_lib.bb', 'b_lib.bb', 'zz_extra_lib.bb']);
});

test('buildOperatorRuntimeBbFiles returns the closure unchanged when extras is empty', () => {
  const closure = ['a_lib.bb', 'b_lib.bb'];
  assert.deepEqual(buildOperatorRuntimeBbFiles(closure, []), closure);
});
