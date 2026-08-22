'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const SCRIPT = path.join(__dirname, '..', 'scripts', 'resolve_contract_steps.js');

function mkPipelineDir({ stepsSource } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aps-resolve-contract-'));
  fs.copyFileSync(path.join(__dirname, '..', 'stepRegistry.js'), path.join(dir, 'stepRegistry.js'));
  fs.copyFileSync(path.join(__dirname, '..', 'runtime.js'), path.join(dir, 'runtime.js'));
  fs.mkdirSync(path.join(dir, 'steps'));
  fs.writeFileSync(
    path.join(dir, 'steps', 'index.js'),
    stepsSource ||
      "'use strict';\nfunction registerSteps(registry) { registry.define(/^a known step$/, () => {}); }\nmodule.exports = { registerSteps };\n"
  );
  return dir;
}

function mkFeatureIr(feature) {
  const p = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'aps-resolve-contract-ir-')), 'ir.json');
  fs.writeFileSync(p, JSON.stringify(feature));
  return p;
}

function run(pipelineDir, irPath) {
  const out = execFileSync('node', [SCRIPT, pipelineDir, irPath], { encoding: 'utf8' });
  return JSON.parse(out);
}

test('every step of a single-scenario feature resolves -> loadable, no unresolved', () => {
  const pipelineDir = mkPipelineDir();
  const irPath = mkFeatureIr({
    name: 'f',
    background: [],
    scenarios: [{ name: 'ok', steps: [{ keyword: 'Given', text: 'a known step' }] }],
  });
  assert.deepEqual(run(pipelineDir, irPath), { loadable: true, unresolved: [] });
});

test('a step that matches no handler is reported with its scenario and null example row', () => {
  const pipelineDir = mkPipelineDir();
  const irPath = mkFeatureIr({
    name: 'f',
    background: [],
    scenarios: [{ name: 'broken', steps: [{ keyword: 'Given', text: 'an unknown step' }] }],
  });
  assert.deepEqual(run(pipelineDir, irPath), {
    loadable: true,
    unresolved: [{ scenario: 'broken', exampleIndex: null, stepText: 'an unknown step' }],
  });
});

// BL-761 invariant 2: every Scenario Outline example row is substituted and
// checked - a row after the first one that stops resolving must still be
// reported, not skipped once the first row passed.
test('a Scenario Outline row that stops resolving after substitution is reported with its row index', () => {
  const pipelineDir = mkPipelineDir({
    stepsSource:
      "'use strict';\nfunction registerSteps(registry) { registry.define(/^a widget named ok$/, () => {}); }\nmodule.exports = { registerSteps };\n",
  });
  const irPath = mkFeatureIr({
    name: 'f',
    background: [],
    scenarios: [
      {
        name: 'outline',
        steps: [{ keyword: 'Given', text: 'a widget named <name>' }],
        examples: [{ name: 'ok' }, { name: 'not-ok' }],
      },
    ],
  });
  assert.deepEqual(run(pipelineDir, irPath), {
    loadable: true,
    unresolved: [{ scenario: 'outline', exampleIndex: 1, stepText: 'a widget named not-ok' }],
  });
});

test('background steps are included for every scenario', () => {
  const pipelineDir = mkPipelineDir();
  const irPath = mkFeatureIr({
    name: 'f',
    background: [{ keyword: 'Given', text: 'an unknown background step' }],
    scenarios: [{ name: 's', steps: [{ keyword: 'Given', text: 'a known step' }] }],
  });
  assert.deepEqual(run(pipelineDir, irPath), {
    loadable: true,
    unresolved: [{ scenario: 's', exampleIndex: null, stepText: 'an unknown background step' }],
  });
});

// BL-425 feature-name scoping: a handler scoped to a DIFFERENT feature must
// not count as coverage for this one.
test('a handler scoped to a different feature does not resolve this feature\'s matching step text', () => {
  const pipelineDir = mkPipelineDir({
    stepsSource:
      "'use strict';\nfunction registerSteps(registry) { registry.defineScoped(/^shared text$/, () => {}, 'some other feature'); }\nmodule.exports = { registerSteps };\n",
  });
  const irPath = mkFeatureIr({
    name: 'this feature',
    background: [],
    scenarios: [{ name: 's', steps: [{ keyword: 'Given', text: 'shared text' }] }],
  });
  assert.deepEqual(run(pipelineDir, irPath), {
    loadable: true,
    unresolved: [{ scenario: 's', exampleIndex: null, stepText: 'shared text' }],
  });
});

test('a registry module that throws on require is reported as unloadable, not a crash', () => {
  const pipelineDir = mkPipelineDir({ stepsSource: "'use strict';\nthrow new Error('boom - simulated broken require');\n" });
  const irPath = mkFeatureIr({ name: 'f', background: [], scenarios: [] });
  const result = run(pipelineDir, irPath);
  assert.equal(result.loadable, false);
  assert.match(result.error, /boom - simulated broken require/);
});

test('a missing pipelineDir is reported as unloadable, not a crash', () => {
  const irPath = mkFeatureIr({ name: 'f', background: [], scenarios: [] });
  const result = run(path.join(os.tmpdir(), 'aps-resolve-contract-does-not-exist'), irPath);
  assert.equal(result.loadable, false);
  assert.match(result.error, /Cannot find module/);
});
