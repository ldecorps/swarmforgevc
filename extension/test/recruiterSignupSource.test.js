const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createFileSignupSource } = require('../out/recruiter/signupSource');

// BL-233 QA bounce follow-up: the CLI orchestrator needs SOME production
// SignupSource - mirrors discoverySource.ts's own choice (an operator-
// maintained JSON file, not live web/provider automation, which nothing
// in the ticket specifies). Never called for wall candidates in practice
// (acquire.ts only invokes signUp() for 'automatable' candidates) - these
// tests exercise the adapter directly regardless.

function candidate(model) {
  return {
    model,
    provider: 'acme-ai',
    planCost: { amountUsd: 0, unit: 'free' },
    signupPath: { url: 'https://acme.example/signup', automation: 'automatable' },
  };
}

function mkTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sfvc-recruiter-signup-'));
}

test('resolves the API key recorded for a candidate model', async () => {
  const keysFile = path.join(mkTmp(), 'keys.json');
  fs.writeFileSync(keysFile, JSON.stringify({ 'free-model-mini': 'sk-live-abc123' }));
  const source = createFileSignupSource(keysFile);

  const key = await source.signUp(candidate('free-model-mini'));

  assert.equal(key, 'sk-live-abc123');
});

test('throws a clear error when the keys file does not exist yet', async () => {
  const keysFile = path.join(mkTmp(), 'missing-keys.json');
  const source = createFileSignupSource(keysFile);

  await assert.rejects(() => source.signUp(candidate('free-model-mini')), /no signup keys file/i);
});

test('throws a clear error when no key is recorded for this candidate', async () => {
  const keysFile = path.join(mkTmp(), 'keys.json');
  fs.writeFileSync(keysFile, JSON.stringify({ 'other-model': 'sk-live-xyz' }));
  const source = createFileSignupSource(keysFile);

  await assert.rejects(() => source.signUp(candidate('free-model-mini')), /no api key recorded/i);
});
