'use strict';

// BL-1536's two DECLARED invariants (property authorship rests with the
// coder, first pass - BL-654). Runs ONLY via `npm run test:properties`
// (vitest.properties.config.mjs).
//
//   invariant 1  A git_handoff addressed to a role that precedes its sender
//                in roles.tsv pipeline order (a bounce) never carries
//                non-forwarding: true, whatever the sender's seat.
//   invariant 2  A last-pipeline-role git_handoff to a non-pipeline
//                recipient is still stamped terminal.
//
// Checked against the REAL swarm_handoff.bb / reverse_hop_lib.bb
// terminal-forward? - the single production implementation - never a
// reimplementation of the direction math beside it (that is exactly how
// BL-1536's own defect, sender-seat-only stamping, shipped looking correct
// under a runner that never actually asserted the direction decision).
//
// GENERATOR REACH (by construction, not by draw, per BL-654's own guidance
// on this failure mode): a purely random (sender, recipient) draw over a
// random roles table makes "recipient is earlier than sender" a rare event,
// and the BL-1536 defect only shows up in exactly that corner. Each case
// below therefore DERIVES its recipient from the sender's own position by
// the transformation this ticket is about, rather than drawing the two
// independently:
//   - terminal-no-bounce: recipient built OUTSIDE pipeline-roles entirely
//   - terminal-bounce:    recipient built as a role STRICTLY EARLIER than
//                         the (terminal) sender - the historical bug corner
//   - non-terminal:       sender built as a NON-terminal pipeline role
//   - multi-bounce:       one recipient outside pipeline-roles PLUS one
//                         earlier recipient, in the same to:
// The property only passes if all four arms actually ran (reach assertions
// at the end), so a generator regression that stops hitting one of them
// fails loudly instead of quietly losing coverage.

const assert = require('node:assert/strict');
const fc = require('fast-check');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { mkTmpDir } = require('./helpers/tmpDir');

const REPO_ROOT = path.join(__dirname, '..', '..');
const REVERSE_HOP_LIB = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'reverse_hop_lib.bb');
const FIXTURE_PREFIX = 'bl1536-property-';

// A pool bigger than any order this test builds, so shuffledSubarray always
// has enough distinct names to draw from.
const ROLE_POOL = ['r0', 'r1', 'r2', 'r3', 'r4', 'r5', 'r6', 'r7'];
const OUTSIDE_NAME = 'coordinator';

function tsvRow(role, worktree, root) {
  return [role, worktree, root, `swarmforge-${role}`, role, 'claude', 'task', 'off', 'forward-only'].join('\t');
}

// pipeline rows for `order`, plus OUTSIDE_NAME registered as a real
// master-resident row (worktree "master") - the realistic shape (the
// coordinator/specifier are rows in the live table, not simply absent),
// exercising master-resident-row? exclusion rather than a bare missing name.
function writeRolesTsv(root, order) {
  const dir = path.join(root, '.swarmforge');
  fs.mkdirSync(dir, { recursive: true });
  const lines = [...order.map((r) => tsvRow(r, r, root)), tsvRow(OUTSIDE_NAME, 'master', root)];
  fs.writeFileSync(path.join(dir, 'roles.tsv'), `${lines.join('\n')}\n`);
}

function terminalForward(root, sender, recipients) {
  const recipientsEdn = `[${recipients.map((r) => `"${r}"`).join(' ')}]`;
  const out = execFileSync(
    'bb',
    ['-e', `(load-file "${REVERSE_HOP_LIB}") (println (reverse-hop-lib/terminal-forward? (reverse-hop-lib/roles-lines "${root}") "${sender}" ${recipientsEdn}))`],
    { encoding: 'utf8' }
  ).trim();
  assert.ok(out === 'true' || out === 'false', `unexpected bb output: ${out}`);
  return out === 'true';
}

test('BL-1536/BL-654 invariant: the terminal stamp follows the hop\'s direction, never the sender\'s seat alone', { timeout: 120000 }, () => {
  const reach = { 'terminal-no-bounce': 0, 'terminal-bounce': 0, 'non-terminal': 0, 'multi-bounce': 0 };

  fc.assert(
    fc.property(
      fc.integer({ min: 2, max: ROLE_POOL.length }),
      fc.shuffledSubarray(ROLE_POOL, { minLength: ROLE_POOL.length, maxLength: ROLE_POOL.length }),
      fc.constantFrom('terminal-no-bounce', 'terminal-bounce', 'non-terminal', 'multi-bounce'),
      (n, shuffled, arm) => {
        const order = shuffled.slice(0, n);
        const lastRole = order[order.length - 1];
        const earlierRole = order[0]; // index 0 < n-1 whenever n >= 2, and distinct from lastRole

        const root = mkTmpDir(FIXTURE_PREFIX);
        try {
          writeRolesTsv(root, order);
          reach[arm] += 1;

          let sender;
          let recipients;
          let expected;

          switch (arm) {
            case 'terminal-no-bounce':
              // The terminal role's ordinary forward (QA -> coordinator's
              // shape): recipient is not in pipeline-roles at all.
              sender = lastRole;
              recipients = [OUTSIDE_NAME];
              expected = true;
              break;
            case 'terminal-bounce':
              // THE historical BL-1536 defect corner: the terminal role
              // addressing a strictly earlier pipeline role must never be
              // stamped, whatever the old sender-seat-only logic said.
              sender = lastRole;
              recipients = [earlierRole];
              expected = false;
              break;
            case 'non-terminal':
              // A non-terminal sender's git_handoff is never stamped,
              // whatever the recipient - a plain forward hop mid-pipeline.
              sender = earlierRole;
              recipients = [OUTSIDE_NAME];
              expected = false;
              break;
            case 'multi-bounce':
              // Any earlier recipient in a multi-recipient to: makes the
              // WHOLE parcel a bounce, even alongside a non-pipeline one.
              sender = lastRole;
              recipients = [OUTSIDE_NAME, earlierRole];
              expected = false;
              break;
            default:
              throw new Error(`unhandled arm: ${arm}`);
          }

          const actual = terminalForward(root, sender, recipients);
          assert.equal(
            actual,
            expected,
            `arm=${arm} sender=${sender} recipients=${JSON.stringify(recipients)} order=${JSON.stringify(order)}: expected terminal-forward?=${expected}, got ${actual}`
          );
          return true;
        } finally {
          fs.rmSync(root, { recursive: true, force: true });
        }
      }
    ),
    { numRuns: 40 }
  );

  for (const [arm, count] of Object.entries(reach)) {
    assert.ok(count > 0, `generator never reached arm "${arm}" - coverage silently lost`);
  }
});
