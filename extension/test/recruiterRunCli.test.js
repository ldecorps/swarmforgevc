const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { main } = require('../out/tools/recruiter-run');

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

const CLI = path.join(__dirname, '..', 'out', 'tools', 'recruiter-run.js');

function runCliSubprocess(workDir, args) {
  return execFileSync('node', [CLI, ...args], { encoding: 'utf8', cwd: workDir });
}

// Runs the REAL main() in-process against real fixture files, so in-process
// coverage and mutation tooling can see the branches a subprocess-only
// smoke test cannot (the engineering article's CLI main()-thin-wrapper
// rule; mirrors notifyDeadLettersCli.test.js's own identical seam). main()
// (makeArgsGuardedMain's returned closure) reads its positional args off
// process.argv.slice(2) directly (no parameters), so the in-process helper
// must set process.argv to the same shape the subprocess would have
// received, and chdir so the SAME "secrets file must never land inside the
// working directory" guard (which reads process.cwd()) sees the same cwd.
async function runCli(workDir, args) {
  const previousCwd = process.cwd();
  const previousArgv = process.argv;
  const previousExitCode = process.exitCode;
  const writes = [];
  const originalWrite = process.stdout.write.bind(process.stdout);
  process.stdout.write = (chunk) => {
    writes.push(chunk);
    return true;
  };
  let exitCode;
  try {
    process.argv = ['node', CLI, ...args];
    process.exitCode = undefined;
    process.chdir(workDir);
    await main();
    exitCode = process.exitCode;
  } finally {
    process.stdout.write = originalWrite;
    process.chdir(previousCwd);
    process.argv = previousArgv;
    process.exitCode = previousExitCode;
  }
  return { stdout: writes.join(''), exitCode };
}

test('a wall-blocked candidate is escalated in the report, not fabricated a key', async () => {
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

  const result = await runCli(workDir, [candidatesFile, signupKeysFile, roleTrialsFile, secretsFile, currentModelsFile]);

  const report = JSON.parse(result.stdout);
  assert.deepEqual(report.escalated, [{ model: 'walled-model', wall: 'payment-wall' }]);
  assert.deepEqual(report.roles, []);
  assert.equal(fs.existsSync(secretsFile), false, 'no key was ever acquired, so the secrets file must never be created');
});

test('the CLI exits non-zero with a usage message when arguments are missing', async () => {
  const result = await runCli(mkTmp(), []);
  assert.equal(result.exitCode, 1);
});

// A single subprocess smoke test locks the compiled CLI's own wiring
// (require.main === module, real argv/env boundary) - an ADDITION to the
// in-process tests above, never the only cover for the real logic.
test('the compiled CLI runs standalone as a subprocess and produces the same result', () => {
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

  const output = runCliSubprocess(workDir, [candidatesFile, signupKeysFile, roleTrialsFile, secretsFile, currentModelsFile]);

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
