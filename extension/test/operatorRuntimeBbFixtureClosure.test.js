const assert = require('node:assert/strict');
const path = require('node:path');
const { diffClosureAgainstList, directLoadFileDeps } = require('../../specs/pipeline/steps/lib/operatorRuntimeBbClosure');
const { OPERATOR_RUNTIME_BB_FILES, OPERATOR_RUNTIME_BB_DECLARED_EXTRAS } = require('../../specs/pipeline/steps/lib/operatorRuntimeBbFixtureFiles');

// BL-944: gives the fixture-dependency-closure guard a standing home in the
// ONE suite every parcel runs (npm test/npm run coverage, vitest.config.mjs)
// - mirrors BL-872's tempDirTrapGuard.test.js and BL-817's
// tmuxReaperGuard.test.js precedent, so this check is never left to
// specs/pipeline/test/, which no standing gate runs (the exact reason this
// list drifted five times before anyone noticed a sixth).

const SCRIPTS_DIR = path.join(__dirname, '..', '..', 'swarmforge', 'scripts');

test('directLoadFileDeps finds a load-file target inside real source text', () => {
  const text = '(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "foo_lib.bb")))\n';
  assert.deepEqual(directLoadFileDeps(text), ['foo_lib.bb']);
});

test('directLoadFileDeps finds nothing in text with no load-file form', () => {
  assert.deepEqual(directLoadFileDeps('(defn foo [] 1)\n'), []);
});

// BL-944 required_wiring: the first missing dependency in load order - its
// presence in the real closure is the minimum proof the list was actually
// corrected, not just guarded.
test('the real closure of operator_runtime.bb reaches mono_router_lib.bb', () => {
  const { closure } = diffClosureAgainstList(SCRIPTS_DIR, 'operator_runtime.bb', OPERATOR_RUNTIME_BB_FILES, OPERATOR_RUNTIME_BB_DECLARED_EXTRAS);
  assert.ok(closure.has('mono_router_lib.bb'), 'expected mono_router_lib.bb in the real closure');
});

// ── break-then-fix (impure, real fs) - proves the closure walk itself
// reaches disk when driven from THIS suite ──────────────────────────────
test('the closure check names a removed dependency as missing, and clears once restored', () => {
  const withoutOne = OPERATOR_RUNTIME_BB_FILES.filter((f) => f !== 'handoff_lib.bb');
  const before = diffClosureAgainstList(SCRIPTS_DIR, 'operator_runtime.bb', withoutOne, OPERATOR_RUNTIME_BB_DECLARED_EXTRAS);
  assert.ok(before.missing.includes('handoff_lib.bb'), `expected handoff_lib.bb reported missing, got: ${JSON.stringify(before.missing)}`);

  const after = diffClosureAgainstList(SCRIPTS_DIR, 'operator_runtime.bb', OPERATOR_RUNTIME_BB_FILES, OPERATOR_RUNTIME_BB_DECLARED_EXTRAS);
  assert.deepEqual(after.missing, []);
});

test('an undeclared extra entry is reported; a declared one is not', () => {
  const withExtra = [...OPERATOR_RUNTIME_BB_FILES, 'bl944-not-a-real-dependency.bb'];
  const undeclared = diffClosureAgainstList(SCRIPTS_DIR, 'operator_runtime.bb', withExtra, OPERATOR_RUNTIME_BB_DECLARED_EXTRAS);
  assert.deepEqual(undeclared.extra, ['bl944-not-a-real-dependency.bb']);

  const declared = diffClosureAgainstList(SCRIPTS_DIR, 'operator_runtime.bb', withExtra, [
    { file: 'bl944-not-a-real-dependency.bb', reason: 'test fixture only' },
  ]);
  assert.deepEqual(declared.extra, []);
});

// BL-944's own gate: the actual closure-honesty check, collected by the
// standing suite instead of a suite nothing runs. required_wiring anchor:
// this exact filename, this exact assertion.
test('OPERATOR_RUNTIME_BB_FILES covers the real transitive load-file closure of operator_runtime.bb, with no undeclared extras', () => {
  const { missing, extra } = diffClosureAgainstList(SCRIPTS_DIR, 'operator_runtime.bb', OPERATOR_RUNTIME_BB_FILES, OPERATOR_RUNTIME_BB_DECLARED_EXTRAS);
  assert.deepEqual(missing, [], `expected zero missing dependencies, found:\n${missing.join('\n')}`);
  assert.deepEqual(extra, [], `expected zero undeclared extra entries, found:\n${extra.join('\n')}`);
});
