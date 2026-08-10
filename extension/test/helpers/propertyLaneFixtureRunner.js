'use strict';

// BL-868: proving the property lane's isolation guards actually intervene
// requires running a REAL test file through the REAL vitest.properties.config.mjs
// - reimplementing what tmpDirSetup.js/envRestoreGuardSetup.js do against a
// mocked runner would only prove the mock agrees with itself. Vitest's
// `include` glob (test/**/*.property.test.js) is resolved relative to the
// config's root (extension/), so a fixture file must briefly exist under
// extension/test/ to be picked up at all - this is the same "temporarily add
// a property test... remove the probe afterwards" procedure BL-868's own
// qa_e2e_procedure describes for manual verification, done here generatively
// and cleaned up unconditionally.
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const EXTENSION_DIR = path.join(__dirname, '..', '..');
const TEST_DIR = path.join(EXTENSION_DIR, 'test');

function runAsPropertyLaneFixture(source, { basenamePrefix = 'bl868-fixture-', timeout = 30000, env } = {}) {
  const filename = `${basenamePrefix}${process.pid}-${Math.random().toString(36).slice(2)}.property.test.js`;
  const filePath = path.join(TEST_DIR, filename);
  fs.writeFileSync(filePath, source);
  try {
    const result = spawnSync('npx', ['vitest', 'run', '--config', 'vitest.properties.config.mjs', `test/${filename}`], {
      cwd: EXTENSION_DIR,
      encoding: 'utf8',
      timeout,
      env: env || process.env,
    });
    return { status: result.status, output: `${result.stdout || ''}${result.stderr || ''}` };
  } finally {
    fs.rmSync(filePath, { force: true });
  }
}

module.exports = { runAsPropertyLaneFixture };
