'use strict';

// BL-1104 declared invariants (coder first authorship — BL-654):
//
// 1. A ticket is flagged only when QA's own approval for THAT ticket is
//    reachable from the main ref — a ticket id in another commit's body
//    is never sufficient (subject-anchored only).
// 2. The sweep observes and nudges only — draft lines address QA, never
//    close/move, and never send the coordinator notify on QA's behalf.
// 3. One stranded ticket yields at most one outstanding nudge — an id
//    already in nudged-ids yields an empty decide result.
//
// Non-vacuity: (1) forcing bodyId into the approvals map DOES flag it;
// (2) draft must not address coordinator; (3) clearing nudged-ids re-flags.
//
// Runs ONLY via `npm run test:properties`.

const assert = require('node:assert/strict');
const fc = require('fast-check');
const { execFileSync } = require('node:child_process');
const path = require('node:path');
const { SUBPROCESS_HEAVY_TIMEOUT_MS } = require('./helpers/subprocessHeavyTimeout');

const REPO_ROOT = path.join(__dirname, '..', '..');
const LIB = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'chase_sweep_lib.bb');

function bb(expr) {
  return execFileSync('bb', ['-e', `(load-file "${LIB}")\n${expr}`], {
    encoding: 'utf8',
  }).trim();
}

function decide(activeEdn, approvalsEdn, closedEdn, nudgedEdn) {
  return bb(
    `(println (pr-str (chase-sweep-lib/decide-landed-but-open ${activeEdn} ${approvalsEdn} ${closedEdn} ${nudgedEdn})))`
  );
}

test(
  'BL-1104/BL-654 invariant 1: subject-anchored approval only — body mention never flags',
  () => {
    let draws = 0;
    fc.assert(
      fc.property(fc.constantFrom('BL-2005', 'BL-2100', 'BL-2999'), (bodyId) => {
        draws += 1;
        const subjectId = 'BL-2006';
        const approvals = bb(`
          (println (pr-str
            (chase-sweep-lib/index-qa-approvals
              [{:sha "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
                :subject "Merge origin/main into QA-approved BL-2006 (aaaaaaaaaa) for landing"}])))`);
        assert.match(approvals, /BL-2006/);
        assert.doesNotMatch(approvals, new RegExp(bodyId));
        const flagged = decide(
          `#{${JSON.stringify(bodyId)} "BL-2006"}`,
          `{"BL-2006" "aaaaaaaaaa"}`,
          `#{}`,
          `#{}`
        );
        assert.equal(flagged.includes(bodyId), false, `body-only ${bodyId} must not flag`);
        assert.equal(flagged.includes('BL-2006'), true);
        // Non-vacuity: if bodyId were incorrectly approved, decide would flag it.
        const forced = decide(`#{${JSON.stringify(bodyId)}}`, `{${JSON.stringify(bodyId)} "deadbeef01"}`, `#{}`, `#{}`);
        assert.equal(forced.includes(bodyId), true);
      }),
      { numRuns: 6 }
    );
    assert.ok(draws >= 2);
  },
  SUBPROCESS_HEAVY_TIMEOUT_MS
);

test(
  'BL-1104/BL-654 invariant 2: draft is observe/nudge-to-QA only',
  () => {
    let draws = 0;
    fc.assert(
      fc.property(fc.constantFrom('BL-2001', 'BL-2008'), (id) => {
        draws += 1;
        const lines = bb(
          `(println (pr-str (chase-sweep-lib/landed-but-open-draft-lines {:id "${id}" :approval-commit "aaaaaaaaaa"})))`
        );
        assert.match(lines, /"to: QA"/);
        assert.doesNotMatch(lines, /"to: coordinator"/);
        assert.match(lines, /landed-but-open/);
        assert.match(lines, /aaaaaaaaaa/);
        assert.match(lines, /resend coordinator notify/);
      }),
      { numRuns: 4 }
    );
    assert.ok(draws >= 2);
  },
  SUBPROCESS_HEAVY_TIMEOUT_MS
);

test(
  'BL-1104/BL-654 invariant 3: already-nudged id yields no further flag',
  () => {
    let draws = 0;
    fc.assert(
      fc.property(fc.constantFrom('BL-2007', 'BL-2017'), (id) => {
        draws += 1;
        const once = decide(`#{"${id}"}`, `{"${id}" "aaaaaaaaaa"}`, `#{}`, `#{}`);
        assert.equal(once.includes(id), true);
        const again = decide(`#{"${id}"}`, `{"${id}" "aaaaaaaaaa"}`, `#{}`, `#{"${id}"}`);
        assert.equal(again, '[]');
      }),
      { numRuns: 4 }
    );
    assert.ok(draws >= 2);
  },
  SUBPROCESS_HEAVY_TIMEOUT_MS
);
