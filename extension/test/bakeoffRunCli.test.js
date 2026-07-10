const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

// BL-250 architect bounce (47ee1df386, "roster source has no CLI
// entrypoint"): the compiled bakeoff-run CLI wires the REAL
// createFileRosterSource (not recruiter-run.ts's createFileDiscoverySource,
// which cannot reproduce the roster's costTier attachment or its
// endpoint-type filtering) through the REAL orchestrator/secret-store/
// battery, then labels the printed report with each candidate's cost
// tier - proving "let's put Claude, Mistral and GPT models to the test"
// (the ticket's own source line) actually has a runnable command today.

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

test('the compiled CLI runs the roster through the real pipeline and labels the report by cost tier', () => {
  const fixturesDir = mkTmp();
  const secretsFile = path.join(mkTmp(), 'secrets.json');
  const workDir = mkTmp();

  const catalogFile = path.join(fixturesDir, 'catalog.json');
  fs.writeFileSync(
    catalogFile,
    JSON.stringify([
      chatEntry({ provider: 'anthropic', model: 'claude-fable-5', costTier: 'free/eval-tier', planCost: { amountUsd: 0, unit: 'free' } }),
      // Non-chat, present in the catalog but must never reach the roster or the report.
      chatEntry({ provider: 'anthropic', model: 'claude-embed', endpointType: 'embeddings' }),
    ])
  );

  const signupKeysFile = path.join(fixturesDir, 'signup-keys.json');
  fs.writeFileSync(signupKeysFile, JSON.stringify({ 'claude-fable-5': 'sk-live-test-only' }));

  const roleTrialsFile = path.join(fixturesDir, 'role-trials.json');
  fs.writeFileSync(roleTrialsFile, JSON.stringify({ 'claude-fable-5': { hardener: ['2', '1.0', '0'] } }));

  const currentModelsFile = path.join(fixturesDir, 'current-models.json');
  fs.writeFileSync(currentModelsFile, JSON.stringify({ hardener: 'incumbent-model' }));

  const cliPath = path.join(__dirname, '..', 'out', 'tools', 'bakeoff-run.js');
  const output = execFileSync(
    'node',
    [cliPath, catalogFile, signupKeysFile, roleTrialsFile, secretsFile, currentModelsFile],
    { encoding: 'utf8', cwd: workDir }
  );

  const report = JSON.parse(output);
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

test('a paid-only, wall-blocked candidate is escalated and still labeled by cost tier', () => {
  const fixturesDir = mkTmp();
  const secretsFile = path.join(mkTmp(), 'secrets.json');
  const workDir = mkTmp();

  const catalogFile = path.join(fixturesDir, 'catalog.json');
  fs.writeFileSync(
    catalogFile,
    JSON.stringify([
      chatEntry({
        provider: 'openai',
        model: 'gpt-5-paid',
        costTier: 'paid-only',
        planCost: { amountUsd: 20, unit: 'monthly' },
        signupPath: { url: 'https://openai.example', automation: 'payment-wall' },
      }),
    ])
  );
  const signupKeysFile = path.join(fixturesDir, 'signup-keys.json');
  fs.writeFileSync(signupKeysFile, JSON.stringify({}));
  const roleTrialsFile = path.join(fixturesDir, 'role-trials.json');
  fs.writeFileSync(roleTrialsFile, JSON.stringify({}));
  const currentModelsFile = path.join(fixturesDir, 'current-models.json');
  fs.writeFileSync(currentModelsFile, JSON.stringify({}));

  const cliPath = path.join(__dirname, '..', 'out', 'tools', 'bakeoff-run.js');
  const output = execFileSync(
    'node',
    [cliPath, catalogFile, signupKeysFile, roleTrialsFile, secretsFile, currentModelsFile],
    { encoding: 'utf8', cwd: workDir }
  );

  const report = JSON.parse(output);
  assert.equal(report.roles.length, 0);
  assert.equal(report.escalated.length, 1);
  assert.equal(report.escalated[0].model, 'gpt-5-paid');
  assert.equal(report.escalated[0].wall, 'payment-wall');
  assert.equal(report.escalated[0].costTier, 'paid-only');
  assert.equal(fs.existsSync(secretsFile), false, 'no key was ever acquired for a walled candidate');
});

test('the CLI exits non-zero with a usage message when arguments are missing', () => {
  const cliPath = path.join(__dirname, '..', 'out', 'tools', 'bakeoff-run.js');
  assert.throws(() => execFileSync('node', [cliPath], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }));
});
