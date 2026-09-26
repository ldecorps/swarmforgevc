'use strict';

// BL-1753 hardener pass, 2026-09-26: closes a Stryker NoCoverage/Survived
// gap on rotateDocumenter's `!fs.existsSync(rotate)` guard - no test
// anywhere exercised the branch where swarmforge/scripts/rotate_to_role.sh
// does not exist at all (a fixture root with no scripts tree, or a
// checkout mid-migration). Kept in its OWN file rather than added as a
// fourth test to nightClosingCeremonyRotateDocumenterFallback.test.js:
// BL-1593's own frozen acceptance gate
// (bl1593CeremonyFallbackTestTmpDirSteps.js scenario 04) asserts that
// file's `npx vitest run` output literally contains "3 passed" - a fourth
// test there would regress a closed ticket's own standing regression gate.
//
// "Never throws, writes no marker" alone does not DISCRIMINATE the guard:
// with the guard removed, rotateDocumenter would still call
// execFileSync('bash', [rotate, ...]) on a nonexistent path, bash would
// still exit nonzero, and the surrounding try/catch would still swallow
// it silently - byte-identical observable behaviour either way. So this
// intercepts `bash` itself via PATH (rotateDocumenter's own env spreads
// process.env at call time) with a stub that logs its own invocation: the
// guard existing means bash is NEVER looked up at all; removed, the stub
// fires and the log proves it.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { rotateDocumenter } = require('../out/tools/night-closing-ceremony-run');
const { mkTmpDir } = require('./helpers/tmpDir');

test('with no rotate_to_role.sh at all, rotateDocumenter never even looks up bash', () => {
  const root = mkTmpDir('ncc-rotate-missing-script-');
  // No swarmforge/scripts/ tree at all - fs.existsSync(rotate) must read false.
  const fakeBinDir = mkTmpDir('ncc-rotate-missing-script-fakebin-');
  const bashCallLog = path.join(fakeBinDir, 'bash-calls.log');
  fs.writeFileSync(bashCallLog, '');
  fs.writeFileSync(
    path.join(fakeBinDir, 'bash'),
    `#!/bin/sh\nprintf '%s\\n' "$*" >> "${bashCallLog}"\nexit 1\n`,
    { mode: 0o755 }
  );
  const originalPath = process.env.PATH;
  process.env.PATH = `${fakeBinDir}${path.delimiter}${originalPath}`;
  try {
    assert.doesNotThrow(() => rotateDocumenter(root));
  } finally {
    process.env.PATH = originalPath;
  }
  assert.equal(
    fs.readFileSync(bashCallLog, 'utf8'),
    '',
    'expected the missing-script guard to return before bash is ever looked up on PATH'
  );
  assert.ok(
    !fs.existsSync(path.join(root, '.swarmforge', 'daemon', 'consult', 'documenter.json')),
    'no consult marker is ever written'
  );
});
