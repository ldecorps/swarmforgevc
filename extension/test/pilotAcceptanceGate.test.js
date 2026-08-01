'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { mkTmpDir } = require('./helpers/tmpDir');
const {
  landPilotedTicket,
  resolveFeatureFilePath,
  describeAcceptanceFailure,
} = require('../out/tools/pilotAcceptanceGate');

function mkDeps(overrides) {
  const calls = { move: 0, writeReceipt: 0 };
  const deps = {
    readAcceptanceDeclaration: () => 'specs/features/fixture.feature',
    resolveFeatureFilePath: () => '/repo/specs/features/fixture.feature',
    runAcceptance: async () => ({ success: true, output: 'ok' }),
    checkCommitClaims: () => ({ checked: true, commitsChecked: 3 }),
    moveTicketToDone: () => {
      calls.move += 1;
      return { moved: true, destination: '/repo/backlog/done/BL-FIX-fixture.yaml' };
    },
    writeReceipt: () => {
      calls.writeReceipt += 1;
    },
    getLandedCommit: () => 'abc1234567',
    now: () => '2026-07-31T00:00:00.000Z',
    ...overrides,
  };
  return { deps, calls };
}

// ── describeAcceptanceFailure ─────────────────────────────────────────

test('describeAcceptanceFailure names the unmatched step', () => {
  const output = 'Scenario "X": no step handler matched "Given a fixture that has no handler"\n';
  assert.deepEqual(describeAcceptanceFailure(output), {
    unmatchedStep: 'Given a fixture that has no handler',
  });
});

test('describeAcceptanceFailure names the failing scenario over an unmatched step', () => {
  const output = 'Scenario "Y" failed at step "Then it asserts": expected true, got false\n';
  assert.deepEqual(describeAcceptanceFailure(output), { failingScenario: 'Y' });
});

test('describeAcceptanceFailure returns nothing it cannot parse', () => {
  assert.deepEqual(describeAcceptanceFailure('some unrelated crash output'), {});
});

// ── resolveFeatureFilePath ────────────────────────────────────────────

test('resolveFeatureFilePath resolves an existing repo-relative feature file', () => {
  const root = mkTmpDir('sfvc-pag-resolve-');
  fs.mkdirSync(path.join(root, 'specs', 'features'), { recursive: true });
  fs.writeFileSync(path.join(root, 'specs', 'features', 'fixture.feature'), 'Feature: X\n', 'utf8');
  assert.equal(
    resolveFeatureFilePath(root, 'specs/features/fixture.feature'),
    path.join(root, 'specs', 'features', 'fixture.feature')
  );
});

test('resolveFeatureFilePath refuses a path that does not exist', () => {
  const root = mkTmpDir('sfvc-pag-resolve-');
  assert.equal(resolveFeatureFilePath(root, 'specs/features/does-not-exist.feature'), undefined);
});

test('resolveFeatureFilePath refuses inline Gherkin text (multi-line, not a path)', () => {
  const root = mkTmpDir('sfvc-pag-resolve-');
  const inline = 'Feature: inline\n  Scenario: works\n    Given a thing\n';
  assert.equal(resolveFeatureFilePath(root, inline), undefined);
});

test('resolveFeatureFilePath refuses a blank declaration', () => {
  const root = mkTmpDir('sfvc-pag-resolve-');
  assert.equal(resolveFeatureFilePath(root, '   '), undefined);
});

test('resolveFeatureFilePath refuses a directory (not a file)', () => {
  const root = mkTmpDir('sfvc-pag-resolve-');
  fs.mkdirSync(path.join(root, 'specs', 'features'), { recursive: true });
  assert.equal(resolveFeatureFilePath(root, 'specs/features'), undefined);
});

test('resolveFeatureFilePath trims surrounding whitespace before resolving (not just before the emptiness check)', () => {
  const root = mkTmpDir('sfvc-pag-resolve-');
  fs.mkdirSync(path.join(root, 'specs', 'features'), { recursive: true });
  fs.writeFileSync(path.join(root, 'specs', 'features', 'fixture.feature'), 'Feature: X\n', 'utf8');
  assert.equal(
    resolveFeatureFilePath(root, '  specs/features/fixture.feature  \n'),
    path.join(root, 'specs', 'features', 'fixture.feature')
  );
});

// The blank/newline guard is load-bearing on its own, not merely incidental
// fallout of fs.statSync failing on a malformed candidate path - prove it by
// making the untrimmed/unguarded candidate resolve to a REAL file, so a
// guard-skipping mutant would wrongly land it instead of refusing.
test('resolveFeatureFilePath refuses a blank declaration even when the empty-join candidate is itself a real file (blank guard is load-bearing)', () => {
  const dir = mkTmpDir('sfvc-pag-resolve-');
  const filePath = path.join(dir, 'looks-like-a-repo-root.txt');
  fs.writeFileSync(filePath, 'x', 'utf8');
  assert.equal(resolveFeatureFilePath(filePath, '   '), undefined);
});

test('resolveFeatureFilePath refuses inline Gherkin text even when a file with that literal newline-bearing name exists (newline guard is load-bearing)', () => {
  const root = mkTmpDir('sfvc-pag-resolve-');
  const inline = 'Feature: inline\n  Scenario: works\n    Given a thing\n';
  fs.writeFileSync(path.join(root, inline.trim()), 'x', 'utf8');
  assert.equal(resolveFeatureFilePath(root, inline), undefined);
});

// The catch block's explicit `return undefined` is equivalent to falling
// through with no return (both yield `undefined`, the function's last
// statement) - a Stryker BlockStatement mutant emptying the catch body
// cannot be killed by any assertion; recorded per BL-234, not fixed.

// ── landPilotedTicket: scenario 03 (no executable acceptance contract) ─

test('landPilotedTicket refuses when the acceptance declaration is absent, naming "no acceptance: field" specifically (not the declared-value branch)', async () => {
  const { deps, calls } = mkDeps({
    readAcceptanceDeclaration: () => undefined,
  });
  const outcome = await landPilotedTicket('BL-FIX', deps);
  assert.equal(outcome.landed, false);
  assert.equal(outcome.reasonKind, 'no-contract');
  assert.equal(
    outcome.reason,
    'BL-FIX has no executable acceptance contract: acceptance: must name an existing feature file (declared: no acceptance: field)'
  );
  assert.equal(calls.move, 0);
  assert.equal(calls.writeReceipt, 0);
});

test('landPilotedTicket refuses when the acceptance declaration resolves to no file, quoting the actual declared value (not the absent-field branch)', async () => {
  const declaration = 'Feature: inline\n  Scenario: x\n';
  const { deps, calls } = mkDeps({
    readAcceptanceDeclaration: () => declaration,
    resolveFeatureFilePath: () => undefined,
  });
  const outcome = await landPilotedTicket('BL-FIX', deps);
  assert.equal(outcome.landed, false);
  assert.equal(outcome.reasonKind, 'no-contract');
  assert.equal(outcome.reason, `BL-FIX has no executable acceptance contract: acceptance: must name an existing feature file (declared: ${JSON.stringify(declaration)})`);
  assert.equal(calls.move, 0);
  assert.equal(calls.writeReceipt, 0);
});

// ── landPilotedTicket: scenario outline 01 (contract does not pass) ────

test('landPilotedTicket refuses and names the unmatched step', async () => {
  const { deps, calls } = mkDeps({
    runAcceptance: async () => ({
      success: false,
      output: 'Scenario "S": no step handler matched "Given an unhandled step"\n',
    }),
  });
  const outcome = await landPilotedTicket('BL-FIX', deps);
  assert.equal(outcome.landed, false);
  assert.equal(outcome.reasonKind, 'contract-failed');
  assert.equal(outcome.unmatchedStep, 'Given an unhandled step');
  assert.equal(outcome.failingScenario, undefined);
  assert.match(outcome.reason, /unmatched step "Given an unhandled step"/);
  assert.equal(calls.move, 0);
  assert.equal(calls.writeReceipt, 0);
});

test('landPilotedTicket refuses and names the failing scenario', async () => {
  const { deps, calls } = mkDeps({
    runAcceptance: async () => ({
      success: false,
      output: 'Scenario "Renders the tile" failed at step "Then it renders": expected green, got red\n',
    }),
  });
  const outcome = await landPilotedTicket('BL-FIX', deps);
  assert.equal(outcome.landed, false);
  assert.equal(outcome.reasonKind, 'contract-failed');
  assert.equal(outcome.failingScenario, 'Renders the tile');
  assert.equal(outcome.unmatchedStep, undefined);
  assert.match(outcome.reason, /failing scenario "Renders the tile"/);
  assert.equal(calls.move, 0);
  assert.equal(calls.writeReceipt, 0);
});

test('landPilotedTicket refuses with a generic reason when the acceptance output names neither a scenario nor a step', async () => {
  const { deps, calls } = mkDeps({
    runAcceptance: async () => ({ success: false, output: 'unrelated crash, no scenario or step named\n' }),
  });
  const outcome = await landPilotedTicket('BL-FIX', deps);
  assert.equal(outcome.landed, false);
  assert.equal(outcome.reasonKind, 'contract-failed');
  assert.equal(outcome.failingScenario, undefined);
  assert.equal(outcome.unmatchedStep, undefined);
  assert.match(outcome.reason, /see acceptance output/);
  assert.equal(calls.move, 0);
  assert.equal(calls.writeReceipt, 0);
});

// ── landPilotedTicket: scenario 02 (green run lands with a receipt) ────

test('landPilotedTicket lands and writes a receipt naming the feature file, commit, and passing result', async () => {
  let receipt;
  const { deps, calls } = mkDeps({
    readAcceptanceDeclaration: () => '  specs/features/fixture.feature  ',
    writeReceipt: (ticketId, r) => {
      calls.writeReceipt += 1;
      receipt = r;
    },
  });
  const outcome = await landPilotedTicket('BL-FIX', deps);
  assert.equal(outcome.landed, true);
  assert.equal(outcome.destination, '/repo/backlog/done/BL-FIX-fixture.yaml');
  assert.equal(calls.move, 1);
  assert.equal(calls.writeReceipt, 1);
  assert.equal(receipt.ticketId, 'BL-FIX');
  assert.equal(receipt.featureFile, 'specs/features/fixture.feature');
  assert.equal(receipt.landedCommit, 'abc1234567');
  assert.equal(receipt.result, 'passed');
  assert.equal(receipt.landedAt, '2026-07-31T00:00:00.000Z');
  assert.equal(receipt.commitClaimsChecked, 3);
  assert.deepEqual(outcome.receipt, receipt);
});

// ── landPilotedTicket: BL-729 commit-claim checking ─────────────────────

test('landPilotedTicket refuses a land whose commit claims an unsupported change, naming the commit, identifier, and sentence', async () => {
  const { deps, calls } = mkDeps({
    checkCommitClaims: () => ({
      checked: true,
      commitsChecked: 2,
      unsupported: { commit: '6a2e4aaf6d', identifier: 'deliver!', sentence: 'restore the deliver! close paren' },
    }),
  });
  const outcome = await landPilotedTicket('BL-FIX', deps);
  assert.equal(outcome.landed, false);
  assert.equal(outcome.reasonKind, 'claim-unsupported');
  assert.equal(outcome.claimCommit, '6a2e4aaf6d');
  assert.equal(outcome.claimIdentifier, 'deliver!');
  assert.equal(outcome.claimSentence, 'restore the deliver! close paren');
  assert.match(outcome.reason, /6a2e4aaf6d/);
  assert.match(outcome.reason, /deliver!/);
  assert.equal(calls.move, 0);
  assert.equal(calls.writeReceipt, 0);
});

test('landPilotedTicket checks claims only after a green contract, never before', async () => {
  let claimsCheckCalled = false;
  const { deps } = mkDeps({
    runAcceptance: async () => ({
      success: false,
      output: 'Scenario "S": no step handler matched "Given an unhandled step"\n',
    }),
    checkCommitClaims: () => {
      claimsCheckCalled = true;
      return { checked: true, commitsChecked: 1 };
    },
  });
  const outcome = await landPilotedTicket('BL-FIX', deps);
  assert.equal(outcome.landed, false);
  assert.equal(outcome.reasonKind, 'contract-failed');
  assert.equal(claimsCheckCalled, false);
});

test('landPilotedTicket lands with a warning and records zero commits checked when the run history cannot be resolved (fails open)', async () => {
  const { deps, calls } = mkDeps({
    checkCommitClaims: () => ({ checked: false }),
  });
  let receipt;
  deps.writeReceipt = (ticketId, r) => {
    calls.writeReceipt += 1;
    receipt = r;
  };
  const outcome = await landPilotedTicket('BL-FIX', deps);
  assert.equal(outcome.landed, true);
  assert.ok(Array.isArray(outcome.warnings) && outcome.warnings.length > 0);
  assert.match(outcome.warnings[0], /not checked/);
  assert.equal(receipt.commitClaimsChecked, 0);
});

test('landPilotedTicket lands with no warnings field when every commit claim was checked and supported', async () => {
  const { deps } = mkDeps({
    checkCommitClaims: () => ({ checked: true, commitsChecked: 5 }),
  });
  const outcome = await landPilotedTicket('BL-FIX', deps);
  assert.equal(outcome.landed, true);
  assert.equal(outcome.warnings, undefined);
});

test('landPilotedTicket never moves or writes a receipt when the commit-claim check refuses the land', async () => {
  const { deps, calls } = mkDeps({
    checkCommitClaims: () => ({
      checked: true,
      commitsChecked: 1,
      unsupported: { commit: 'abc1234567', identifier: 'frobnicate!', sentence: 'restore the frobnicate! guard' },
    }),
  });
  await landPilotedTicket('BL-FIX', deps);
  assert.equal(calls.move, 0);
  assert.equal(calls.writeReceipt, 0);
});

// ── landPilotedTicket: scenario 04 (refused land changes nothing) ──────

test('landPilotedTicket never moves or writes a receipt on refusal', async () => {
  const { deps, calls } = mkDeps({
    runAcceptance: async () => ({
      success: false,
      output: 'Scenario "S": no step handler matched "Given an unhandled step"\n',
    }),
  });
  await landPilotedTicket('BL-FIX', deps);
  assert.equal(calls.move, 0);
  assert.equal(calls.writeReceipt, 0);
});

// ── landPilotedTicket: move failure after a green run ───────────────────

test('landPilotedTicket resolves the landed commit before moving the yaml, so a commit-resolution failure leaves nothing moved', async () => {
  const order = [];
  const { deps } = mkDeps({
    getLandedCommit: () => {
      order.push('getLandedCommit');
      return 'abc1234567';
    },
    moveTicketToDone: () => {
      order.push('moveTicketToDone');
      return { moved: true, destination: '/repo/backlog/done/BL-FIX-fixture.yaml' };
    },
  });
  await landPilotedTicket('BL-FIX', deps);
  assert.deepEqual(order, ['getLandedCommit', 'moveTicketToDone']);
});

test('landPilotedTicket refuses (without a receipt) when the move itself fails after a green run', async () => {
  const { deps, calls } = mkDeps({
    moveTicketToDone: () => {
      calls.move += 1;
      return { moved: false };
    },
  });
  const outcome = await landPilotedTicket('BL-FIX', deps);
  assert.equal(outcome.landed, false);
  assert.equal(outcome.reasonKind, 'move-failed');
  assert.equal(
    outcome.reason,
    "BL-FIX's acceptance contract passed but the ticket yaml could not be moved to backlog/done/"
  );
  assert.equal(calls.writeReceipt, 0);
});

// moved=true but destination missing must ALSO refuse - an `||` weakened to
// `&&` here would let this case through since !moved is false.
test('landPilotedTicket refuses when moveTicketToDone reports moved=true but omits the destination', async () => {
  const { deps, calls } = mkDeps({
    moveTicketToDone: () => {
      calls.move += 1;
      return { moved: true };
    },
  });
  const outcome = await landPilotedTicket('BL-FIX', deps);
  assert.equal(outcome.landed, false);
  assert.equal(outcome.reasonKind, 'move-failed');
  assert.equal(calls.writeReceipt, 0);
});
