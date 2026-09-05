'use strict';

const assert = require('node:assert/strict');
const {
  assessPerHatRolePromptEvidence,
  verdictHasRolePromptEvidence,
  PILOT_HAT_PROMPT_MISSING_REFUSAL,
} = require('../out/tools/perHatRolePromptEvidenceCheck');
const { landPilotedTicket } = require('../out/tools/pilotAcceptanceGate');
const { makeAcceptanceGateDeps } = require('./helpers/pilotAcceptanceGateDeps');

// BL-1229: built on the shared, contract-checked base
// (helpers/pilotAcceptanceGateDeps.js) - only this file's own overrides
// are listed here now.
function mkDeps(overrides) {
  const calls = { move: 0, writeReceipt: 0 };
  const deps = makeAcceptanceGateDeps({
    checkCommitClaims: () => ({ checked: true, commitsChecked: 0 }),
    moveTicketToDone: () => {
      calls.move += 1;
      return { moved: true, destination: '/repo/backlog/done/x.yaml' };
    },
    writeReceipt: () => {
      calls.writeReceipt += 1;
    },
    getLandedCommit: () => 'a'.repeat(40),
    now: () => '2026-08-26T00:00:00.000Z',
    ...overrides,
  });
  return {
    deps,
    calls,
  };
}

const HASH = 'a'.repeat(64);

test('verdictHasRolePromptEvidence requires path and 64-hex hash', () => {
  assert.equal(
    verdictHasRolePromptEvidence({
      verdictPath: 'v.json',
      role_prompt_path: 'swarmforge/roles/coder.prompt',
      role_prompt_sha256: HASH,
    }),
    true
  );
  assert.equal(
    verdictHasRolePromptEvidence({
      verdictPath: 'v.json',
      role_prompt_path: 'swarmforge/roles/coder.prompt',
    }),
    false
  );
});

test('assessPerHatRolePromptEvidence refuses missing fields', () => {
  const result = assessPerHatRolePromptEvidence({
    verdicts: [
      {
        verdictPath: '.swarmforge/expedite/BL-758/01-coder/verdict.json',
        role: 'coder',
        role_prompt_path: 'swarmforge/roles/coder.prompt',
      },
    ],
  });
  assert.ok(result.miss);
  assert.equal(result.miss.role, 'coder');
});

test('assessPerHatRolePromptEvidence passes complete verdicts', () => {
  const result = assessPerHatRolePromptEvidence({
    verdicts: [
      {
        verdictPath: 'v.json',
        role: 'coder',
        role_prompt_path: 'swarmforge/roles/coder.prompt',
        role_prompt_sha256: HASH,
      },
    ],
  });
  assert.deepEqual(result, { checked: true, verdictsScanned: 1 });
});

test('assessPerHatRolePromptEvidence fails open when verdicts are undefined', () => {
  assert.deepEqual(assessPerHatRolePromptEvidence({ verdicts: undefined }), { checked: false });
});

test('assessPerHatRolePromptEvidence no-ops on empty verdict list', () => {
  assert.deepEqual(assessPerHatRolePromptEvidence({ verdicts: [] }), {
    checked: true,
    verdictsScanned: 0,
  });
});

test('verdictHasRolePromptEvidence rejects empty path and non-64-hex hash', () => {
  assert.equal(
    verdictHasRolePromptEvidence({
      verdictPath: 'v.json',
      role_prompt_path: '   ',
      role_prompt_sha256: HASH,
    }),
    false
  );
  assert.equal(
    verdictHasRolePromptEvidence({
      verdictPath: 'v.json',
      role_prompt_path: 'swarmforge/roles/coder.prompt',
      role_prompt_sha256: 'abc',
    }),
    false
  );
  assert.equal(
    verdictHasRolePromptEvidence({
      verdictPath: 'v.json',
      role_prompt_path: 'swarmforge/roles/coder.prompt',
      role_prompt_sha256: 'g'.repeat(64),
    }),
    false
  );
});

test('landPilotedTicket refuses pilot-hat-prompt-missing inertly', async () => {
  const { deps, calls } = mkDeps({
    checkPerHatRolePromptEvidence: () => ({
      checked: true,
      verdictsScanned: 1,
      miss: {
        verdictPath: '.swarmforge/expedite/BL-758/01-coder/verdict.json',
        role: 'coder',
      },
    }),
  });
  const outcome = await landPilotedTicket('BL-758', deps);
  assert.equal(outcome.landed, false);
  assert.equal(outcome.reasonKind, 'pilot-hat-prompt-missing');
  assert.match(outcome.reason, new RegExp(PILOT_HAT_PROMPT_MISSING_REFUSAL));
  assert.match(outcome.reason, /coder/);
  assert.equal(calls.move, 0);
  assert.equal(calls.writeReceipt, 0);
});
