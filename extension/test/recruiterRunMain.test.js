const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { parseArgs, readCurrentModelByRole } = require('../out/tools/recruiter-run');

// Hardener split (BL-233 hardening pass): parseArgs/readCurrentModelByRole
// were pulled out of recruiter-run.ts's main() so they can be exercised
// in-process, same convention as trace-hop.ts's own pure helpers (see
// traceHopCli.test.js) - a CLI main() run only through recruiterRunCli.
// test.js's execFileSync subprocess never shows up under coverage
// instrumentation, which left this logic at 0% covered and over the
// CRAP<=6 gate despite recruiterRunCli.test.js proving it correct
// end-to-end.

function mkTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sfvc-recruiter-run-main-'));
}

// ── parseArgs ────────────────────────────────────────────────────────────

test('parseArgs returns all five files when every argument is present', () => {
  const args = parseArgs(['candidates.json', 'keys.json', 'trials.json', 'secrets.json', 'models.json']);

  assert.deepEqual(args, {
    candidatesFile: 'candidates.json',
    signupKeysFile: 'keys.json',
    roleTrialsFile: 'trials.json',
    secretsFile: 'secrets.json',
    currentModelsFile: 'models.json',
  });
});

test('parseArgs returns null when no arguments are given', () => {
  assert.equal(parseArgs([]), null);
});

for (const [label, index] of [
  ['candidates-file', 0],
  ['signup-keys-file', 1],
  ['role-trials-file', 2],
  ['secrets-file', 3],
  ['current-models-file', 4],
]) {
  test(`parseArgs returns null when only the ${label} is missing`, () => {
    const full = ['candidates.json', 'keys.json', 'trials.json', 'secrets.json', 'models.json'];
    full[index] = undefined;
    assert.equal(parseArgs(full), null);
  });
}

test('parseArgs returns null when extra trailing arguments leave a gap (sparse array)', () => {
  assert.equal(parseArgs(['candidates.json', 'keys.json']), null);
});

// ── readCurrentModelByRole ───────────────────────────────────────────────

test('readCurrentModelByRole returns the parsed role->model map', () => {
  const file = path.join(mkTmp(), 'current-models.json');
  fs.writeFileSync(file, JSON.stringify({ hardener: 'incumbent-model', coordinator: 'other-model' }));

  assert.deepEqual(readCurrentModelByRole(file), { hardener: 'incumbent-model', coordinator: 'other-model' });
});

test('readCurrentModelByRole returns an empty object when the file does not exist', () => {
  const file = path.join(mkTmp(), 'missing.json');

  assert.deepEqual(readCurrentModelByRole(file), {});
});

test('readCurrentModelByRole returns an empty object when the file contains JSON null', () => {
  const file = path.join(mkTmp(), 'current-models.json');
  fs.writeFileSync(file, JSON.stringify(null));

  assert.deepEqual(readCurrentModelByRole(file), {});
});

// typeof [] === 'object' in JS, so (unlike JSON null) an array is NOT
// caught by readCurrentModelByRole's `typeof parsed === 'object' &&
// parsed !== null` guard - it passes straight through unchanged. Asserting
// this (rather than assuming "non-object" also means "non-array", which
// would be a wrong assumption to bake into a test) pins the function's
// actual behavior so a future refactor can't silently change it either way
// without a test noticing.
test('readCurrentModelByRole passes an array through unchanged (not caught by the object guard)', () => {
  const file = path.join(mkTmp(), 'current-models.json');
  fs.writeFileSync(file, JSON.stringify(['not', 'an', 'object']));

  assert.deepEqual(readCurrentModelByRole(file), ['not', 'an', 'object']);
});
