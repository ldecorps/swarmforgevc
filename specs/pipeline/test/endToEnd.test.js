'use strict';

// Proves the pipeline end to end against a real feature file and a real
// step-handler module, driving the real (compiled) backlogReader.js -
// BL-112 acceptance-pipeline-01/02: generated entry points exist and
// running them exercises the host-side core without booting VS Code, and
// a failing behavior fails its acceptance run and names the scenario.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { runPipeline } = require('../runnerAdapter');

const FIXTURE_FEATURE = path.join(__dirname, 'fixtures', 'backlog-folders.feature');
const STEPS_MODULE = path.join(__dirname, '..', 'steps', 'index.js');

test('running the pipeline against a real feature file generates entry points and passes them against the real host core', async () => {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aps-e2e-'));
  try {
    const result = await runPipeline(FIXTURE_FEATURE, outDir, STEPS_MODULE);
    assert.equal(result.success, true, result.output);
    assert.match(result.output, /a ticket in backlog\/active is reported as active/);
    assert.match(result.output, /a ticket missing from every backlog folder is not reported/);
    const generated = fs.readdirSync(outDir);
    assert.deepEqual(generated, ['backlog-folders-are-read-by-folder-not-by-yaml-status-field.generated.test.js']);
  } finally {
    fs.rmSync(outDir, { recursive: true, force: true });
  }
});

test('a scenario whose real behavior does not hold fails the acceptance run and names the failing scenario', async () => {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aps-e2e-fail-'));
  const brokenFeatureDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aps-e2e-broken-feature-'));
  const brokenFeaturePath = path.join(brokenFeatureDir, 'broken.feature');
  try {
    fs.writeFileSync(
      brokenFeaturePath,
      [
        'Feature: a deliberately wrong assertion',
        '',
        'Scenario: a ticket ends up in the wrong folder on purpose',
        '  Given a target repo with a backlog item "BL-9099" filed under "active" with yaml status "todo"',
        '  When the backlog folders are read',
        '  Then "BL-9099" appears in the "paused" folder',
        '',
      ].join('\n'),
      'utf8'
    );

    const result = await runPipeline(brokenFeaturePath, outDir, STEPS_MODULE);

    assert.equal(result.success, false);
    assert.match(result.output, /a ticket ends up in the wrong folder on purpose/);
    assert.match(result.output, /BL-9099/);
  } finally {
    fs.rmSync(outDir, { recursive: true, force: true });
    fs.rmSync(brokenFeatureDir, { recursive: true, force: true });
  }
});
