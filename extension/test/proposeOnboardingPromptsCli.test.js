const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { parseArgs } = require('../out/tools/propose-onboarding-prompts');
const { renderContractYaml } = require('../out/onboarding/contractView');

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

const CLI_PATH = path.join(__dirname, '..', 'out', 'tools', 'propose-onboarding-prompts.js');

test('withholds the generated prompts (no files written) when the contract is not yet agreed', () => {
  const targetRepo = mkTargetRepo();
  writeContract(targetRepo, 'proposed');
  const surveyPath = mkTmpFile('survey.json', JSON.stringify(VALID_FACTS));

  const output = execFileSync('node', [CLI_PATH, targetRepo, surveyPath], { encoding: 'utf8' });
  const result = JSON.parse(output);

  assert.deepEqual(result, { created: [], skipped: [], committed: false, withheld: true });
  assert.ok(!fs.existsSync(path.join(targetRepo, 'project.prompt')));
  assert.ok(!fs.existsSync(path.join(targetRepo, 'engineering.prompt')));
});

test('withholds the generated prompts when the target has no contract at all', () => {
  const targetRepo = mkTargetRepo();
  const surveyPath = mkTmpFile('survey.json', JSON.stringify(VALID_FACTS));

  const output = execFileSync('node', [CLI_PATH, targetRepo, surveyPath], { encoding: 'utf8' });

  assert.deepEqual(JSON.parse(output), { created: [], skipped: [], committed: false, withheld: true });
});

test('releases and commits the generated, survey-populated prompts once the contract is agreed', () => {
  const targetRepo = mkTargetRepo();
  writeContract(targetRepo, 'agreed');
  const surveyPath = mkTmpFile('survey.json', JSON.stringify(VALID_FACTS));

  const output = execFileSync('node', [CLI_PATH, targetRepo, surveyPath], { encoding: 'utf8' });
  const result = JSON.parse(output);

  assert.deepEqual(result.created.sort(), ['engineering.prompt', 'project.prompt']);
  assert.equal(result.committed, true);
  assert.equal(result.withheld, false);

  const projectPrompt = fs.readFileSync(path.join(targetRepo, 'project.prompt'), 'utf8');
  assert.match(projectPrompt, /Ship the MVP\./);
  const engineeringPrompt = fs.readFileSync(path.join(targetRepo, 'engineering.prompt'), 'utf8');
  assert.match(engineeringPrompt, /TypeScript/);
});

test('the compiled CLI prints usage and exits non-zero when a required argument is missing', () => {
  assert.throws(() => execFileSync('node', [CLI_PATH], { encoding: 'utf8' }));
});
