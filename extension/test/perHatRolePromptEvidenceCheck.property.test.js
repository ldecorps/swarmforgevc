'use strict';

const assert = require('node:assert/strict');
const fc = require('fast-check');
const {
  assessPerHatRolePromptEvidence,
  PILOT_HAT_PROMPT_MISSING_REFUSAL,
} = require('../out/tools/perHatRolePromptEvidenceCheck');
const { landPilotedTicket } = require('../out/tools/pilotAcceptanceGate');
const { makeAcceptanceGateDeps } = require('./helpers/pilotAcceptanceGateDeps');

// BL-758 invariant 3: completed stage verdicts require role_prompt_path +
// role_prompt_sha256 or land refuses pilot-hat-prompt-missing (inert).

const roleArb = fc.constantFrom('specifier', 'coder', 'cleaner', 'architect');
const hashArb = fc
  .array(fc.constantFrom(...'0123456789abcdef'.split('')), { minLength: 64, maxLength: 64 })
  .map((chars) => chars.join(''));

// BL-1229: built on the shared, contract-checked base
// (helpers/pilotAcceptanceGateDeps.js) - only this file's own overrides
// are listed here now.
function mkDeps(outcome) {
  const calls = { move: 0, receipt: 0 };
  return {
    calls,
    deps: makeAcceptanceGateDeps({
      checkCommitClaims: () => ({ checked: true, commitsChecked: 0 }),
      checkPerHatRolePromptEvidence: () => outcome,
      moveTicketToDone: () => {
        calls.move += 1;
        return { moved: true, destination: '/repo/backlog/done/x.yaml' };
      },
      writeReceipt: () => {
        calls.receipt += 1;
      },
      getLandedCommit: () => 'a'.repeat(40),
      now: () => '2026-08-26T00:00:00.000Z',
    }),
  };
}

test('property: missing path or hash always yields a miss', () => {
  fc.assert(
    fc.property(roleArb, hashArb, fc.boolean(), (role, hash, omitHash) => {
      const verdict = {
        verdictPath: `01-${role}/verdict.json`,
        role,
        role_prompt_path: `swarmforge/roles/${role}.prompt`,
        role_prompt_sha256: omitHash ? undefined : hash,
      };
      if (!omitHash) {
        verdict.role_prompt_path = '';
      }
      const result = assessPerHatRolePromptEvidence({ verdicts: [verdict] });
      assert.ok(result.miss);
    }),
    { numRuns: 40 }
  );
});

test('property: complete path+hash never yields a miss', () => {
  fc.assert(
    fc.property(roleArb, hashArb, (role, hash) => {
      const result = assessPerHatRolePromptEvidence({
        verdicts: [
          {
            verdictPath: `01-${role}/verdict.json`,
            role,
            role_prompt_path: `swarmforge/roles/${role === 'qa' ? 'QA' : role}.prompt`,
            role_prompt_sha256: hash,
          },
        ],
      });
      assert.equal(result.miss, undefined);
    }),
    { numRuns: 40 }
  );
});

test('property: land refuses pilot-hat-prompt-missing inertly', async () => {
  await fc.assert(
    fc.asyncProperty(roleArb, async (role) => {
      const { deps, calls } = mkDeps({
        checked: true,
        verdictsScanned: 1,
        miss: { verdictPath: `01-${role}/verdict.json`, role },
      });
      const outcome = await landPilotedTicket('BL-758', deps);
      assert.equal(outcome.landed, false);
      assert.equal(outcome.reasonKind, 'pilot-hat-prompt-missing');
      assert.match(outcome.reason, new RegExp(PILOT_HAT_PROMPT_MISSING_REFUSAL));
      assert.equal(calls.move, 0);
      assert.equal(calls.receipt, 0);
    }),
    { numRuns: 20 }
  );
});

test('non-vacuity: missing-evidence property would fail if assessor always returned ok', () => {
  const broken = { checked: true, verdictsScanned: 1 };
  const real = assessPerHatRolePromptEvidence({
    verdicts: [{ verdictPath: 'v.json', role: 'coder' }],
  });
  assert.ok(real.miss);
  assert.notDeepEqual(broken, real);
});
