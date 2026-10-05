'use strict';

// BL-1944 (BL-111 stamp-off): step handlers for "backlog Gherkin becomes
// durable feature files with a lint gate". Drives the REAL
// migrate_gherkin_to_features_lib.bb (migration) and gherkin_lint_gate.sh
// (lint gate) against fixtures built under a tracked mkdtemp root - never
// this checkout's own backlog/git/.swarmforge (BL-1390). The lint gate
// needs the REAL repo's vendored APS tools to parse anything at all, so
// it is invoked with THIS repo as its [repo-root] argument while the
// feature file under test lives entirely in the fixture root - the gate
// only READS swarmforge/vendor/aps/ here, it writes nothing into this
// checkout.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const { trackedTmpRoot } = require('./lib/fixtureReaper');

const FEATURE = 'backlog Gherkin becomes durable feature files with a lint gate';

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const MIGRATE_LIB = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'migrate_gherkin_to_features_lib.bb');
const LINT_GATE_SH = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'gherkin_lint_gate.sh');

function mkdirp(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function writeBacklogYaml(root, folder, id, featureBlock) {
  mkdirp(path.join(root, 'backlog', folder));
  const body = [
    `id: ${id}`,
    `title: "fixture ${id}"`,
    'status: todo',
    'acceptance: |',
    ...featureBlock.split('\n').map((l) => (l ? `  ${l}` : '')),
    '',
  ].join('\n');
  fs.writeFileSync(path.join(root, 'backlog', folder, `${id}.yaml`), body);
}

function fixtureFeatureBlock(name) {
  return `Feature: ${name}\n  Scenario: a trivial scenario\n    Given nothing\n    When nothing happens\n    Then it passes`;
}

function runMigration(root) {
  const res = spawnSync(
    'bb',
    ['-e', `(load-file ${JSON.stringify(MIGRATE_LIB)}) (migrate-gherkin-to-features-lib/run-migration! ${JSON.stringify(root)})`],
    { encoding: 'utf8', timeout: 60000 }
  );
  assert.equal(res.status, 0, `migration run failed: ${res.stderr}`);
  return res.stdout;
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  // ── Scenario 01 ──────────────────────────────────────────────────────
  scoped(/^the backlog items in active\/ and paused\/ at migration time$/, (ctx) => {
    const root = trackedTmpRoot('sfvc-bl111-migrate-');
    writeBacklogYaml(root, 'active', 'BL-9001', fixtureFeatureBlock('fixture active ticket'));
    writeBacklogYaml(root, 'paused', 'BL-9002', fixtureFeatureBlock('fixture paused ticket'));
    writeBacklogYaml(root, 'done', 'BL-9003', fixtureFeatureBlock('fixture done ticket'));
    ctx.bl111 = {
      root,
      doneYamlBefore: fs.readFileSync(path.join(root, 'backlog', 'done', 'BL-9003.yaml'), 'utf8'),
    };
  });

  scoped(/^the migration completes$/, (ctx) => {
    runMigration(ctx.bl111.root);
  });

  scoped(/^each item's scenarios exist in specs\/features\/ with APS naming$/, (ctx) => {
    for (const id of ['BL-9001', 'BL-9002']) {
      const featurePath = path.join(ctx.bl111.root, 'specs', 'features', `${id}.feature`);
      assert.ok(fs.existsSync(featurePath), `expected a migrated feature file at ${featurePath}`);
      const text = fs.readFileSync(featurePath, 'utf8');
      assert.match(text, /^Feature:/, `expected ${featurePath} to start with a Feature: line, got: ${text.slice(0, 40)}`);
    }
  });

  scoped(/^each item's YAML acceptance field references its feature file\(s\)$/, (ctx) => {
    for (const [folder, id] of [['active', 'BL-9001'], ['paused', 'BL-9002']]) {
      const yamlText = fs.readFileSync(path.join(ctx.bl111.root, 'backlog', folder, `${id}.yaml`), 'utf8');
      assert.match(
        yamlText,
        new RegExp(`^acceptance: specs/features/${id}\\.feature$`, 'm'),
        `expected ${id}.yaml to reference its migrated feature file, got:\n${yamlText}`
      );
    }
  });

  scoped(/^no done\/ item was migrated$/, (ctx) => {
    const doneYamlAfter = fs.readFileSync(path.join(ctx.bl111.root, 'backlog', 'done', 'BL-9003.yaml'), 'utf8');
    assert.equal(doneYamlAfter, ctx.bl111.doneYamlBefore, 'a done/ item\'s YAML must be byte-for-byte unchanged');
    const doneFeaturePath = path.join(ctx.bl111.root, 'specs', 'features', 'BL-9003.feature');
    assert.ok(!fs.existsSync(doneFeaturePath), `a done/ item must never get a migrated feature file, found: ${doneFeaturePath}`);
  });

  // ── Scenarios 03/04 ──────────────────────────────────────────────────
  scoped(/^a feature file that gherkin-parser cannot parse$/, (ctx) => {
    const root = trackedTmpRoot('sfvc-bl111-lint-');
    const featurePath = path.join(root, 'malformed.feature');
    fs.writeFileSync(featurePath, 'this is not a feature file at all\nScenario with no Feature: header\n');
    ctx.bl111 = { featurePath };
  });

  scoped(/^a feature file that parses cleanly$/, (ctx) => {
    const root = trackedTmpRoot('sfvc-bl111-lint-');
    const featurePath = path.join(root, 'wellformed.feature');
    fs.writeFileSync(featurePath, `${fixtureFeatureBlock('a well-formed fixture')}\n`);
    ctx.bl111 = { featurePath };
  });

  scoped(/^the lint gate script runs against it$/, (ctx) => {
    const res = spawnSync('bash', [LINT_GATE_SH, ctx.bl111.featurePath, REPO_ROOT], { encoding: 'utf8', timeout: 60000 });
    ctx.bl111.result = res;
  });

  scoped(/^the gate exits nonzero and reports the parse error$/, (ctx) => {
    const { status, stdout, stderr } = ctx.bl111.result;
    assert.notEqual(status, 0, 'expected a nonzero exit for a malformed feature file');
    assert.match(`${stdout}${stderr}`, /FAIL/, `expected a FAIL report, got stdout=${stdout} stderr=${stderr}`);
  });

  scoped(/^the gate exits zero$/, (ctx) => {
    const { status, stdout, stderr } = ctx.bl111.result;
    assert.equal(status, 0, `expected a zero exit for a well-formed feature file, got stdout=${stdout} stderr=${stderr}`);
  });
}

module.exports = { registerSteps };
