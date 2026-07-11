const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { parseArgs, readContractYaml } = require('../out/tools/onboarding-contract-gate');
const { renderContractYaml } = require('../out/onboarding/contractView');

function mkTargetRepo() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'onboarding-contract-gate-test-'));
}

// ── parseArgs ────────────────────────────────────────────────────────────

test('parseArgs returns the target repo path when given', () => {
  assert.deepEqual(parseArgs(['/some/target']), { targetRepoPath: '/some/target' });
});

test('parseArgs returns null when no argument is given', () => {
  assert.equal(parseArgs([]), null);
});

// ── readContractYaml ─────────────────────────────────────────────────────

test('readContractYaml returns the file contents when contract.yaml exists', () => {
  const targetRepo = mkTargetRepo();
  fs.mkdirSync(path.join(targetRepo, '.swarmforge'), { recursive: true });
  fs.writeFileSync(path.join(targetRepo, '.swarmforge', 'contract.yaml'), 'agreement: agreed\n');

  assert.equal(readContractYaml(targetRepo), 'agreement: agreed\n');
});

test('readContractYaml returns undefined when contract.yaml is absent, rather than throwing', () => {
  const targetRepo = mkTargetRepo();

  assert.equal(readContractYaml(targetRepo), undefined);
});

// ── the compiled CLI's own real output ────────────────────────────────────

const CLI_PATH = path.join(__dirname, '..', 'out', 'tools', 'onboarding-contract-gate.js');

test('prints a hold decision with a "missing" reason when the target has no contract.yaml at all', () => {
  const targetRepo = mkTargetRepo();

  const output = execFileSync('node', [CLI_PATH, targetRepo], { encoding: 'utf8' });

  assert.deepEqual(JSON.parse(output), {
    decision: 'hold',
    reason: 'missing: no onboarding contract found for this target',
  });
});

test('prints an allow decision for an agreed contract', () => {
  const targetRepo = mkTargetRepo();
  fs.mkdirSync(path.join(targetRepo, '.swarmforge'), { recursive: true });
  fs.writeFileSync(
    path.join(targetRepo, '.swarmforge', 'contract.yaml'),
    renderContractYaml({
      scope: ['Build the thing.'],
      outOfScope: ['Rewrite the stack.'],
      boundaries: ['Respect the README.'],
      initialBacklogSummary: '3 tickets queued.',
      agreement: 'agreed',
    })
  );

  const output = execFileSync('node', [CLI_PATH, targetRepo], { encoding: 'utf8' });

  assert.deepEqual(JSON.parse(output), { decision: 'allow' });
});

test('prints usage and exits non-zero when the target repo path is missing', () => {
  assert.throws(() => execFileSync('node', [CLI_PATH], { encoding: 'utf8' }));
});
