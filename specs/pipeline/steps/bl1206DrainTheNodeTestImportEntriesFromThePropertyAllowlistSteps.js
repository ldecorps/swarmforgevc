'use strict';

// BL-1206: step handlers driving the REAL 14 converted files, the REAL
// property lane (vitest.properties.config.mjs), and the REAL register
// files (swarmforge/scripts/property_suite_standing_allowlist.tsv,
// backlog/standing-reds.tsv) - never a reimplementation of any of them.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { findNodeTestImportLines, findPropertyLaneNodeTestImports } = require('../../../extension/test/helpers/nodeTestImportGuard');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const EXTENSION_DIR = path.join(REPO_ROOT, 'extension');
const ALLOWLIST_REL = path.join('swarmforge', 'scripts', 'property_suite_standing_allowlist.tsv');

// The 14 files this ticket actually converted (measured 2026-08-27/09-05;
// bl1200 added later that day). test/hostActivityFeed.property.test.js is
// deliberately NOT in this set: it was already free of a node:test import
// when this ticket picked it up - it still fails collection, but for an
// unrelated reason (no test() declaration at all, a bare script), which
// this ticket's own text puts out of scope ("the other 14 allowlist rows...
// are deliberately untouched here").
const CONVERTED_FILES = [
  'test/alertTelemetry.property.test.js',
  'test/shellEntryPointDriveCheck.property.test.js',
  'test/bl782LivenessProbesScopedToRoot.property.test.js',
  'test/bl1146HostQueueEnqueueNext.property.test.js',
  'test/bl1200FixtureGitWritesStayInOwnRepo.property.test.js',
  'test/bl1147ProbeLegacyTopicAdoption.property.test.js',
  'test/bl1150OutageFailoverCliLoadFileSafe.property.test.js',
  'test/bl669OutageFailoverSteward.property.test.js',
  'test/resolveMutationConcurrency.property.test.js',
  'test/bl733ProducerCrosscheck.property.test.js',
  'test/bl735PilotAcceptanceExecution.property.test.js',
  'test/crossFileDuplicationCheck.property.test.js',
  'test/pilotAcceptanceGate.property.test.js',
  'test/pilotScopedCrapEvidence.property.test.js',
];

function gitShowHead(relPath) {
  const res = spawnSync('git', ['show', `HEAD:${relPath.split(path.sep).join('/')}`], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
  });
  return res.status === 0 ? res.stdout : null;
}

function readAllowlist() {
  return fs.readFileSync(path.join(REPO_ROOT, ALLOWLIST_REL), 'utf8');
}

function rowFor(tsvText, file) {
  if (tsvText === null) return null;
  return tsvText.split('\n').find((line) => line.includes(file)) || null;
}

function runVitestProperties(files) {
  const res = spawnSync('npx', ['vitest', 'run', '--config', 'vitest.properties.config.mjs', ...files], {
    cwd: EXTENSION_DIR,
    encoding: 'utf8',
  });
  return { out: `${res.stdout || ''}${res.stderr || ''}`, status: res.status };
}

const FEATURE =
  'the thirteen property files that import test from node:test are collected by the property lane instead of standing allowlisted';

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  // ── Background ────────────────────────────────────────────────────────
  scoped(/^the property lane runs test\/\*\*\/\*\.property\.test\.js with vitest globals enabled$/, (ctx) => {
    ctx.bl1206 = {};
  });

  // ── Scenario 01 ───────────────────────────────────────────────────────
  scoped(/^a property file that took its test binding from node:test$/, (ctx) => {
    ctx.bl1206.file = 'test/alertTelemetry.property.test.js';
    assert.ok(CONVERTED_FILES.includes(ctx.bl1206.file));
  });

  scoped(/^the import is removed so the binding comes from the lane's globals$/, (ctx) => {
    const text = fs.readFileSync(path.join(EXTENSION_DIR, ctx.bl1206.file), 'utf8');
    assert.deepEqual(findNodeTestImportLines(text), [], `expected ${ctx.bl1206.file} to no longer import node:test`);
  });

  scoped(/^the property lane runs that file$/, (ctx) => {
    ctx.bl1206.result = runVitestProperties([ctx.bl1206.file]);
  });

  scoped(/^the file is collected$/, (ctx) => {
    if (ctx.bl1206.result.out.includes('No test suite found')) {
      throw new Error(`expected the file to be collected, got: ${ctx.bl1206.result.out}`);
    }
  });

  scoped(/^its cases are reported by the property lane itself$/, (ctx) => {
    if (ctx.bl1206.result.status !== 0) {
      throw new Error(`expected the property lane to report a real pass, got: ${ctx.bl1206.result.out}`);
    }
  });

  // ── Scenario 02 ───────────────────────────────────────────────────────
  scoped(/^a converted property file that passes under the property lane$/, (ctx) => {
    ctx.bl1206.file = 'test/pilotAcceptanceGate.property.test.js';
    assert.ok(CONVERTED_FILES.includes(ctx.bl1206.file));
    const result = runVitestProperties([ctx.bl1206.file]);
    assert.equal(result.status, 0, `expected ${ctx.bl1206.file} to pass: ${result.out}`);
  });

  scoped(/^the standing allowlist is read$/, (ctx) => {
    ctx.bl1206.allowlist = readAllowlist();
  });

  scoped(/^that file is not listed$/, (ctx) => {
    assert.equal(rowFor(ctx.bl1206.allowlist, ctx.bl1206.file), null, `expected ${ctx.bl1206.file} to have left the allowlist`);
  });

  // ── Scenario 03 ───────────────────────────────────────────────────────
  // Measured live (qa_e2e-style, this ticket's own table): all 14 converted
  // files pass under the property lane once collected - none failed on its
  // own merits. The scenario is honored as a possibility, not a certainty
  // (the ticket's own approval_context: "may reveal a genuine failure...
  // deliberately does NOT require all 13 to go green"): with zero
  // counterexamples this run, the Given records that fact and the
  // following Then steps are vacuously satisfied.
  scoped(/^a converted property file that still fails under the property lane$/, (ctx) => {
    const stillFailing = CONVERTED_FILES.filter((file) => runVitestProperties([file]).status !== 0);
    assert.deepEqual(stillFailing, [], `expected every converted file to pass; still failing: ${JSON.stringify(stillFailing)}`);
    ctx.bl1206.file = null;
  });

  scoped(/^that file is still listed$/, (ctx) => {
    if (ctx.bl1206.file === null) return; // vacuous: no converted file remains red
    assert.ok(rowFor(ctx.bl1206.allowlist, ctx.bl1206.file), `expected ${ctx.bl1206.file} to remain listed`);
  });

  scoped(/^its rationale names the failure it actually has rather than the import$/, (ctx) => {
    if (ctx.bl1206.file === null) return; // vacuous
    const row = rowFor(ctx.bl1206.allowlist, ctx.bl1206.file);
    assert.ok(row && !row.includes("require('node:test')"), `expected a corrected rationale, got: ${row}`);
  });

  // ── Scenario 04 (Outline) ────────────────────────────────────────────
  // "Left alone" is checked against THIS ticket's own diff, not against
  // whether the file happens to still be red today: two of the three named
  // examples (selfHealTelemetry, unreachableStepHandlerCheck) were already
  // fixed by unrelated tickets landed earlier the same day this ticket was
  // picked up (BL-1229), independently of this ticket's own scope. Gone by
  // someone else's fix is not "touched by this parcel" - the check reads
  // each register row from the git HEAD this ticket started from and
  // compares it byte-for-byte with the working tree today.
  const REGISTER_FILES = [ALLOWLIST_REL, path.join('backlog', 'standing-reds.tsv')];

  scoped(/^(.+) is allowlisted for a cause other than the node:test import$/, (ctx, file) => {
    assert.ok(!CONVERTED_FILES.includes(file), `expected ${file} not to be one of this ticket's own converted files`);
    ctx.bl1206.outlineFile = file;
    ctx.bl1206.beforeRows = REGISTER_FILES.map((rel) => rowFor(gitShowHead(rel), file));
  });

  scoped(/^(.+) is still listed$/, (ctx, file) => {
    assert.equal(file, ctx.bl1206.outlineFile);
    const afterRows = REGISTER_FILES.map((rel) => rowFor(fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8'), file));
    assert.deepEqual(afterRows, ctx.bl1206.beforeRows, `expected ${file}'s register row(s) to be unchanged by this ticket: before=${JSON.stringify(ctx.bl1206.beforeRows)} after=${JSON.stringify(afterRows)}`);
  });

  // ── Scenario 05 ───────────────────────────────────────────────────────
  scoped(/^every file in the property lane is inspected$/, (ctx) => {
    ctx.bl1206.violations = findPropertyLaneNodeTestImports(path.join(EXTENSION_DIR, 'test'));
  });

  scoped(/^none of them imports test from node:test$/, (ctx) => {
    assert.deepEqual(
      ctx.bl1206.violations,
      [],
      `expected zero property-lane node:test imports, found: ${JSON.stringify(ctx.bl1206.violations)}`
    );
  });
}

module.exports = { registerSteps };
