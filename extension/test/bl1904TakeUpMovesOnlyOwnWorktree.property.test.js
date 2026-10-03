'use strict';

// BL-1904 declared invariant (coder first authorship - BL-654):
//   "A take-up moves, resets or switches only the checkout registered for the
//    running role in roles.tsv; every other checkout's branch and HEAD are
//    left exactly as they were."
//
// Each draw builds a fresh fixture: BL-1904's own handler fixture, reused
// rather than copied. It has a bare origin and a main checkout, with linked
// worktrees for coder, coder@2 and QA, each registered in its own
// roles.tsv. The draw queues one git_handoff for a drawn role and runs the
// REAL ready_for_next_task.bb as that role from a drawn checkout. Afterwards
// every checkout except the role's own has the branch and HEAD it had
// before, and any parcel-backup ref written is under the running role.
//
// Collision candidates are constructed:
// - coder@2's worktree `.worktrees/coder2` has coder's `.worktrees/coder` as
//   a string prefix, so a prefix comparison would read each as the other's.
// - The cwd is drawn over every checkout and a subdirectory of each, so a
//   receive from inside a foreign worktree is as likely as one from inside
//   its own.
// - The parcel is either a commit no branch carries (a real move) or the
//   origin/main tip (BL-1887's fresh start), both of which move a checkout
//   that is not already there.
// Reach floor: a move of the role's own worktree and a refusal in a foreign
// one are each asserted to occur. Draws are few on purpose: each runs the real
// receive (about 3.3 s), and the four REACH_EXAMPLES carry the collisions.
//
// Non-vacuity: with ready_for_next_task.bb passing no :own-root, the first
// foreign draw fails ("moved ... from <role>") because QA's or coder@2's
// branch moves. Restored.
//
// Runs ONLY via `npm run test:properties`.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const fc = require('fast-check');
const { SUBPROCESS_HEAVY_TIMEOUT_MS } = require('./helpers/subprocessHeavyTimeout');
const { fixture } = require('../../specs/pipeline/steps/bl1904TakeUpMovesOnlyOwnWorktreeSteps');

const { makeFixture, git, state, backupRefs, parcelCommit, writeHandoff, runReceive } = fixture;

const OWN = { coder: 'coder', 'coder@2': 'coder2', QA: 'qa' };
const CHECKOUT_KEYS = ['coder', 'coder2', 'qa', 'root'];

function runDraw({ role, cwdKey, subdir, atMain }) {
  const fx = makeFixture();
  const commit = atMain ? git(fx.root, 'rev-parse', 'origin/main') : parcelCommit(fx, 'BL-9001');
  writeHandoff(fx, role, commit);
  let cwd = fx[cwdKey];
  if (subdir) {
    cwd = path.join(cwd, 'deep', 'sub');
    fs.mkdirSync(cwd, { recursive: true });
  }
  const before = Object.fromEntries(CHECKOUT_KEYS.map((k) => [k, state(fx[k])]));
  const refsBefore = backupRefs(fx);
  const res = runReceive(fx, role, cwd);
  assert.equal(res.status, 0, fx.out);
  assert.match(fx.out, /TASK:/, `the receive claimed nothing:\n${fx.out}`);

  const own = OWN[role];
  for (const k of CHECKOUT_KEYS) {
    if (k === own) continue;
    assert.deepEqual(state(fx[k]), before[k], `${k} moved from ${role} run in ${cwdKey}${subdir ? '/deep/sub' : ''}:\n${fx.out}`);
  }
  const newRefs = backupRefs(fx)
    .split('\n')
    .filter((r) => r && !refsBefore.split('\n').includes(r));
  for (const r of newRefs) assert.ok(r.startsWith(`refs/swarmforge/parcel-backup/${role}/`), `${r} from ${role}:\n${fx.out}`);

  if (cwdKey !== own) return 'refused';
  const moved = state(fx[own]).head !== before[own].head;
  return moved ? 'moved' : 'stayed';
}

const draw = fc.record({
  role: fc.constantFrom('coder', 'coder@2', 'QA'),
  cwdKey: fc.constantFrom(...CHECKOUT_KEYS),
  subdir: fc.boolean(),
  atMain: fc.boolean(),
});

const REACH_EXAMPLES = [
  [{ role: 'coder', cwdKey: 'coder', subdir: true, atMain: false }],
  [{ role: 'coder', cwdKey: 'coder2', subdir: false, atMain: false }],
  [{ role: 'coder@2', cwdKey: 'coder', subdir: true, atMain: false }],
  [{ role: 'QA', cwdKey: 'root', subdir: false, atMain: true }],
];

test(
  "BL-1904/BL-654 invariant: a take-up moves only the running role's own roles.tsv worktree",
  () => {
    const reach = { moved: 0, refused: 0, stayed: 0 };
    fc.assert(
      fc.property(draw, (d) => {
        reach[runDraw(d)] += 1;
      }),
      { numRuns: 3, examples: REACH_EXAMPLES }
    );
    assert.ok(reach.moved >= 1, `own move reached: ${JSON.stringify(reach)}`);
    assert.ok(reach.refused >= 1, `foreign refusal reached: ${JSON.stringify(reach)}`);
  },
  SUBPROCESS_HEAVY_TIMEOUT_MS
);
