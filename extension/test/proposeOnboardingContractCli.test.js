const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { main, parseArgs, readSurveyFacts } = require('../out/tools/propose-onboarding-contract');
const { parseContractYaml } = require('../out/onboarding/contractView');

const CLI_PATH = path.join(__dirname, '..', 'out', 'tools', 'propose-onboarding-contract.js');

function runCliSubprocess(args) {
  const output = execFileSync('node', [CLI_PATH, ...args], { encoding: 'utf8' });
  return JSON.parse(output);
}

// Runs the REAL main() in-process, so in-process coverage and mutation
// tooling can see the branches a subprocess-only smoke test cannot (the
// engineering article's CLI main()-thin-wrapper rule; mirrors
// notifyDeadLettersCli.test.js's own identical seam). main() takes no
// parameters - it reads process.argv itself via parseArgs - so process.argv
// is set to the same shape the subprocess would have received.
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
  useCaseObservations: [
    { name: 'CLI argument parsing', summary: 'Parses flags from argv.', locations: ['src/cli.ts'] },
  ],
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

test('readSurveyFacts throws when useCaseObservations is missing', () => {
  const { useCaseObservations, ...withoutObservations } = VALID_FACTS;
  const filePath = mkTmpFile('survey.json', JSON.stringify(withoutObservations));

  assert.throws(() => readSurveyFacts(filePath), /does not match RepoSurveyFacts/);
});

test('readSurveyFacts throws when a useCaseObservations entry is malformed', () => {
  const filePath = mkTmpFile(
    'survey.json',
    JSON.stringify({ ...VALID_FACTS, useCaseObservations: [{ name: 'missing summary and locations' }] })
  );

  assert.throws(() => readSurveyFacts(filePath), /does not match RepoSurveyFacts/);
});

test('readSurveyFacts accepts an empty useCaseObservations array (a legitimate outcome, not malformed)', () => {
  const filePath = mkTmpFile('survey.json', JSON.stringify({ ...VALID_FACTS, useCaseObservations: [] }));

  assert.deepEqual(readSurveyFacts(filePath), { ...VALID_FACTS, useCaseObservations: [] });
});

// ── the compiled CLI's own real output ────────────────────────────────────

test('the compiled CLI scaffolds a proposed contract from survey facts into a fresh target', async () => {
  const targetRepo = fs.mkdtempSync(path.join(os.tmpdir(), 'propose-onboarding-contract-target-'));
  execFileSync('git', ['init'], { cwd: targetRepo });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: targetRepo });
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: targetRepo });
  const surveyPath = mkTmpFile('survey.json', JSON.stringify(VALID_FACTS));

  const result = await runCli([targetRepo, surveyPath]);

  assert.deepEqual(
    result.created.sort(),
    [path.join('.swarmforge', 'contract.yaml'), 'CONTRACT.md', 'USE-CASES.md'].sort()
  );
  assert.equal(result.committed, true);

  const contract = parseContractYaml(fs.readFileSync(path.join(targetRepo, '.swarmforge', 'contract.yaml'), 'utf8'));
  assert.equal(contract.agreement, 'proposed');
  assert.match(contract.scope.join(' '), /Ship the MVP\./);

  // BL-360: the inventory is delivered ungated, alongside the contract,
  // while agreement is still "proposed" - never withheld the way the
  // generated prompts are.
  const inventoryMarkdown = fs.readFileSync(path.join(targetRepo, 'USE-CASES.md'), 'utf8');
  assert.match(inventoryMarkdown, /CLI argument parsing/);
  assert.match(inventoryMarkdown, /src\/cli\.ts/);
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
  const targetRepo = fs.mkdtempSync(path.join(os.tmpdir(), 'propose-onboarding-contract-target-'));
  execFileSync('git', ['init'], { cwd: targetRepo });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: targetRepo });
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: targetRepo });
  const surveyPath = mkTmpFile('survey.json', JSON.stringify(VALID_FACTS));

  const result = runCliSubprocess([targetRepo, surveyPath]);

  assert.deepEqual(
    result.created.sort(),
    [path.join('.swarmforge', 'contract.yaml'), 'CONTRACT.md', 'USE-CASES.md'].sort()
  );
  assert.equal(result.committed, true);
});

