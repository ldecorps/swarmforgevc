const assert = require('node:assert/strict');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { main, parseArgs } = require('../out/tools/provision-onboarding-telegram-channel');

const CLI_PATH = path.join(__dirname, '..', 'out', 'tools', 'provision-onboarding-telegram-channel.js');

// ── parseArgs ────────────────────────────────────────────────────────────

test('parseArgs returns all four positional args when given', () => {
  assert.deepEqual(parseArgs(['/target', 'bot-token', 'bot-username', '/host/secrets.json']), {
    targetRepoPath: '/target',
    botToken: 'bot-token',
    botUsername: 'bot-username',
    hostSecretsFilePath: '/host/secrets.json',
  });
});

test('parseArgs returns null when no arguments are given', () => {
  assert.equal(parseArgs([]), null);
});

test('parseArgs returns null when the host secrets file path is missing', () => {
  assert.equal(parseArgs(['/target', 'bot-token', 'bot-username']), null);
});

// ── main() wiring (no real network - a missing arg is caught by
// makeArgsGuardedMain strictly before buildAdapters/provisionTelegramChannel
// ever runs, so this never reaches api.telegram.org - safe to run
// in-process) ────────────────────────────────────────────────────────────

// Runs the REAL main() in-process, so in-process coverage and mutation
// tooling can see the argv guard branch a subprocess-only smoke test cannot
// (the engineering article's CLI main()-thin-wrapper rule; mirrors
// proposeOnboardingContractCli.test.js's own identical seam).
async function runCli(args) {
  const previousArgv = process.argv;
  const previousExitCode = process.exitCode;
  const stderrChunks = [];
  const originalStderrWrite = process.stderr.write.bind(process.stderr);
  process.stderr.write = (chunk) => {
    stderrChunks.push(chunk);
    return true;
  };
  try {
    process.argv = ['node', CLI_PATH, ...args];
    process.exitCode = undefined;
    await main();
    return { exitCode: process.exitCode ?? 0, stderr: stderrChunks.join('') };
  } finally {
    process.stderr.write = originalStderrWrite;
    process.argv = previousArgv;
    process.exitCode = previousExitCode;
  }
}

test('main() prints usage and exits non-zero when a required argument is missing', async () => {
  const result = await runCli([]);
  assert.notEqual(result.exitCode, 0);
  assert.match(result.stderr, /Usage: node provision-onboarding-telegram-channel\.js/);
});

// A single subprocess smoke test locks the compiled CLI's own wiring
// (require.main === module, real argv boundary) - an ADDITION to the
// in-process test above, never the only cover for the real logic.
test('the compiled CLI runs standalone as a subprocess and produces the same result', () => {
  try {
    execFileSync('node', [CLI_PATH], { encoding: 'utf8', stdio: 'pipe' });
    assert.fail('expected the CLI to exit non-zero with no arguments');
  } catch (err) {
    assert.notEqual(err.status, 0);
    assert.match(err.stderr, /Usage: node provision-onboarding-telegram-channel\.js/);
  }
});
