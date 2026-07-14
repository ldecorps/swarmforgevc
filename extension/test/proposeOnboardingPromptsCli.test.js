const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { main, parseArgs } = require('../out/tools/propose-onboarding-prompts');
const { renderContractYaml } = require('../out/onboarding/contractView');

const CLI_PATH = path.join(__dirname, '..', 'out', 'tools', 'propose-onboarding-prompts.js');

function runCliSubprocess(args) {
  const output = execFileSync('node', [CLI_PATH, ...args], { encoding: 'utf8' });
  return JSON.parse(output);
}

// Runs the REAL main() in-process, so in-process coverage and mutation
// tooling can see the branches a subprocess-only smoke test cannot (the
// engineering article's CLI main()-thin-wrapper rule; mirrors
// notifyDeadLettersCli.test.js's own identical seam). main() takes no
// parameters - it reads process.argv itself via parseArgs (reused from
// propose-onboarding-contract.js) - so process.argv is set to the same
// shape the subprocess would have received.
async function runCli(args) {
  const previousArgv = process.argv;
  const writes = [];
  const originalWrite = process.stdout.write.bind(process.stdout);
  process.stdout.write = (chunk) => {
    writes.push(chunk);
    return true;
  };
  try {
    process.argv = ['node', CLI_PATH, ...args];
    await main();
  } finally {
    process.stdout.write = originalWrite;
    process.argv = previousArgv;
  }
  return writes.length > 0 ? JSON.parse(writes.join('')) : null;
}

function mkTmpFile(name, content) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'propose-onboarding-prompts-test-'));
  const filePath = path.join(dir, name);
  fs.writeFileSync(filePath, content);
  return filePath;
}

function mkTargetRepo() {
  const targetRepo = fs.mkdtempSync(path.join(os.tmpdir(), 'propose-onboarding-prompts-target-'));
  execFileSync('git', ['init'], { cwd: targetRepo });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: targetRepo });
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: targetRepo });
  return targetRepo;
}

function writeContract(targetRepo, agreement) {
  fs.mkdirSync(path.join(targetRepo, '.swarmforge'), { recursive: true });
  fs.writeFileSync(
    path.join(targetRepo, '.swarmforge', 'contract.yaml'),
    renderContractYaml({
      scope: ['Build the thing.'],
      outOfScope: ['Rewrite the stack.'],
      boundaries: ['Respect the README.'],
      initialBacklogSummary: '3 tickets queued.',
      agreement,
    })
  );
}

const VALID_FACTS = {
  languages: ['TypeScript'],
  layoutSummary: 'src/ + test/',
  readmeSummary: 'A CLI tool.',
  seedVision: 'Ship the MVP.',
  initialBacklogSummary: '5 tickets queued.',
  useCaseObservations: [],
};

// ── parseArgs ────────────────────────────────────────────────────────────

test('parseArgs returns both paths when given', () => {
  assert.deepEqual(parseArgs(['/target', '/survey.json']), {
    targetRepoPath: '/target',
    surveyFactsPath: '/survey.json',
  });
});

test('parseArgs returns null when no arguments are given', () => {
  assert.equal(parseArgs([]), null);
});

test('parseArgs returns null when only the survey-facts path is missing', () => {
  assert.equal(parseArgs(['/target']), null);
});

// ── the compiled CLI's own real output ────────────────────────────────────

test('withholds the generated prompts (no files written) when the contract is not yet agreed', async () => {
  const targetRepo = mkTargetRepo();
  writeContract(targetRepo, 'proposed');
  const surveyPath = mkTmpFile('survey.json', JSON.stringify(VALID_FACTS));

  const result = await runCli([targetRepo, surveyPath]);

  assert.deepEqual(result, { created: [], skipped: [], committed: false, withheld: true });
  assert.ok(!fs.existsSync(path.join(targetRepo, 'project.prompt')));
  assert.ok(!fs.existsSync(path.join(targetRepo, 'engineering.prompt')));
});

test('withholds the generated prompts when the target has no contract at all', async () => {
  const targetRepo = mkTargetRepo();
  const surveyPath = mkTmpFile('survey.json', JSON.stringify(VALID_FACTS));

  const result = await runCli([targetRepo, surveyPath]);

  assert.deepEqual(result, { created: [], skipped: [], committed: false, withheld: true });
});

test('releases and commits the generated, survey-populated prompts once the contract is agreed', async () => {
  const targetRepo = mkTargetRepo();
  writeContract(targetRepo, 'agreed');
  const surveyPath = mkTmpFile('survey.json', JSON.stringify(VALID_FACTS));

  const result = await runCli([targetRepo, surveyPath]);

  assert.deepEqual(result.created.sort(), ['engineering.prompt', 'project.prompt']);
  assert.equal(result.committed, true);
  assert.equal(result.withheld, false);

  const projectPrompt = fs.readFileSync(path.join(targetRepo, 'project.prompt'), 'utf8');
  assert.match(projectPrompt, /Ship the MVP\./);
  const engineeringPrompt = fs.readFileSync(path.join(targetRepo, 'engineering.prompt'), 'utf8');
  assert.match(engineeringPrompt, /TypeScript/);
});

test('main() prints usage and exits non-zero when a required argument is missing', async () => {
  const previousExitCode = process.exitCode;
  try {
    process.exitCode = undefined;
    const result = await runCli([]);
    assert.equal(result, null);
    assert.equal(process.exitCode, 1);
  } finally {
    process.exitCode = previousExitCode;
  }
});

// A single subprocess smoke test locks the compiled CLI's own wiring
// (require.main === module, real argv/env boundary) - an ADDITION to the
// in-process tests above, never the only cover for the real logic.
test('the compiled CLI runs standalone as a subprocess and produces the same result', () => {
  const targetRepo = mkTargetRepo();
  writeContract(targetRepo, 'agreed');
  const surveyPath = mkTmpFile('survey.json', JSON.stringify(VALID_FACTS));

  const result = runCliSubprocess([targetRepo, surveyPath]);

  assert.deepEqual(result.created.sort(), ['engineering.prompt', 'project.prompt']);
  assert.equal(result.committed, true);
  assert.equal(result.withheld, false);
});
