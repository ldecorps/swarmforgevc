const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { main } = require('../out/tools/recruiter-discover');

// BL-233 discover-candidates-01: the compiled CLI is a thin presenter over
// discoverySource.ts - out-of-band tooling (mirrors BL-231's compliance
// battery posture), no worktree/mailbox/backlog state touched.

function mkTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sfvc-recruiter-cli-'));
}

const CLI = path.join(__dirname, '..', 'out', 'tools', 'recruiter-discover.js');

function runCliSubprocess(candidatesFile) {
  const args = candidatesFile === undefined ? [CLI] : [CLI, candidatesFile];
  return execFileSync('node', args, { encoding: 'utf8' });
}

// Runs the REAL main() in-process so in-process coverage and mutation
// tooling can see main()'s own branches (the engineering article's CLI
// main()-thin-wrapper rule; mirrors notifyDeadLettersCli.test.js's own
// identical seam). main() reads its candidates-file argument off
// process.argv[2] directly (no parameters), so the in-process helper must
// set process.argv to the same shape the subprocess would have received.
async function runCli(candidatesFile) {
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
    process.argv = candidatesFile === undefined ? ['node', CLI] : ['node', CLI, candidatesFile];
    process.exitCode = undefined;
    await main();
    exitCode = process.exitCode;
  } finally {
    process.stdout.write = originalWrite;
    process.argv = previousArgv;
    process.exitCode = previousExitCode;
  }
  return { stdout: writes.join(''), exitCode };
}

test('the CLI exits non-zero with a usage message when no candidates file is given', async () => {
  const result = await runCli(undefined);
  assert.equal(result.exitCode, 1);
});

// A single subprocess smoke test locks the compiled CLI's own wiring
// (require.main === module, real argv/env boundary) - an ADDITION to the
// in-process test above, never the only cover for the real logic.
test('the compiled CLI runs standalone as a subprocess and produces the same result', () => {
  const dir = mkTmp();
  const candidatesFile = path.join(dir, 'candidates.json');
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

  const output = runCliSubprocess(candidatesFile);

  const data = JSON.parse(output);
  assert.equal(data.candidates.length, 1);
  assert.equal(data.candidates[0].model, 'free-model-mini');
});
