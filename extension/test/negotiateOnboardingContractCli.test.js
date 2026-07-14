const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const {
  parseArgs,
  negotiationLogPath,
  readNegotiationState,
  runObject,
  runApprove,
  main: negotiateMain,
} = require('../out/tools/negotiate-onboarding-contract');
const { main: proposeMain } = require('../out/tools/propose-onboarding-contract');
const { main: gateMain } = require('../out/tools/onboarding-contract-gate');
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
const GATE_CLI = path.join(__dirname, '..', 'out', 'tools', 'onboarding-contract-gate.js');

// Runs a CLI's own exported main() in-process (argv-injected, stdout
// captured), never a subprocess - a subprocess-only smoke test is
// coverage-invisible for the logic these call (the engineering article's
// CLI main()-thin-wrapper rule). process.argv/process.exitCode/stdout.write
// are ALWAYS restored in `finally`, never left leaked into later tests
// (Vitest runs every test file in one worker process).
async function runMainInProcess(main, cliPath, argv) {
  const previousArgv = process.argv;
  const previousExitCode = process.exitCode;
  const writes = [];
  const originalWrite = process.stdout.write.bind(process.stdout);
  process.stdout.write = (chunk) => {
    writes.push(chunk);
    return true;
  };
  try {
    process.argv = ['node', cliPath, ...argv];
    process.exitCode = undefined;
    await main();
    const exitCode = process.exitCode;
    const raw = writes.join('');
    return { exitCode, output: raw ? JSON.parse(raw) : null };
  } finally {
    process.stdout.write = originalWrite;
    process.argv = previousArgv;
    process.exitCode = previousExitCode;
  }
}

function runNegotiateCli(argv) {
  return runMainInProcess(negotiateMain, NEGOTIATE_CLI, argv);
}

async function runGateCli(targetRepoPath) {
  const { output } = await runMainInProcess(gateMain, GATE_CLI, [targetRepoPath]);
  return output;
}

async function runProposeCli(targetRepoPath, surveyFactsPath) {
  await runMainInProcess(proposeMain, PROPOSE_CLI, [targetRepoPath, surveyFactsPath]);
}

// A single subprocess smoke test (at the end of this file) locks the
// compiled CLI's own wiring (require.main === module, real argv/env
// boundary) - an ADDITION to the in-process tests above, never the only
// cover for the real logic.
function runCliSubprocess(argv) {
  const output = execFileSync('node', [NEGOTIATE_CLI, ...argv], { encoding: 'utf8' });
  return JSON.parse(output);
}

// The git-repo + already-proposed-contract fixture is IDENTICAL for every
// test in this file - built ONCE here (real `git init`/`git config` +
// one real propose-CLI run, each genuinely expensive as a subprocess),
// then each test takes a cheap `fs.cpSync` copy of it instead of
// re-running git init/config/propose per test (23 tests x 4 processes
// each, before this change).
let PREPARED_ROOT;

beforeAll(async () => {
  PREPARED_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'negotiate-onboarding-contract-prepared-'));
  execFileSync('git', ['init'], { cwd: PREPARED_ROOT });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: PREPARED_ROOT });
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: PREPARED_ROOT });
  const surveyPath = path.join(PREPARED_ROOT, 'survey.json');
  fs.writeFileSync(surveyPath, JSON.stringify(VALID_FACTS));
  await runProposeCli(PREPARED_ROOT, surveyPath);
});

function mkTargetWithProposedContract() {
  const targetRepo = fs.mkdtempSync(path.join(os.tmpdir(), 'negotiate-onboarding-contract-target-'));
  fs.cpSync(PREPARED_ROOT, targetRepo, { recursive: true });
  return targetRepo;
}

function readContract(targetRepo) {
  return parseContractYaml(fs.readFileSync(path.join(targetRepo, '.swarmforge', 'contract.yaml'), 'utf8'));
}

// ── readNegotiationState / runObject / runApprove, called in-process ─────
// (not just via the compiled CLI's subprocess - a subprocess-only smoke test
// is coverage-invisible for the logic these call, per the engineering
// article's CLI main()-thin-wrapper rule.)

test('readNegotiationState reconstructs an open negotiation from a freshly-proposed contract', () => {
  const targetRepo = mkTargetWithProposedContract();
  const state = readNegotiationState(targetRepo);
  assert.equal(state.ended, false);
  assert.equal(state.rounds.length, 0);
  assert.equal(state.contract.agreement, 'proposed');
});

test('readNegotiationState on a target with no contract.yaml throws loud, never fabricates one', () => {
  const targetRepo = fs.mkdtempSync(path.join(os.tmpdir(), 'negotiate-onboarding-contract-state-empty-'));
  assert.throws(() => readNegotiationState(targetRepo), /ENOENT/);
});

test('runObject in-process revises the contract, appends a round, and returns it', async () => {
  const targetRepo = mkTargetWithProposedContract();
  const result = await runObject(targetRepo, 'also add accessibility support');
  assert.equal(result.ended, false);
  assert.equal(result.round.round, 1);
  assert.equal(readContract(targetRepo).agreement, 'proposed');
  assert.ok(readContract(targetRepo).scope.some((s) => s.includes('accessibility support')));
});

test('runObject in-process refuses once the negotiation has already ended', async () => {
  const targetRepo = mkTargetWithProposedContract();
  await runApprove(targetRepo);
  await assert.rejects(() => runObject(targetRepo, 'too late'), /already ended/);
});

test('runApprove in-process flips agreement to agreed and ends the negotiation', async () => {
  const targetRepo = mkTargetWithProposedContract();
  const result = await runApprove(targetRepo);
  assert.equal(result.ended, true);
  assert.equal(result.endedReason, 'approved');
  assert.equal(readContract(targetRepo).agreement, 'agreed');
});

test('runApprove in-process refuses once the negotiation has already ended', async () => {
  const targetRepo = mkTargetWithProposedContract();
  await runApprove(targetRepo);
  await assert.rejects(() => runApprove(targetRepo), /already ended/);
});

test('readNegotiationState re-derives round-limit from the persisted marker after the budget is exhausted (in-process)', async () => {
  const targetRepo = mkTargetWithProposedContract();
  for (let i = 0; i < 5; i++) {
    await runObject(targetRepo, `objection number ${i}`, 5);
  }
  await runObject(targetRepo, 'one too many', 5); // writes the negotiationEndedPath marker

  const state = readNegotiationState(targetRepo);

  assert.equal(state.ended, true);
  assert.equal(state.endedReason, 'round-limit');
});

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

// ── the CLI's own main(), run in-process ──────────────────────────────────

test('BL-344 onboarding-negotiation-07: the negotiation log records the round on disk, real and durable', async () => {
  const targetRepo = mkTargetWithProposedContract();
  await runNegotiateCli([targetRepo, 'object', 'also add accessibility support']);
  const logContent = fs.readFileSync(negotiationLogPath(targetRepo), 'utf8');
  assert.match(logContent, /accessibility support/);
  assert.match(logContent, /"round":1/);
});

test('BL-344 onboarding-negotiation-04: approving ends the negotiation and lands agreement: agreed', async () => {
  const targetRepo = mkTargetWithProposedContract();
  await runNegotiateCli([targetRepo, 'object', 'also add accessibility support']);

  const { output: result } = await runNegotiateCli([targetRepo, 'approve']);
  assert.equal(result.ended, true);
  assert.equal(result.endedReason, 'approved');

  const after = readContract(targetRepo);
  assert.equal(after.agreement, 'agreed');
});

test('onboarding-negotiation-06: the build-start gate still holds after an objection - nothing is onboarded until approved', async () => {
  const targetRepo = mkTargetWithProposedContract();
  await runNegotiateCli([targetRepo, 'object', 'also add accessibility support']);

  const gateOutput = await runGateCli(targetRepo);
  assert.equal(gateOutput.decision, 'hold');
});

test('onboarding-negotiation-06: the gate allows once the contract is approved', async () => {
  const targetRepo = mkTargetWithProposedContract();
  await runNegotiateCli([targetRepo, 'approve']);

  const gateOutput = await runGateCli(targetRepo);
  assert.equal(gateOutput.decision, 'allow');
});

test('approval is still possible immediately after using the LAST round of the budget, before any over-cap attempt', async () => {
  // Regression coverage: using every round successfully must not itself be
  // terminal - only an objection ATTEMPTED after the budget is already
  // exhausted is. Exercises exactly maxRounds real rounds, then approves,
  // never a 6th objection.
  const targetRepo = mkTargetWithProposedContract();
  for (let i = 0; i < 5; i++) {
    await runNegotiateCli([targetRepo, 'object', `objection number ${i}`]);
  }
  const { output: approveOutput } = await runNegotiateCli([targetRepo, 'approve']);
  assert.equal(approveOutput.ended, true);
  assert.equal(approveOutput.endedReason, 'approved');
  assert.equal(readContract(targetRepo).agreement, 'agreed');
});

test('BL-344 onboarding-negotiation-05: the negotiation ends after the bounded round cap is exhausted via real CLI calls', async () => {
  const targetRepo = mkTargetWithProposedContract();
  // DEFAULT_MAX_NEGOTIATION_ROUNDS is 5 - drive 5 real rounds, then one more.
  for (let i = 0; i < 5; i++) {
    const { output: out } = await runNegotiateCli([targetRepo, 'object', `objection number ${i}`]);
    assert.equal(out.ended, false, `round ${i + 1} should still be open`);
  }
  const { output: final } = await runNegotiateCli([targetRepo, 'object', 'one too many']);
  assert.equal(final.ended, true);
  assert.equal(final.endedReason, 'round-limit');

  const contract = readContract(targetRepo);
  assert.notEqual(contract.agreement, 'agreed');
});

test('a further objection after the round cap is refused (in-process main() rejects)', async () => {
  const targetRepo = mkTargetWithProposedContract();
  for (let i = 0; i < 6; i++) {
    try {
      await runNegotiateCli([targetRepo, 'object', `objection ${i}`]);
    } catch {
      // the 7th call below is expected to reject; earlier ones should not
    }
  }
  await assert.rejects(() => runNegotiateCli([targetRepo, 'object', 'yet another']), /already ended/);
});

test('approving after the negotiation already ended is refused (in-process main() rejects)', async () => {
  const targetRepo = mkTargetWithProposedContract();
  await runNegotiateCli([targetRepo, 'approve']);
  await assert.rejects(() => runNegotiateCli([targetRepo, 'approve']), /already ended/);
});

test('negotiating against a target with no proposed contract yet fails loud, never fabricates one', async () => {
  const targetRepo = fs.mkdtempSync(path.join(os.tmpdir(), 'negotiate-onboarding-contract-empty-'));
  await assert.rejects(() => runNegotiateCli([targetRepo, 'object', 'anything']), /ENOENT/);
});

test('the CLI sets a non-zero exit code and prints nothing when arguments are missing (in-process)', async () => {
  const { exitCode, output } = await runNegotiateCli([]);
  assert.equal(exitCode, 1);
  assert.equal(output, null);
});

// A single subprocess smoke test locks the compiled CLI's own wiring
// (require.main === module, real argv/env boundary) - an ADDITION to the
// in-process tests above, never the only cover for the real logic.
test('the compiled CLI runs standalone as a subprocess and produces the same result', () => {
  const targetRepo = mkTargetWithProposedContract();
  const before = readContract(targetRepo);

  const result = runCliSubprocess([targetRepo, 'object', 'also add accessibility support']);
  assert.equal(result.ended, false);
  assert.equal(result.round.round, 1);

  const after = readContract(targetRepo);
  assert.equal(after.agreement, 'proposed');
  assert.notDeepEqual(after, before);
  assert.ok(after.scope.some((s) => s.includes('accessibility support')));
});
