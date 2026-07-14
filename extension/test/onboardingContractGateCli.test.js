const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { parseArgs, readContractYaml, main } = require('../out/tools/onboarding-contract-gate');
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

// ── the CLI's own main(), run in-process ──────────────────────────────────

const CLI_PATH = path.join(__dirname, '..', 'out', 'tools', 'onboarding-contract-gate.js');

// Runs the REAL main() in-process (argv-injected, stdout captured), so
// in-process coverage and mutation tooling can see the branches a
// subprocess-only smoke test cannot (the engineering article's CLI
// main()-thin-wrapper rule). process.argv/process.exitCode/stdout.write
// are ALWAYS restored in `finally`, never left leaked into later tests
// (Vitest runs every test file in one worker process, so a leaked
// process.exitCode would corrupt the whole run's own exit code).
async function runCli(argv) {
  const previousArgv = process.argv;
  const previousExitCode = process.exitCode;
  const writes = [];
  const originalWrite = process.stdout.write.bind(process.stdout);
  process.stdout.write = (chunk) => {
    writes.push(chunk);
    return true;
  };
  try {
    process.argv = ['node', CLI_PATH, ...argv];
    process.exitCode = undefined;
    await main();
    const exitCode = process.exitCode;
    const raw = writes.join('');
    return { exitCode, output: raw ? JSON.parse(raw) : null };
  } finally {
    process.stdout.write = originalWrite;
    process.argv = previousArgv;
    process.exitCode = previousExitCode;
  }
}

function runCliSubprocess(argv) {
  const output = execFileSync('node', [CLI_PATH, ...argv], { encoding: 'utf8' });
  return JSON.parse(output);
}

test('prints a hold decision with a "missing" reason when the target has no contract.yaml at all', async () => {
  const targetRepo = mkTargetRepo();

  const { output } = await runCli([targetRepo]);

  assert.deepEqual(output, {
    decision: 'hold',
    reason: 'missing: no onboarding contract found for this target',
  });
});

test('sets a non-zero exit code and prints nothing when the target repo path is missing', async () => {
  const { exitCode, output } = await runCli([]);

  assert.equal(exitCode, 1);
  assert.equal(output, null);
});

// A single subprocess smoke test locks the compiled CLI's own wiring
// (require.main === module, real argv/env boundary) - an ADDITION to the
// in-process tests above, never the only cover for the real logic.
test('the compiled CLI runs standalone as a subprocess and produces the same result (allow decision for an agreed contract)', () => {
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

  const output = runCliSubprocess([targetRepo]);

  assert.deepEqual(output, { decision: 'allow' });
});
