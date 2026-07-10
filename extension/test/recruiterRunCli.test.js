const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

// BL-233 QA bounce (ddc0d351ed): the compiled recruiter-run CLI is a thin
// presenter over orchestrator.ts, wired with the REAL discovery/secret-
// store/battery implementations (only signup keys and role trials are
// operator-maintained-file stand-ins, per signupSource.ts/
// roleTrialRunner.ts's own established posture) - proves the ticket's own
// "operator runs ONE thing and gets a per-role report" deliverable
// actually exists and actually runs end-to-end, not just its pieces.

function mkTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sfvc-recruiter-run-'));
}

test('the compiled CLI discovers, acquires, qualifies, ranks, and prints a per-role report to stdout', () => {
  const fixturesDir = mkTmp();
  // A SEPARATE tmpdir, outside the child process's cwd below - satisfies
  // createFileSecretStore's own "outside the target working directory"
  // guard (see [[bl233-recruiter-secretstore-path-unenforced]]).
  const secretsFile = path.join(mkTmp(), 'secrets.json');
  // Stands in for "the target working directory" the CLI is invoked from -
  // the secrets file above must never land inside it.
  const workDir = mkTmp();

  const candidatesFile = path.join(fixturesDir, 'candidates.json');
  fs.writeFileSync(
    candidatesFile,
    JSON.stringify([
      {
        model: 'free-model-mini',
        provider: 'acme-ai',
        planCost: { amountUsd: 0, unit: 'free' },
        signupPath: { url: 'https://acme.example/signup', automation: 'automatable' },
      },
    ])
  );

  const signupKeysFile = path.join(fixturesDir, 'signup-keys.json');
  fs.writeFileSync(signupKeysFile, JSON.stringify({ 'free-model-mini': 'sk-live-test-only' }));

  const roleTrialsFile = path.join(fixturesDir, 'role-trials.json');
  fs.writeFileSync(
    roleTrialsFile,
    JSON.stringify({ 'free-model-mini': { hardener: ['2', '1.0', '0'], coordinator: ['1', '3', 'true'] } })
  );

  const currentModelsFile = path.join(fixturesDir, 'current-models.json');
  fs.writeFileSync(currentModelsFile, JSON.stringify({ hardener: 'incumbent-model', coordinator: 'incumbent-model' }));

  const cliPath = path.join(__dirname, '..', 'out', 'tools', 'recruiter-run.js');
  const output = execFileSync(
    'node',
    [cliPath, candidatesFile, signupKeysFile, roleTrialsFile, secretsFile, currentModelsFile],
    { encoding: 'utf8', cwd: workDir }
  );

  const report = JSON.parse(output);
  assert.equal(report.escalated.length, 0);
  const roles = report.roles.map((r) => r.role).sort();
  assert.deepEqual(roles, ['coordinator', 'hardener']);
  for (const roleReport of report.roles) {
    assert.deepEqual(roleReport.leaderboard.ranked.map((e) => e.model), ['free-model-mini']);
    assert.equal(roleReport.suggestion.suggestedModel, 'free-model-mini');
  }

  // The REAL secret store actually wrote the key to the file we pointed
  // it at - and never anywhere inside workDir.
  const storedSecrets = JSON.parse(fs.readFileSync(secretsFile, 'utf8'));
  assert.equal(storedSecrets['acme-ai:free-model-mini'], 'sk-live-test-only');
  for (const file of fs.readdirSync(workDir)) {
    const content = fs.readFileSync(path.join(workDir, file), 'utf8');
    assert.equal(content.includes('sk-live-test-only'), false, `the key must never land in the working directory (found in ${file})`);
  }
});

test('a wall-blocked candidate is escalated in the report, not fabricated a key', () => {
  const fixturesDir = mkTmp();
  const secretsFile = path.join(mkTmp(), 'secrets.json');
  const workDir = mkTmp();

  const candidatesFile = path.join(fixturesDir, 'candidates.json');
  fs.writeFileSync(
    candidatesFile,
    JSON.stringify([
      {
        model: 'walled-model',
        provider: 'beta-labs',
        planCost: { amountUsd: 9, unit: 'monthly' },
        signupPath: { url: 'https://beta.example/signup', automation: 'payment-wall' },
      },
    ])
  );
  const signupKeysFile = path.join(fixturesDir, 'signup-keys.json');
  fs.writeFileSync(signupKeysFile, JSON.stringify({}));
  const roleTrialsFile = path.join(fixturesDir, 'role-trials.json');
  fs.writeFileSync(roleTrialsFile, JSON.stringify({}));
  const currentModelsFile = path.join(fixturesDir, 'current-models.json');
  fs.writeFileSync(currentModelsFile, JSON.stringify({}));

  const cliPath = path.join(__dirname, '..', 'out', 'tools', 'recruiter-run.js');
  const output = execFileSync(
    'node',
    [cliPath, candidatesFile, signupKeysFile, roleTrialsFile, secretsFile, currentModelsFile],
    { encoding: 'utf8', cwd: workDir }
  );

  const report = JSON.parse(output);
  assert.deepEqual(report.escalated, [{ model: 'walled-model', wall: 'payment-wall' }]);
  assert.deepEqual(report.roles, []);
  assert.equal(fs.existsSync(secretsFile), false, 'no key was ever acquired, so the secrets file must never be created');
});

test('the CLI exits non-zero with a usage message when arguments are missing', () => {
  const cliPath = path.join(__dirname, '..', 'out', 'tools', 'recruiter-run.js');
  assert.throws(() => execFileSync('node', [cliPath], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }));
});
