const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { main } = require('../out/tools/bakeoff-run');

// BL-250 architect bounce (47ee1df386, "roster source has no CLI
// entrypoint"): the compiled bakeoff-run CLI wires the REAL
// createFileRosterSource (not recruiter-run.ts's createFileDiscoverySource,
// which cannot reproduce the roster's costTier attachment or its
// endpoint-type filtering) through the REAL orchestrator/secret-store/
// battery, then labels the printed report with each candidate's cost
// tier - proving "let's put Claude, Mistral and GPT models to the test"
// (the ticket's own source line) actually has a runnable command today.

const CLI = path.join(__dirname, '..', 'out', 'tools', 'bakeoff-run.js');

function mkTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sfvc-bakeoff-run-'));
}

function chatEntry(overrides = {}) {
  return {
    provider: 'anthropic',
    model: 'claude-fable-5',
    planCost: { amountUsd: 0, unit: 'free' },
    signupPath: { url: 'https://console.anthropic.com', automation: 'automatable' },
    endpointType: 'chat',
    costTier: 'free/eval-tier',
    ...overrides,
  };
}

function runCliSubprocess(cwd, args) {
  return execFileSync('node', [CLI, ...args], { encoding: 'utf8', cwd });
}

// Runs the REAL main() in-process against real fixture files, so
// in-process coverage and mutation tooling can see the branches a
// subprocess-only smoke test cannot (the CLI main()-thin-wrapper rule;
// mirrors notifyDeadLettersCli.test.js's own identical seam). main() is
// makeArgsGuardedMain(...), which reads its args from
// process.argv.slice(2) and prints JSON via printJsonToStdout
// (process.stdout.write) on success, or writes a usage message to stderr
// and sets process.exitCode = 1 (never throws) when args are missing -
// process.exitCode is captured and restored too, since a stray 1 would
// otherwise leak into every later test in this single worker process
// (BL-363 scenario 05).
async function runCli(cwd, args) {
  const originalCwd = process.cwd;
  const previousArgv = process.argv;
  const previousExitCode = process.exitCode;
  const writes = [];
  const originalWrite = process.stdout.write.bind(process.stdout);
  process.stdout.write = (chunk) => {
    writes.push(chunk);
    return true;
  };
  process.exitCode = undefined;
  try {
    process.argv = ['node', CLI, ...args];
    process.cwd = () => cwd;
    await main();
    return { stdout: writes.join(''), exitCode: process.exitCode };
  } finally {
    process.stdout.write = originalWrite;
    process.cwd = originalCwd;
    process.argv = previousArgv;
    process.exitCode = previousExitCode;
  }
}

function buildBakeoffFixture(catalogEntries) {
  const fixturesDir = mkTmp();
  const secretsFile = path.join(mkTmp(), 'secrets.json');
  const workDir = mkTmp();

  const catalogFile = path.join(fixturesDir, 'catalog.json');
  fs.writeFileSync(catalogFile, JSON.stringify(catalogEntries));

  const signupKeysFile = path.join(fixturesDir, 'signup-keys.json');
  const roleTrialsFile = path.join(fixturesDir, 'role-trials.json');
  const currentModelsFile = path.join(fixturesDir, 'current-models.json');

  return { fixturesDir, secretsFile, workDir, catalogFile, signupKeysFile, roleTrialsFile, currentModelsFile };
}

test('the compiled CLI runs the roster through the real pipeline and labels the report by cost tier', async () => {
  const { secretsFile, workDir, catalogFile, signupKeysFile, roleTrialsFile, currentModelsFile } = buildBakeoffFixture([
    chatEntry({ provider: 'anthropic', model: 'claude-fable-5', costTier: 'free/eval-tier', planCost: { amountUsd: 0, unit: 'free' } }),
    // Non-chat, present in the catalog but must never reach the roster or the report.
    chatEntry({ provider: 'anthropic', model: 'claude-embed', endpointType: 'embeddings' }),
  ]);
  fs.writeFileSync(signupKeysFile, JSON.stringify({ 'claude-fable-5': 'sk-live-test-only' }));
  fs.writeFileSync(roleTrialsFile, JSON.stringify({ 'claude-fable-5': { hardener: ['2', '1.0', '0'] } }));
  fs.writeFileSync(currentModelsFile, JSON.stringify({ hardener: 'incumbent-model' }));

  const { stdout } = await runCli(workDir, [catalogFile, signupKeysFile, roleTrialsFile, secretsFile, currentModelsFile]);

  const report = JSON.parse(stdout);
  assert.equal(report.escalated.length, 0);
  assert.equal(report.roles.length, 1);
  const hardenerRole = report.roles.find((r) => r.role === 'hardener');
  assert.ok(hardenerRole, 'expected a "hardener" role report');
  assert.equal(hardenerRole.leaderboard.ranked[0].model, 'claude-fable-5');
  assert.equal(hardenerRole.leaderboard.ranked[0].costTier, 'free/eval-tier', 'the ranked entry must carry its cost tier');
  assert.equal(hardenerRole.suggestion.suggestedModel, 'claude-fable-5');

  const storedSecrets = JSON.parse(fs.readFileSync(secretsFile, 'utf8'));
  assert.equal(storedSecrets['anthropic:claude-fable-5'], 'sk-live-test-only');
});

test('a paid-only, wall-blocked candidate is escalated and still labeled by cost tier', async () => {
  const { secretsFile, workDir, catalogFile, signupKeysFile, roleTrialsFile, currentModelsFile } = buildBakeoffFixture([
    chatEntry({
      provider: 'openai',
      model: 'gpt-5-paid',
      costTier: 'paid-only',
      planCost: { amountUsd: 20, unit: 'monthly' },
      signupPath: { url: 'https://openai.example', automation: 'payment-wall' },
    }),
  ]);
  fs.writeFileSync(signupKeysFile, JSON.stringify({}));
  fs.writeFileSync(roleTrialsFile, JSON.stringify({}));
  fs.writeFileSync(currentModelsFile, JSON.stringify({}));

  const { stdout } = await runCli(workDir, [catalogFile, signupKeysFile, roleTrialsFile, secretsFile, currentModelsFile]);

  const report = JSON.parse(stdout);
  assert.equal(report.roles.length, 0);
  assert.equal(report.escalated.length, 1);
  assert.equal(report.escalated[0].model, 'gpt-5-paid');
  assert.equal(report.escalated[0].wall, 'payment-wall');
  assert.equal(report.escalated[0].costTier, 'paid-only');
  assert.equal(fs.existsSync(secretsFile), false, 'no key was ever acquired for a walled candidate');
});

test('the CLI exits non-zero with a usage message when arguments are missing', async () => {
  const { exitCode } = await runCli(mkTmp(), []);
  assert.equal(exitCode, 1);
});

// A single subprocess smoke test locks the compiled CLI's own wiring
// (require.main === module, real argv/cwd boundary) - an ADDITION to the
// in-process tests above, never the only cover for the real logic.
test('the compiled CLI runs standalone as a subprocess and produces the same result', () => {
  const { secretsFile, workDir, catalogFile, signupKeysFile, roleTrialsFile, currentModelsFile } = buildBakeoffFixture([
    chatEntry({ provider: 'anthropic', model: 'claude-fable-5', costTier: 'free/eval-tier', planCost: { amountUsd: 0, unit: 'free' } }),
    chatEntry({ provider: 'anthropic', model: 'claude-embed', endpointType: 'embeddings' }),
  ]);
  fs.writeFileSync(signupKeysFile, JSON.stringify({ 'claude-fable-5': 'sk-live-test-only' }));
  fs.writeFileSync(roleTrialsFile, JSON.stringify({ 'claude-fable-5': { hardener: ['2', '1.0', '0'] } }));
  fs.writeFileSync(currentModelsFile, JSON.stringify({ hardener: 'incumbent-model' }));

  const output = runCliSubprocess(workDir, [catalogFile, signupKeysFile, roleTrialsFile, secretsFile, currentModelsFile]);

  const report = JSON.parse(output);
  assert.equal(report.escalated.length, 0);
  assert.equal(report.roles.length, 1);
  const hardenerRole = report.roles.find((r) => r.role === 'hardener');
  assert.ok(hardenerRole, 'expected a "hardener" role report');
  assert.equal(hardenerRole.leaderboard.ranked[0].model, 'claude-fable-5');
});
