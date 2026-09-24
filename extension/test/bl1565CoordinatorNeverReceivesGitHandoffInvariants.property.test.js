'use strict';

// BL-1565 declared invariant:
//
//   "No git_handoff parcel is ever written under the coordinator's
//   inbox/new/, whatever the sender, the required_stages routing, or the
//   reverse-hop mode of the sending window."
//
// Two production mechanisms could each put a git_handoff parcel in the
// coordinator's mailbox, and this ticket's own fix only closes one of them
// by name (a new send-time guard on the FORWARD `to:` and the post-routing
// recipient set). The reverse-hop mechanism (reverse_hop_lib.bb, BL-1299)
// is pre-existing production code that already structurally excludes the
// coordinator from any reverse copy - this property exercises that
// exclusion under random draws too, so the invariant's "whatever ... the
// reverse-hop mode" clause is not just asserted by inspection.
//
// Both properties drive the REAL babashka libraries this ticket and
// BL-1299 ship - git_handoff_recipient_guard_lib.bb's decide and
// reverse_hop_lib.bb's reverse-recipients - never a re-implementation of
// either's logic in JS (a second copy is exactly how BL-1536's own defect,
// caught by this same family of invariant, came to look correct under a
// runner that never drove the production function).
//
// Runs ONLY via `npm run test:properties`.

const assert = require('node:assert/strict');
const fc = require('fast-check');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { assertReachFloor, runsPerCell } = require('./helpers/reachFloors');

const REPO_ROOT = path.join(__dirname, '..', '..');
const GUARD_LIB = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'git_handoff_recipient_guard_lib.bb');
const REVERSE_HOP_LIB = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'reverse_hop_lib.bb');
const BB = process.env.BB_BIN || 'bb';

function ednStrings(list) {
  return `[${list.map((s) => `"${s}"`).join(' ')}]`;
}

function bbEval(script) {
  const result = execFileSync(BB, ['-e', script], { encoding: 'utf8' });
  return result.trim();
}

function decide(type, recipients) {
  return bbEval(
    `(load-file "${GUARD_LIB}") (println (name (:decision (git-handoff-recipient-guard-lib/decide {:type "${type}" :recipients ${ednStrings(recipients)}}))))`
  );
}

// A small dedicated parser for a `(pr-str <vector-of-strings>)` result -
// role names are plain identifiers, so this never needs to handle escapes.
function parseEdnStringVector(text) {
  const trimmed = text.trim();
  if (trimmed === '[]') return [];
  const inner = trimmed.slice(1, -1);
  const matches = inner.match(/"([^"]*)"/g) || [];
  return matches.map((m) => m.slice(1, -1));
}

function reverseRecipientsOf(lines, sender, mode) {
  const out = bbEval(
    `(load-file "${REVERSE_HOP_LIB}") (println (pr-str (reverse-hop-lib/reverse-recipients ${ednStrings(lines)} "${sender}" "${mode}")))`
  );
  return parseEdnStringVector(out);
}

const ROLE_POOL = ['coder', 'cleaner', 'architect', 'hardender', 'documenter', 'QA'];
const MASTER_RESIDENT_POOL = ['coordinator', 'specifier'];

function rolesTsvLine(role, { master } = {}) {
  const worktree = master ? 'master' : role;
  const wtPath = master ? '/repo' : `/repo/.worktrees/${role}`;
  return [role, worktree, wtPath, `swarmforge-${role}`, role, 'claude', 'task'].join('\t');
}

test('BL-1565 invariant: a git_handoff naming the coordinator is always refused, whatever the sender, the other recipients, or their order', () => {
  fc.assert(
    fc.property(
      fc.constantFrom('git_handoff', 'note', 'awake', 'rule_proposal'),
      fc.constantFrom(...ROLE_POOL, 'specifier', 'coordinator', 'some-unknown-role'),
      fc.array(fc.constantFrom(...ROLE_POOL, 'specifier'), { minLength: 0, maxLength: 4 }),
      fc.boolean(),
      fc.nat({ max: 4 }),
      (type, sender, otherRecipients, includeCoordinator, insertAt) => {
        const recipients = [...otherRecipients];
        let expectRefuse = false;
        if (includeCoordinator) {
          const at = Math.min(insertAt, recipients.length);
          recipients.splice(at, 0, 'coordinator');
          expectRefuse = type === 'git_handoff';
        }
        if (recipients.length === 0) recipients.push('some-role'); // decide requires >=1 recipient in practice

        const result = decide(type, recipients);
        assert.equal(
          result,
          expectRefuse ? 'refuse' : 'allow',
          `decide(${type}, [${recipients.join(',')}]) from sender "${sender}" returned "${result}", expected "${expectRefuse ? 'refuse' : 'allow'}"`
        );
      }
    ),
    { numRuns: 100 }
  );
});

test('BL-1565 invariant: reverse-hop copies never address the coordinator (nor any master-resident role), whatever the pipeline order, sender, or propagation mode', () => {
  fc.assert(
    fc.property(
      fc.shuffledSubarray(ROLE_POOL, { minLength: 1, maxLength: ROLE_POOL.length }),
      fc.subarray(MASTER_RESIDENT_POOL),
      fc.constantFrom(...ROLE_POOL, 'coordinator', 'specifier', 'not-a-real-role'),
      fc.constantFrom('forward-only', 'back-one', 'back-all', 'typo-mode', ''),
      (order, masterResident, sender, mode) => {
        const lines = [
          ...order.map((r) => rolesTsvLine(r)),
          ...masterResident.map((r) => rolesTsvLine(r, { master: true })),
        ];
        const recipients = reverseRecipientsOf(lines, sender, mode);

        for (const role of MASTER_RESIDENT_POOL) {
          assert.ok(
            !recipients.includes(role),
            `reverse-recipients(order=[${order.join(',')}], sender=${sender}, mode=${mode}) wrongly includes master-resident role "${role}": [${recipients.join(',')}]`
          );
        }
        // reach: every returned recipient is a real pipeline role from `order`
        for (const r of recipients) {
          assert.ok(order.includes(r), `reverse-recipients returned "${r}" which is not in the pipeline order [${order.join(',')}]`);
        }
      }
    ),
    { numRuns: 100 }
  );
});

test('BL-1565 non-vacuity floor: the generator reaches both a refused git_handoff and an allowed one', () => {
  // BL-1691: two cells (includeCoordinator fixed per cell) rather than a
  // single fc.boolean() draw.
  const CELLS = [true, false];
  const PER_CELL_RUNS = runsPerCell(20, CELLS.length);
  const seen = { refuse: 0, allow: 0 };
  for (const includeCoordinatorCell of CELLS) {
    fc.assert(
      fc.property(
        fc.constantFrom('git_handoff'),
        fc.constant(includeCoordinatorCell),
        (type, includeCoordinator) => {
          const recipients = includeCoordinator ? ['coordinator', 'architect'] : ['architect', 'cleaner'];
          const result = decide(type, recipients);
          seen[result] += 1;
        }
      ),
      { numRuns: PER_CELL_RUNS }
    );
  }
  assertReachFloor(seen, ['refuse', 'allow'], PER_CELL_RUNS, 'decision');
});
