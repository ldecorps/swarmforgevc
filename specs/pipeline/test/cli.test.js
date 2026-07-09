'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const CLI = path.join(__dirname, '..', 'cli.js');
const FIXTURE_FEATURE = path.join(__dirname, 'fixtures', 'backlog-folders.feature');
const STEPS_MODULE = path.join(__dirname, '..', 'steps', 'index.js');

test('cli.js exits 0 and prints the TAP output for a passing feature file', () => {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aps-cli-'));
  try {
    const result = spawnSync(process.execPath, [CLI, FIXTURE_FEATURE, outDir, STEPS_MODULE], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /a ticket in backlog\/active is reported as active/);
  } finally {
    fs.rmSync(outDir, { recursive: true, force: true });
  }
});

test('cli.js exits nonzero with usage guidance when no feature file is given', () => {
  const result = spawnSync(process.execPath, [CLI], { encoding: 'utf8' });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /usage:/);
});
