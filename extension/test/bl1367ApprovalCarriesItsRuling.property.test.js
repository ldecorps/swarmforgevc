'use strict';

// BL-1367: PROPERTY tests over the three invariants the ticket YAML declares
// (coder-authored first, per BL-654).
//
//   P1 never-approved-with-the-choice-unanswered - for every ticket declaring
//      ruling_options, the pair (classification, writer) either records the
//      approval WITH a ruling or records nothing at all. The half-recorded
//      state - approved, choice unknown - is unreachable.
//   P2 an-existing-ruling-is-never-disturbed - no approval from any surface,
//      with or without a ruling of its own, overwrites or clears a ruling
//      already on the ticket except by replacing it with a declared option the
//      human just chose.
//   P3 a-ticket-posing-no-choice-is-untouched - a ticket declaring no options
//      approves exactly as it did before this ticket, and gains no ruling.
//
// GENERATOR REACH is asserted, not hoped for. A ruling drawn independently of
// the options would match one essentially never, so the accepted case - the
// only one that writes a ruling at all - is CONSTRUCTED: the chosen label is
// drawn FROM the generated option list. The run records which outcomes it
// reached and fails if any was never generated.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const fc = require('fast-check');
const { mkTmpDir } = require('./helpers/tmpDir');
const {
  classifyApprovalRulingRequirement,
  recordApprovalReply,
  readRecordedRuling,
} = require('../out/concierge/pendingApprovalReply');

const optionArb = fc
  .stringMatching(/^[a-z][a-z0-9 ]{2,20}$/)
  .map((s) => s.trim())
  .filter((s) => s.length > 2);

const optionsArb = fc.uniqueArray(optionArb, { minLength: 1, maxLength: 4 });

function writeTicket(dir, id, body) {
  const activeDir = path.join(dir, 'backlog', 'active');
  fs.mkdirSync(activeDir, { recursive: true });
  fs.writeFileSync(path.join(activeDir, `${id}.yaml`), body);
  return path.join(activeDir, `${id}.yaml`);
}

function ticketYaml({ options, existingRuling }) {
  return [
    'id: BL-9367',
    'title: fixture',
    'human_approval: pending',
    ...(existingRuling ? ['human_ruling: |', `  ${existingRuling}`] : []),
    ...(options.length ? ['ruling_options:', ...options.map((o) => `  - ${o}`)] : []),
    '',
  ].join('\n');
}

// The surface's whole behaviour, as the route composes it: ask, then write or
// refuse. Modelled here rather than reaching into the HTTP route so the
// property quantifies over the DECISION, which is the thing every surface
// shares.
function approveThroughASurface(dir, { options, ruling }) {
  const requirement = classifyApprovalRulingRequirement(options.length ? options : undefined, ruling);
  if (requirement.kind !== 'ok') {
    return { recorded: false, requirement };
  }
  return { recorded: recordApprovalReply(dir, 'BL-9367', ruling), requirement };
}

const reached = new Set();

test('BL-1367 P1/P2/P3: an approval either carries its ruling or is not recorded', () => {
  fc.assert(
    fc.property(
      optionsArb,
      fc.boolean(),
      fc.boolean(),
      fc.option(fc.string({ minLength: 1, maxLength: 12 }), { nil: undefined }),
      (options, declaresOptions, choosesDeclared, freeRuling) => {
        const declared = declaresOptions ? options : [];
        // CONSTRUCTED, never drawn beside them: the accepted case is reachable
        // only if the chosen label comes FROM the option list.
        const ruling = choosesDeclared ? declared[0] : freeRuling;
        const existingRuling = 'an answer given earlier';

        const dir = mkTmpDir('bl1367-prop-');
        try {
          const filePath = writeTicket(dir, 'BL-9367', ticketYaml({ options: declared, existingRuling }));
          const before = fs.readFileSync(filePath, 'utf8');
          const { recorded, requirement } = approveThroughASurface(dir, { options: declared, ruling });
          const after = fs.readFileSync(filePath, 'utf8');
          reached.add(`${declared.length ? 'options' : 'no-options'}:${requirement.kind}`);

          const approved = /^human_approval: approved$/m.test(after);
          const recordedRuling = readRecordedRuling(dir, 'BL-9367');

          // ── P1 ────────────────────────────────────────────────────────
          if (declared.length && approved) {
            assert.ok(
              recordedRuling && recordedRuling.trim().length > 0,
              `a ticket declaring options was approved with no ruling: ${after}`
            );
          }
          if (!recorded) {
            assert.equal(before, after, `a refused approval still wrote to the ticket: ${after}`);
          }

          // ── P2 ────────────────────────────────────────────────────────
          // The only thing that may replace a recorded ruling is a declared
          // option the human just chose. Nothing else may disturb it.
          if (recordedRuling !== existingRuling) {
            assert.ok(
              declared.length > 0 && typeof ruling === 'string' && declared.includes(ruling),
              `an existing ruling changed without a declared option being chosen: ${JSON.stringify(recordedRuling)}`
            );
          }
          assert.ok(
            recordedRuling && recordedRuling.trim().length > 0,
            'a recorded ruling was cleared outright'
          );

          // ── P3 ────────────────────────────────────────────────────────
          if (!declared.length) {
            // A ticket posing no choice: a bare approval always goes through,
            // and a ruling nobody offered never does.
            if (!ruling) {
              assert.equal(recorded, true, 'a ticket posing no choice failed to approve');
              assert.equal(requirement.kind, 'ok');
            } else {
              assert.equal(requirement.kind, 'unknown-option');
              assert.equal(recorded, false);
            }
          }
        } finally {
          fs.rmSync(dir, { recursive: true, force: true });
        }
      }
    ),
    { numRuns: 200 }
  );

  // The reachability floor: each outcome must actually have been generated, or
  // the property above asserted on a narrower world than it claims.
  for (const outcome of [
    'options:ok',
    'options:ruling-required',
    'options:unknown-option',
    'no-options:ok',
    'no-options:unknown-option',
  ]) {
    assert.ok(reached.has(outcome), `generator reach: ${outcome} was never generated`);
  }
});

test('BL-1367 P3: a ticket posing no choice gains no ruling, ever', () => {
  fc.assert(
    fc.property(fc.boolean(), (hasExistingRuling) => {
      const dir = mkTmpDir('bl1367-prop-noopts-');
      try {
        const filePath = writeTicket(
          dir,
          'BL-9367',
          ticketYaml({ options: [], existingRuling: hasExistingRuling ? 'an answer given earlier' : undefined })
        );
        assert.equal(recordApprovalReply(dir, 'BL-9367'), true);
        const after = fs.readFileSync(filePath, 'utf8');
        assert.match(after, /^human_approval: approved$/m);
        assert.equal(
          /human_ruling/.test(after),
          hasExistingRuling,
          'a plain approval neither invented a ruling nor removed one'
        );
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    }),
    { numRuns: 40 }
  );
});
