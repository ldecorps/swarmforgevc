const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

// BL-233 discover-candidates-01: the compiled CLI is a thin presenter over
// discoverySource.ts - out-of-band tooling (mirrors BL-231's compliance
// battery posture), no worktree/mailbox/backlog state touched.

function mkTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sfvc-recruiter-cli-'));
}

test('the compiled CLI prints the discovered candidate report as JSON to stdout', () => {
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

  const cliPath = path.join(__dirname, '..', 'out', 'tools', 'recruiter-discover.js');
  const output = execFileSync('node', [cliPath, candidatesFile], { encoding: 'utf8' });

  const data = JSON.parse(output);
  assert.equal(data.candidates.length, 1);
  assert.equal(data.candidates[0].model, 'free-model-mini');
});

test('the CLI exits non-zero with a usage message when no candidates file is given', () => {
  const cliPath = path.join(__dirname, '..', 'out', 'tools', 'recruiter-discover.js');
  assert.throws(() => execFileSync('node', [cliPath], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }));
});
