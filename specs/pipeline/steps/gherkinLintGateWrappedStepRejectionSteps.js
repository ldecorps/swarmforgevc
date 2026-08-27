'use strict';

// BL-515: step handlers for "the gherkin lint gate rejects a
// silently-dropped wrapped step line". Drives the REAL
// gherkin_lint_gate.sh (which itself shells the vendored, pinned
// gherkin-parser) against fresh fixture feature files - never a
// reimplementation of the gate's own detection logic.
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { spawnSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const GATE = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'gherkin_lint_gate.sh');

const FEATURE_NAME = 'the gherkin lint gate rejects a silently-dropped wrapped step line';

const WRAPPED_STEP_FIXTURE = `Feature: fixture

  Scenario Outline: wraps
    Given a record with <telegram> Telegram
      events out of <total> total events
    When something happens
    Then it works

    Examples:
      | telegram | total |
      | 5        | 10    |
`;

const PHANTOM_COLUMN_FIXTURE = `Feature: fixture

  Scenario Outline: has an unreferenced column
    Given a value of <a>
    Then the result is checked

    Examples:
      | a | unused |
      | 1 | 2      |
`;

const CLEAN_FIXTURE = `Feature: fixture

  Scenario Outline: fully referenced
    Given a value of <a>
    When it is combined with <b>
    Then the result is <c>

    Examples:
      | a | b | c |
      | 1 | 2 | 3 |
`;

function writeFixture(ctx, contents) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bl515-gherkin-lint-gate-steps-'));
  const featurePath = path.join(dir, 'fixture.feature');
  fs.writeFileSync(featurePath, contents, 'utf8');
  ctx.featurePath = featurePath;
}

function runGate(ctx) {
  const result = spawnSync('bash', [GATE, ctx.featurePath, REPO_ROOT], { encoding: 'utf8' });
  ctx.status = result.status;
  ctx.stdout = result.stdout;
  ctx.stderr = result.stderr;
}

function registerSteps(registry) {
  // ── wrapped-step-line-rejected-01 ────────────────────────────────────
  registry.defineScoped(
    /^a feature file whose step text continues onto a second bare line$/,
    (ctx) => writeFixture(ctx, WRAPPED_STEP_FIXTURE),
    FEATURE_NAME
  );

  // ── phantom-examples-column-rejected-02 ──────────────────────────────
  registry.defineScoped(
    /^a feature file with an Examples column that no step parameter references$/,
    (ctx) => writeFixture(ctx, PHANTOM_COLUMN_FIXTURE),
    FEATURE_NAME
  );

  // ── well-formed-single-line-feature-passes-03 ────────────────────────
  registry.defineScoped(
    /^a feature file whose steps are each one line and whose Examples columns are all referenced$/,
    (ctx) => writeFixture(ctx, CLEAN_FIXTURE),
    FEATURE_NAME
  );

  registry.defineScoped(
    /^the gherkin lint gate runs on it$/,
    (ctx) => runGate(ctx),
    FEATURE_NAME
  );

  registry.defineScoped(
    /^the gate fails and names the dropped continuation line$/,
    (ctx) => {
      if (ctx.status === 0) {
        throw new Error(`expected a nonzero exit for the wrapped step; got 0. stdout: ${ctx.stdout}`);
      }
      if (!/bare continuation line/.test(ctx.stderr)) {
        throw new Error(`expected the FAIL output to name the dropped continuation line; got: ${ctx.stderr}`);
      }
      if (!ctx.stderr.includes('events out of <total> total events')) {
        throw new Error(`expected the FAIL output to quote the dropped line text; got: ${ctx.stderr}`);
      }
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^the gate fails and names the unreferenced column$/,
    (ctx) => {
      if (ctx.status === 0) {
        throw new Error(`expected a nonzero exit for the phantom Examples column; got 0. stdout: ${ctx.stdout}`);
      }
      if (!ctx.stderr.includes('"unused"')) {
        throw new Error(`expected the FAIL output to name the unreferenced column; got: ${ctx.stderr}`);
      }
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^the gate passes cleanly$/,
    (ctx) => {
      if (ctx.status !== 0) {
        throw new Error(`expected a clean feature to pass; got exit ${ctx.status}. stderr: ${ctx.stderr}`);
      }
      if (!/^OK: /.test(ctx.stdout)) {
        throw new Error(`expected an OK line; got: ${ctx.stdout}`);
      }
    },
    FEATURE_NAME
  );
}

module.exports = { registerSteps };
