const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { parseArgs, negotiationLogPath } = require('../out/tools/negotiate-onboarding-contract');
const { parseContractYaml } = require('../out/onboarding/contractView');

const VALID_FACTS = {
  languages: ['TypeScript'],
  layoutSummary: 'src/ + test/',
  readmeSummary: 'A CLI tool.',
  seedVision: 'Ship the MVP.',
  initialBacklogSummary: '5 tickets queued.',
};

const PROPOSE_CLI = path.join(__dirname, '..', 'out', 'tools', 'propose-onboarding-contract.js');
const NEGOTIATE_CLI = path.join(__dirname, '..', 'out', 'tools', 'negotiate-onboarding-contract.js');

function mkTargetWithProposedContract() {
  const targetRepo = fs.mkdtempSync(path.join(os.tmpdir(), 'negotiate-onboarding-contract-target-'));
  execFileSync('git', ['init'], { cwd: targetRepo });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: targetRepo });
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: targetRepo });
  const surveyPath = path.join(targetRepo, 'survey.json');
  fs.writeFileSync(surveyPath, JSON.stringify(VALID_FACTS));
  execFileSync('node', [PROPOSE_CLI, targetRepo, surveyPath]);
  return targetRepo;
}

function readContract(targetRepo) {
  return parseContractYaml(fs.readFileSync(path.join(targetRepo, '.swarmforge', 'contract.yaml'), 'utf8'));
}

// ── parseArgs ────────────────────────────────────────────────────────────

test('parseArgs: an object command with an objection is accepted', () => {
  assert.deepEqual(parseArgs(['/target', 'object', 'remove the payments work']), {
    targetRepoPath: '/target',
    action: 'object',
    objection: 'remove the payments work',
  });
});

test('parseArgs: an object command with no objection text returns null', () => {
  assert.equal(parseArgs(['/target', 'object']), null);
});

test('parseArgs: an approve command is accepted', () => {
  assert.deepEqual(parseArgs(['/target', 'approve']), { targetRepoPath: '/target', action: 'approve' });
});

test('parseArgs: an unknown action returns null', () => {
  assert.equal(parseArgs(['/target', 'reject']), null);
});

test('parseArgs: no arguments returns null', () => {
  assert.equal(parseArgs([]), null);
});

// ── the compiled CLI's own real output ────────────────────────────────────

test('BL-344 onboarding-negotiation-01/02: objecting revises the real committed contract and re-proposes it', () => {
  const targetRepo = mkTargetWithProposedContract();
  const before = readContract(targetRepo);

  const output = execFileSync('node', [NEGOTIATE_CLI, targetRepo, 'object', 'also add accessibility support'], {
    encoding: 'utf8',
  });
  const result = JSON.parse(output);
  assert.equal(result.ended, false);
  assert.equal(result.round.round, 1);

  const after = readContract(targetRepo);
  assert.equal(after.agreement, 'proposed');
  assert.notDeepEqual(after, before);
  assert.ok(after.scope.some((s) => s.includes('accessibility support')));
});

test('onboarding-negotiation-07: the negotiation log records the round on disk, real and durable', () => {
  const targetRepo = mkTargetWithProposedContract();
  execFileSync('node', [NEGOTIATE_CLI, targetRepo, 'object', 'also add accessibility support'], { encoding: 'utf8' });
  const logContent = fs.readFileSync(negotiationLogPath(targetRepo), 'utf8');
  assert.match(logContent, /accessibility support/);
  assert.match(logContent, /"round":1/);
});

test('BL-344 onboarding-negotiation-04: approving ends the negotiation and lands agreement: agreed', () => {
  const targetRepo = mkTargetWithProposedContract();
  execFileSync('node', [NEGOTIATE_CLI, targetRepo, 'object', 'also add accessibility support'], { encoding: 'utf8' });

  const output = execFileSync('node', [NEGOTIATE_CLI, targetRepo, 'approve'], { encoding: 'utf8' });
  const result = JSON.parse(output);
  assert.equal(result.ended, true);
  assert.equal(result.endedReason, 'approved');

  const after = readContract(targetRepo);
  assert.equal(after.agreement, 'agreed');
});

test('onboarding-negotiation-06: the build-start gate still holds after an objection - nothing is onboarded until approved', () => {
  const targetRepo = mkTargetWithProposedContract();
  execFileSync('node', [NEGOTIATE_CLI, targetRepo, 'object', 'also add accessibility support'], { encoding: 'utf8' });

  const GATE_CLI = path.join(__dirname, '..', 'out', 'tools', 'onboarding-contract-gate.js');
  const gateOutput = JSON.parse(execFileSync('node', [GATE_CLI, targetRepo], { encoding: 'utf8' }));
  assert.equal(gateOutput.decision, 'hold');
});

test('onboarding-negotiation-06: the gate allows once the contract is approved', () => {
  const targetRepo = mkTargetWithProposedContract();
  execFileSync('node', [NEGOTIATE_CLI, targetRepo, 'approve'], { encoding: 'utf8' });

  const GATE_CLI = path.join(__dirname, '..', 'out', 'tools', 'onboarding-contract-gate.js');
  const gateOutput = JSON.parse(execFileSync('node', [GATE_CLI, targetRepo], { encoding: 'utf8' }));
  assert.equal(gateOutput.decision, 'allow');
});

test('approval is still possible immediately after using the LAST round of the budget, before any over-cap attempt', () => {
  // Regression coverage: using every round successfully must not itself be
  // terminal - only an objection ATTEMPTED after the budget is already
  // exhausted is. Exercises exactly maxRounds real rounds, then approves,
  // never a 6th objection.
  const targetRepo = mkTargetWithProposedContract();
  for (let i = 0; i < 5; i++) {
    execFileSync('node', [NEGOTIATE_CLI, targetRepo, 'object', `objection number ${i}`], { encoding: 'utf8' });
  }
  const approveOutput = JSON.parse(execFileSync('node', [NEGOTIATE_CLI, targetRepo, 'approve'], { encoding: 'utf8' }));
  assert.equal(approveOutput.ended, true);
  assert.equal(approveOutput.endedReason, 'approved');
  assert.equal(readContract(targetRepo).agreement, 'agreed');
});

test('BL-344 onboarding-negotiation-05: the negotiation ends after the bounded round cap is exhausted via real CLI calls', () => {
  const targetRepo = mkTargetWithProposedContract();
  // DEFAULT_MAX_NEGOTIATION_ROUNDS is 5 - drive 5 real rounds, then one more.
  for (let i = 0; i < 5; i++) {
    const out = JSON.parse(
      execFileSync('node', [NEGOTIATE_CLI, targetRepo, 'object', `objection number ${i}`], { encoding: 'utf8' })
    );
    assert.equal(out.ended, false, `round ${i + 1} should still be open`);
  }
  const final = JSON.parse(
    execFileSync('node', [NEGOTIATE_CLI, targetRepo, 'object', 'one too many'], { encoding: 'utf8' })
  );
  assert.equal(final.ended, true);
  assert.equal(final.endedReason, 'round-limit');

  const contract = readContract(targetRepo);
  assert.notEqual(contract.agreement, 'agreed');
});

test('a further objection after the round cap is refused (real CLI exits non-zero)', () => {
  const targetRepo = mkTargetWithProposedContract();
  for (let i = 0; i < 6; i++) {
    try {
      execFileSync('node', [NEGOTIATE_CLI, targetRepo, 'object', `objection ${i}`], { encoding: 'utf8' });
    } catch {
      // the 6th call is expected to throw below; earlier ones should not
    }
  }
  assert.throws(() => execFileSync('node', [NEGOTIATE_CLI, targetRepo, 'object', 'yet another'], { encoding: 'utf8', stdio: 'pipe' }));
});

test('approving after the negotiation already ended is refused (real CLI exits non-zero)', () => {
  const targetRepo = mkTargetWithProposedContract();
  execFileSync('node', [NEGOTIATE_CLI, targetRepo, 'approve'], { encoding: 'utf8' });
  assert.throws(() => execFileSync('node', [NEGOTIATE_CLI, targetRepo, 'approve'], { encoding: 'utf8', stdio: 'pipe' }));
});

test('negotiating against a target with no proposed contract yet fails loud, never fabricates one', () => {
  const targetRepo = fs.mkdtempSync(path.join(os.tmpdir(), 'negotiate-onboarding-contract-empty-'));
  assert.throws(() =>
    execFileSync('node', [NEGOTIATE_CLI, targetRepo, 'object', 'anything'], { encoding: 'utf8', stdio: 'pipe' })
  );
});

test('the compiled CLI prints usage and exits non-zero when arguments are missing', () => {
  assert.throws(() => execFileSync('node', [NEGOTIATE_CLI], { encoding: 'utf8' }));
});
