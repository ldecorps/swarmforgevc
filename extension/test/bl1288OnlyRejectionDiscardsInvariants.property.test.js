'use strict';

const assert = require('node:assert/strict');
const fc = require('fast-check');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { mkTmpDir } = require('./helpers/tmpDir');

// BL-1288 declared invariants:
//
// 1. Local-ahead commits are discarded only when the remote REJECTED the
//    push; a push that could not be attempted or completed (remote
//    unreachable, no credentials, network down) never authorises a reset.
// 2. When a push failure decides the outcome, that push's own error text
//    reaches the caller's result - never replaced by the reset's error, nor
//    by an outcome name.
//
// Both drive the REAL rematch-with-push-first! in
// swarmforge/scripts/master_main_reconcile_lib.bb, through a thin batching
// harness. Nothing here re-implements the classifier: the oracle is the
// generator's own knowledge of which KIND of failure it built, so a property
// can never agree with the implementation merely by asking it twice.
//
// Why the generators build stderr rather than real pushes: these invariants
// quantify over the TEXT git emits when a push fails, and real git cannot be
// made to enumerate that space (there is no way to ask it for an arbitrary
// credential failure). The acceptance feature is where the same function
// meets a real remote, a real rejection and a real reset. Here the point is
// breadth over the string space, and every literal below is a shape git
// actually prints - the three transport and credential forms were captured
// from real `git push` runs while writing this ticket.
//
// Runs ONLY via `npm run test:properties`.

const REPO_ROOT = path.join(__dirname, '..', '..');
const HARNESS = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'test', 'lib', 'bl1288_push_classification_harness.bb');
const LIB = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'master_main_reconcile_lib.bb');

const RESET_ERROR = 'BL1288-RESET-ERROR-MUST-NOT-SURFACE';
const SAMPLES = 300;
const SEED = 20260830;

// ── generators ────────────────────────────────────────────────────────────
//
// Every case carries the `kind` that built it. `kind === 'rejection'` is the
// ONLY class that may authorise a discard, and the properties below read that
// field, never the error text, when deciding what to expect.

const refName = fc.constantFrom('main', 'HEAD', 'refs/heads/main', 'master');
const host = fc.constantFrom('example.invalid', 'nonexistent.invalid', 'git.example.com', '127.0.0.1');

// A genuine non-fast-forward rejection, in the two forms git uses, wrapped in
// the noise a real push prints around it.
const rejectionArb = fc
  .record({
    ref: refName,
    marker: fc.constantFrom('non-fast-forward', 'fetch first'),
    host,
    hint: fc.boolean(),
  })
  .map(({ ref, marker, host: h, hint }) => ({
    kind: 'rejection',
    pushSuccess: false,
    error:
      `To https://${h}/repo.git\n` +
      ` ! [rejected]        ${ref} -> ${ref} (${marker})\n` +
      `error: failed to push some refs to 'https://${h}/repo.git'` +
      (hint ? '\nhint: Updates were rejected because the remote contains work that you do not\nhint: have locally.' : ''),
  }));

// Failures where the push never reached a verdict from the remote. A reset on
// any of these destroys work over a problem on this end of the wire.
const transportArb = fc
  .record({ host, form: fc.integer({ min: 0, max: 3 }) })
  .map(({ host: h, form }) => ({
    kind: 'transport',
    pushSuccess: false,
    error: [
      `fatal: unable to access 'https://${h}/repo.git/': Could not resolve host: ${h}`,
      `fatal: unable to access 'https://${h}/repo.git/': Failed to connect to ${h} port 443 after 0 ms: Couldn't connect to server`,
      `ssh: connect to host ${h} port 22: Connection refused\nfatal: Could not read from remote repository.`,
      `fatal: unable to access 'https://${h}/repo.git/': Empty reply from server`,
    ][form],
  }));

const credentialArb = fc
  .record({ host, form: fc.integer({ min: 0, max: 2 }) })
  .map(({ host: h, form }) => ({
    kind: 'credential',
    pushSuccess: false,
    error: [
      `fatal: could not read Username for 'https://${h}': No such device or address`,
      `remote: Invalid username or password.\nfatal: Authentication failed for 'https://${h}/repo.git/'`,
      `git@${h}: Permission denied (publickey).\nfatal: Could not read from remote repository.\n\nPlease make sure you have the correct access rights\nand the repository exists.`,
    ][form],
  }));

// The remote refused, but for policy, not because local main diverged. A
// reset here would discard commits origin has no newer version of, so this
// must be kept - the reason the classifier asks for a non-fast-forward marker
// and not merely for the word "rejected".
const hookRejectionArb = fc.record({ ref: refName, host }).map(({ ref, host: h }) => ({
  kind: 'hook',
  pushSuccess: false,
  error:
    `To https://${h}/repo.git\n` +
    ` ! [remote rejected] ${ref} -> ${ref} (pre-receive hook declined)\n` +
    `error: failed to push some refs to 'https://${h}/repo.git'`,
}));

// Failures nobody has classified, plus the degenerate empty/absent ones. The
// fail-closed direction is the whole point: an unknown string must keep the
// commits, because the list of known transport errors can only ever be
// incomplete and its gaps would be paid for in destroyed work.
const unknownArb = fc
  .oneof(
    fc.constant(null),
    fc.constant(''),
    fc.constant('   '),
    fc.string({ minLength: 1, maxLength: 60 }).filter((s) => !s.toLowerCase().includes('[rejected]')),
  )
  .map((error) => ({ kind: 'unknown', pushSuccess: false, error }));

const successArb = fc.constant({ kind: 'success', pushSuccess: true, error: null });

const caseArb = fc.oneof(
  { weight: 3, arbitrary: rejectionArb },
  { weight: 3, arbitrary: transportArb },
  { weight: 3, arbitrary: credentialArb },
  { weight: 2, arbitrary: hookRejectionArb },
  { weight: 2, arbitrary: unknownArb },
  { weight: 1, arbitrary: successArb },
);

// ── harness ───────────────────────────────────────────────────────────────

function evaluate(cases, libPath = LIB) {
  const dir = mkTmpDir('bl1288-props-');
  try {
    const casesPath = path.join(dir, 'cases.json');
    fs.writeFileSync(casesPath, JSON.stringify(cases.map(({ pushSuccess, error }) => ({ pushSuccess, error }))));
    const env = { ...process.env };
    if (libPath !== LIB) env.BL1288_LIB_OVERRIDE = libPath;
    const run = spawnSync('bb', [libPath === LIB ? HARNESS : libPath, casesPath], { encoding: 'utf8', env });
    assert.equal(run.status, 0, `harness exited ${run.status}: ${run.stdout}${run.stderr}`);
    return JSON.parse(run.stdout.trim().split('\n').pop());
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function sampleCases() {
  return fc.sample(caseArb, { numRuns: SAMPLES, seed: SEED });
}

// The generator must demonstrably REACH every class the invariants quantify
// over - an asserted floor, never a hoped-for one. Without this, a generator
// that drifted to producing only successes would leave both properties
// passing while testing nothing.
function assertReachFloors(cases) {
  const counts = {};
  for (const c of cases) counts[c.kind] = (counts[c.kind] || 0) + 1;
  for (const kind of ['rejection', 'transport', 'credential', 'hook', 'unknown', 'success']) {
    assert.ok(
      (counts[kind] || 0) >= 10,
      `reach floor: only ${counts[kind] || 0} ${kind} cases in ${cases.length} - the generator is not reaching that state`
    );
  }
  // The empty/absent degenerate shapes are their own reach floor: they are
  // the ones a "did the error mention a known transport failure" classifier
  // would silently get wrong.
  const degenerate = cases.filter((c) => c.kind === 'unknown' && !String(c.error || '').trim()).length;
  assert.ok(degenerate >= 3, `reach floor: only ${degenerate} empty/absent error cases`);
  return counts;
}

describe('BL-1288: only a rejected push may authorise discarding local-ahead commits', () => {
  it('invariant 1: a discard follows a rejection and nothing else', () => {
    const cases = sampleCases();
    assertReachFloors(cases);
    const results = evaluate(cases);
    assert.equal(results.length, cases.length);

    cases.forEach((c, i) => {
      const r = results[i];
      const mayDiscard = c.kind === 'rejection';
      assert.equal(
        r.resetCalled,
        mayDiscard,
        `${c.kind} case ${mayDiscard ? 'did not reset' : 'RESET'}, error=${JSON.stringify(c.error)}`
      );
      if (!mayDiscard && c.kind !== 'success') {
        assert.equal(r.outcome, 'push-unavailable', `${c.kind} case reported ${r.outcome}`);
        assert.equal(r.success, false, `${c.kind} case reported success`);
      }
    });
  });

  it('invariant 2: a deciding push failure carries its own reason to the caller', () => {
    const cases = sampleCases();
    assertReachFloors(cases);
    const results = evaluate(cases);

    cases.forEach((c, i) => {
      const r = results[i];
      // Only the cases where a push FAILURE decided the outcome are in
      // scope: a success decides nothing by failing, and a rejection hands
      // the decision to reset!, whose result passes through verbatim by
      // BL-1198's unchanged contract.
      if (c.kind === 'success' || c.kind === 'rejection') return;
      assert.equal(r.error, c.error, `the push's own error text did not survive for a ${c.kind} case`);
      assert.notEqual(r.error, RESET_ERROR, "the reset's error displaced the push's");
      assert.notEqual(r.error, r.outcome, 'the outcome name displaced the push error text');
    });

    // A rejection's result is reset!'s own, verbatim - the BL-1198 path this
    // ticket must not move.
    const rejections = cases.map((c, i) => [c, results[i]]).filter(([c]) => c.kind === 'rejection');
    assert.ok(rejections.length > 0);
    for (const [, r] of rejections) {
      assert.equal(r.error, RESET_ERROR, "a rejection must pass reset!'s own result through untouched");
      assert.equal(r.outcome, 'rematch-bookkeeping');
    }
  });

  it('is non-vacuous: a classifier that trusts every failure is caught', () => {
    // The pre-BL-1288 implementation, restored exactly: fall to (reset!) on
    // every unsuccessful push. Both invariants must fail against it. Built by
    // patching a COPY of the real lib, so this stays honest if the real one
    // is refactored - nothing here hand-writes the mutant's behaviour.
    const dir = mkTmpDir('bl1288-mutant-');
    try {
      const source = fs.readFileSync(LIB, 'utf8');
      const guarded = '(push-rejection? (:error push-result)) (reset!)';
      assert.ok(source.includes(guarded), 'the classifier call site moved - this mutant no longer reconstructs the old behaviour');
      const mutantLib = path.join(dir, 'master_main_reconcile_lib.bb');
      fs.writeFileSync(mutantLib, source.replace(guarded, '(not (:success push-result)) (reset!)'));

      const mutantHarness = path.join(dir, 'harness.bb');
      fs.writeFileSync(
        mutantHarness,
        fs.readFileSync(HARNESS, 'utf8').replace(
          /\(load-file \(str \(fs\/path[^\n]*\n/,
          `(load-file "${mutantLib}")\n`
        )
      );

      const cases = sampleCases();
      const results = evaluate(cases, mutantHarness);

      const survived = cases.filter((c, i) => c.kind !== 'rejection' && c.kind !== 'success' && !results[i].resetCalled);
      assert.equal(
        survived.length,
        0,
        'the mutant did NOT reset on every failure, so it is not the pre-BL-1288 behaviour and proves nothing'
      );
      const wouldBeDestroyed = cases.filter((c, i) => c.kind !== 'rejection' && c.kind !== 'success' && results[i].resetCalled);
      assert.ok(
        wouldBeDestroyed.length >= 50,
        `the mutant destroyed work in only ${wouldBeDestroyed.length} cases - too few for this to be a meaningful oracle`
      );
      // And invariant 2's oracle catches it too: the reset's error surfaces.
      assert.ok(
        cases.some((c, i) => c.kind === 'transport' && results[i].error === RESET_ERROR),
        "the mutant did not surface the reset's error, so invariant 2's oracle would not flag it"
      );
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
