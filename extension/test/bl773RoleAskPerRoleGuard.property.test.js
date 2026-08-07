const assert = require('node:assert/strict');
const fc = require('fast-check');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..');
const ROLE_ASK_CLI = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'role_ask.bb');

// BL-773 invariant 2 (coder.prompt's Invariants section - first authorship
// rests with the coder): "The one-pending guard is per role: one role's
// outstanding question can never refuse, consume, or clear another role's."
// Drives the REAL role_ask.bb CLI (the guard lives entirely in that
// script, not a TS module) against randomly generated DISTINCT role-name
// pairs, proving the guard's role-scoping generalizes beyond the two
// example roles (specifier/coordinator) the ticket's own acceptance
// scenario hardcodes.
//
// Invariant 1 ("a question is answerable in exactly one place... no
// second pending-question or answer store") has NO separate property-test
// encoding here - stated reason: it is a structural/call-graph claim about
// which code paths exist and are invoked (no second write path anywhere
// in the delivery adapters), not a data-transformation property over
// generated inputs that a property test would meaningfully strengthen.
// It is fully covered by BL-773-coordinator-role-ask-03's acceptance
// scenario ("no second answer channel is written"), which already asserts
// the exact adapter-call absence this property would otherwise just
// re-assert with random noise instead of real inputs.
//
// Non-vacuity, checked by hand before landing: commenting out role_ask.bb's
// own `(fs/exists? awaiting-file)` guard (simulating the exact regression
// this invariant catches - the per-role refusal silently stops refusing)
// reproduced the failure the second property below is built to catch: a
// second ask for the SAME role no longer returned asked=false, and
// restoring the guard made it pass again.

function mkTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sfvc-bl773-guard-'));
}

function runRoleAsk(root, role, question) {
  const out = execFileSync('bb', [ROLE_ASK_CLI, root, '--role', role, '--question', question], { encoding: 'utf8' });
  return JSON.parse(out);
}

function pendingFilePath(root, role) {
  return path.join(root, '.swarmforge', 'operator', 'role-awaiting', `${role}.json`);
}

const roleNameArb = fc.stringMatching(/^[a-z][a-z0-9-]{2,14}$/);
const questionArb = fc.string({ minLength: 1, maxLength: 30 }).filter((s) => s.trim().length > 0);

test('property: a different role\'s ask is always accepted, and the first role\'s own pending record is left untouched', () => {
  fc.assert(
    fc.property(roleNameArb, roleNameArb, questionArb, questionArb, (roleA, roleB, questionA, questionB) => {
      fc.pre(roleA !== roleB);
      const root = mkTmp();
      const firstAsk = runRoleAsk(root, roleA, questionA);
      assert.equal(firstAsk.asked, true, 'expected the first ask to succeed on a fresh root');
      const firstPendingBefore = fs.readFileSync(pendingFilePath(root, roleA), 'utf8');

      const secondAsk = runRoleAsk(root, roleB, questionB);
      assert.equal(secondAsk.asked, true, "expected a DIFFERENT role's ask accepted despite roleA's pending question");

      const firstPendingAfter = fs.readFileSync(pendingFilePath(root, roleA), 'utf8');
      assert.equal(firstPendingAfter, firstPendingBefore, "expected roleA's own pending record untouched by roleB's unrelated ask");
    }),
    { numRuns: 15 }
  );
});

test('property: the SAME role\'s second ask is always refused while its first is pending, and the first record is untouched', () => {
  fc.assert(
    fc.property(roleNameArb, questionArb, questionArb, (role, questionOne, questionTwo) => {
      const root = mkTmp();
      const firstAsk = runRoleAsk(root, role, questionOne);
      assert.equal(firstAsk.asked, true);
      const firstPendingBefore = fs.readFileSync(pendingFilePath(root, role), 'utf8');

      const secondAsk = runRoleAsk(root, role, questionTwo);
      assert.equal(secondAsk.asked, false);
      assert.equal(secondAsk.reason, 'already-pending');

      const firstPendingAfter = fs.readFileSync(pendingFilePath(root, role), 'utf8');
      assert.equal(firstPendingAfter, firstPendingBefore, 'expected the first pending record byte-identical after a refused second ask for the SAME role');
    }),
    { numRuns: 15 }
  );
});
