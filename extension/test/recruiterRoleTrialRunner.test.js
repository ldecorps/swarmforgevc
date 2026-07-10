const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createFileRoleTrialRunner } = require('../out/recruiter/roleTrialRunner');

// BL-233 QA bounce follow-up: the CLI orchestrator needs SOME production
// RoleTrialRunner - mirrors discoverySource.ts's own choice (an operator-
// maintained JSON file recording each candidate's per-role battery gate
// args, populated by whatever process - manual today, a future harness
// later - actually ran the trial; nothing in the ticket specifies that
// mechanism).

function candidate(model) {
  return {
    model,
    provider: 'acme-ai',
    planCost: { amountUsd: 0, unit: 'free' },
    signupPath: { url: 'https://acme.example/signup', automation: 'automatable' },
  };
}

function mkTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sfvc-recruiter-trials-'));
}

test('resolves the recorded per-role gate args for a candidate model', async () => {
  const trialsFile = path.join(mkTmp(), 'trials.json');
  fs.writeFileSync(
    trialsFile,
    JSON.stringify({ 'free-model-mini': { hardener: ['2', '1.0', '0'], coordinator: ['1', '3', 'true'] } })
  );
  const runner = createFileRoleTrialRunner(trialsFile);

  const trials = await runner.runTrials(candidate('free-model-mini'));

  assert.deepEqual(
    trials.sort((a, b) => a.role.localeCompare(b.role)),
    [
      { role: 'coordinator', gateArgs: ['1', '3', 'true'] },
      { role: 'hardener', gateArgs: ['2', '1.0', '0'] },
    ]
  );
});

test('a missing trials file yields no trials, not an error', async () => {
  const trialsFile = path.join(mkTmp(), 'missing-trials.json');
  const runner = createFileRoleTrialRunner(trialsFile);

  const trials = await runner.runTrials(candidate('free-model-mini'));

  assert.deepEqual(trials, []);
});

test('a candidate with no recorded trials yields an empty list, not a crash', async () => {
  const trialsFile = path.join(mkTmp(), 'trials.json');
  fs.writeFileSync(trialsFile, JSON.stringify({ 'other-model': { hardener: ['2', '1.0', '0'] } }));
  const runner = createFileRoleTrialRunner(trialsFile);

  const trials = await runner.runTrials(candidate('free-model-mini'));

  assert.deepEqual(trials, []);
});
