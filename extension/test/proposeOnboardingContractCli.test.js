const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { parseArgs, readSurveyFacts } = require('../out/tools/propose-onboarding-contract');
const { parseContractYaml } = require('../out/onboarding/contractView');

function mkTmpFile(name, content) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'propose-onboarding-contract-test-'));
  const filePath = path.join(dir, name);
  fs.writeFileSync(filePath, content);
  return filePath;
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

// ── readSurveyFacts ────────────────────────────────────────────────────────

test('readSurveyFacts reads and returns well-shaped survey facts', () => {
  const filePath = mkTmpFile('survey.json', JSON.stringify(VALID_FACTS));

  assert.deepEqual(readSurveyFacts(filePath), VALID_FACTS);
});

test('readSurveyFacts throws when languages is not a string array', () => {
  const filePath = mkTmpFile('survey.json', JSON.stringify({ ...VALID_FACTS, languages: 'TypeScript' }));

  assert.throws(() => readSurveyFacts(filePath), /does not match RepoSurveyFacts/);
});

test('readSurveyFacts throws when a required string field is missing', () => {
  const { seedVision, ...withoutSeedVision } = VALID_FACTS;
  const filePath = mkTmpFile('survey.json', JSON.stringify(withoutSeedVision));

  assert.throws(() => readSurveyFacts(filePath), /does not match RepoSurveyFacts/);
});

test('readSurveyFacts throws when the JSON is an array, not an object', () => {
  const filePath = mkTmpFile('survey.json', JSON.stringify(['not', 'an', 'object']));

  assert.throws(() => readSurveyFacts(filePath), /does not match RepoSurveyFacts/);
});

// ── the compiled CLI's own real output ────────────────────────────────────

const CLI_PATH = path.join(__dirname, '..', 'out', 'tools', 'propose-onboarding-contract.js');

test('the compiled CLI scaffolds a proposed contract from survey facts into a fresh target', () => {
  const targetRepo = fs.mkdtempSync(path.join(os.tmpdir(), 'propose-onboarding-contract-target-'));
  execFileSync('git', ['init'], { cwd: targetRepo });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: targetRepo });
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: targetRepo });
  const surveyPath = mkTmpFile('survey.json', JSON.stringify(VALID_FACTS));

  const output = execFileSync('node', [CLI_PATH, targetRepo, surveyPath], { encoding: 'utf8' });
  const result = JSON.parse(output);

  assert.deepEqual(result.created.sort(), [path.join('.swarmforge', 'contract.yaml'), 'CONTRACT.md'].sort());
  assert.equal(result.committed, true);

  const contract = parseContractYaml(fs.readFileSync(path.join(targetRepo, '.swarmforge', 'contract.yaml'), 'utf8'));
  assert.equal(contract.agreement, 'proposed');
  assert.match(contract.scope.join(' '), /Ship the MVP\./);
});

test('the compiled CLI prints usage and exits non-zero when a required argument is missing', () => {
  assert.throws(() => execFileSync('node', [CLI_PATH], { encoding: 'utf8' }));
});
