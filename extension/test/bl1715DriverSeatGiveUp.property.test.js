'use strict';

// BL-1715's two declared invariants.
//
// Invariant 1 ("A parcel a driver seat gives up is worked next by a
// non-driver seat of the same stage, with no deferral to the seat that
// gave up, and that seat never claims the ticket again while it is in the
// stage"): the claim-time decisions it reduces to are pure over the
// filesystem they're handed - has-non-driver-sibling? (roles.tsv) and
// handoff_lib.bb's worked-task-names-in/given-up-task-names-in exclusion
// (the completed-handoff outcome/outcome_seat markers) - exercised here
// across generated populations, never just the acceptance feature's one
// fixed two-seat fixture.
//
// Invariant 2 ("Every parcel a driver seat ends - handed off, given up or
// escalated - leaves exactly one outcome row, and a given-up attempt
// leaves nothing of itself in the local seat's tree"): the outcome-row
// half quantifies over the real dispatch through real git/seat
// subprocesses across three terminal shapes - not a pure module a
// generator can drive; same disposition BL-1697/1698's own invariant 2
// recorded, encoded instead by the acceptance feature's scenarios 01/04
// (BL-1715-a-driver-seat-that-fails-a-parcel-hands-it-to-its-stages-claude-seat.feature)
// and BL-1778's own feature's scenario 03, which run the real driver end
// to end for handed-off, given-up and escalated alike. The tree-revert
// half IS a pure-enough module (revert-attempt-commits!, over a real
// throwaway git repo) and is property-tested below - REPLACING the
// pre-BL-1778 property here, which asserted the tree returns to
// pre-claim-head (revert-to-pre-claim!'s own old contract, now retired: it
// also reverted the claim's own merges and everything they brought in,
// the exact defect BL-1778 fixes). The two BL-1778 invariants instead:
// (1) only the attempt's own first-parent, non-merge commits after
// post-merge-head are reverted, never a merge commit and never anything
// reachable from post-merge-head; (2) the tree after a give-up equals the
// tree at post-merge-head. Generated over BOTH axes the ticket's own "How"
// names: a main merge or none, and the received commit merged as a merge
// commit or as a fast-forward - each combination reached by construction
// (assertReachFloor), never merely hoped for by a uniform draw - alongside
// a generated attempt chain (0-4 plain commits, matching drive-tick!'s own
// shape: a driver seat's own fix-turn commits are always plain, never a
// merge, so the generator never draws one for the attempt itself).

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const fc = require('fast-check');
const { execFileSync } = require('node:child_process');
const { mkTmpDir } = require('./helpers/tmpDir');
const { assertReachFloor } = require('./helpers/reachFloors');

const LIB = path.join(__dirname, '..', '..', 'swarmforge', 'scripts', 'local_parcel_driver_lib.bb');
const HANDOFF_LIB = path.join(__dirname, '..', '..', 'swarmforge', 'scripts', 'handoff_lib.bb');
const FIXTURE_PREFIX = 'bl1715-giveup-';

function bbEval(loadFile, expr) {
  const out = execFileSync('bb', ['-e', `(load-file "${loadFile}") ${expr}`], { encoding: 'utf8' });
  return out.trim();
}

function git(root, args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' });
}

// ── Invariant 1a: has-non-driver-sibling? ─────────────────────────────────

const agentArb = fc.constantFrom('claude', 'aider', 'grok', 'codex', 'gemini');

// driver-seat? (and therefore has-non-driver-sibling?) is scoped to the
// "coder" stage by construction (driving-roles is the fixed set #{"coder"}
// - out of scope for any other role per the ticket's own text): an
// unrelated stage's row is NEVER driver-capable regardless of its agent,
// so the roster's OWN stage must be "coder" for this property to say
// anything about the real decision - not an arbitrary generated name.
const rosterArb = fc.record({
  stage: fc.constant('coder'),
  otherStage: fc.constant('cleaner'),
  seatCount: fc.integer({ min: 1, max: 4 }),
  agents: fc.array(agentArb, { minLength: 1, maxLength: 4 }),
});

test('invariant 1a: has-non-driver-sibling? is true iff some OTHER seat of the same stage has a non-driver agent, across generated rosters', () => {
  fc.assert(
    fc.property(rosterArb, ({ stage, otherStage, seatCount, agents }) => {
      const root = mkTmpDir(FIXTURE_PREFIX);
      try {
        fs.mkdirSync(path.join(root, '.swarmforge'), { recursive: true });
        const seats = [];
        for (let i = 0; i < seatCount; i += 1) {
          const role = i === 0 ? stage : `${stage}@${i + 1}`;
          const agent = agents[i % agents.length];
          seats.push({ role, agent });
        }
        // An unrelated stage's row must never influence the decision.
        seats.push({ role: otherStage, agent: 'claude' });
        const lines = seats.map((s) => [s.role, 'wt', root, 'sess', 'Display', s.agent, 'task'].join('\t'));
        fs.writeFileSync(path.join(root, '.swarmforge', 'roles.tsv'), lines.join('\n') + '\n');

        const me = seats[0].role;
        const expected = seats
          .slice(1, seatCount)
          .some((s) => s.agent !== 'aider');
        const raw = bbEval(LIB, `(println (local-parcel-driver-lib/has-non-driver-sibling? "${root}" "${me}"))`);
        assert.equal(raw, String(expected), `roster ${JSON.stringify(seats)} me=${me}: expected ${expected}, got ${raw}`);
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    }),
    { numRuns: 40 }
  );
});

test('non-vacuous: has-non-driver-sibling? is false for a bare single-seat stage (no sibling row at all)', () => {
  const root = mkTmpDir(FIXTURE_PREFIX);
  try {
    fs.mkdirSync(path.join(root, '.swarmforge'), { recursive: true });
    fs.writeFileSync(
      path.join(root, '.swarmforge', 'roles.tsv'),
      ['coder', 'wt', root, 'sess', 'Coder', 'aider', 'task'].join('\t') + '\n'
    );
    const raw = bbEval(LIB, `(println (local-parcel-driver-lib/has-non-driver-sibling? "${root}" "coder"))`);
    assert.equal(raw, 'false', 'expected no sibling to mean no give-up branch');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// ── Invariant 1b: the given-up marker excludes from "worked", and is
// seat-specific for the never-again rule ──────────────────────────────────

function writeHandoff(dir, name, { task, outcome, outcomeSeat }) {
  fs.mkdirSync(dir, { recursive: true });
  const lines = ['type: git_handoff', 'from: specifier', 'to: coder', 'priority: 50', `task: ${task}`, 'commit: abc1234567'];
  if (outcome) lines.push(`outcome: ${outcome}`);
  if (outcomeSeat) lines.push(`outcome_seat: ${outcomeSeat}`);
  fs.writeFileSync(path.join(dir, name), lines.join('\n') + '\n\nmerge_and_process specifier abc1234567\n');
}

const entryArb = fc.record({
  task: fc.constantFrom('BL-1', 'BL-2', 'BL-3'),
  givenUp: fc.boolean(),
  seat: fc.constantFrom('coder', 'coder@2', 'coder@3'),
});

test('invariant 1b: worked-task-names-in never attributes a task whose only completed entry is given-up, whatever the population', () => {
  fc.assert(
    fc.property(fc.array(entryArb, { minLength: 0, maxLength: 6 }), (entries) => {
      const root = mkTmpDir(FIXTURE_PREFIX);
      const dir = path.join(root, 'completed');
      try {
        entries.forEach((e, i) => {
          writeHandoff(dir, `50_2026_${i}.handoff`, {
            task: e.task,
            outcome: e.givenUp ? 'given-up' : undefined,
            outcomeSeat: e.givenUp ? e.seat : undefined,
          });
        });
        const raw = bbEval(HANDOFF_LIB, `(println (handoff-lib/worked-task-names-in "${dir}"))`);
        const worked = new Set((raw.match(/[A-Za-z0-9-]+/g) || []).filter((s) => s.startsWith('BL-')));
        const tasksWithOnlyGivenUp = new Set(
          ['BL-1', 'BL-2', 'BL-3'].filter((t) => {
            const forTask = entries.filter((e) => e.task === t);
            return forTask.length > 0 && forTask.every((e) => e.givenUp);
          })
        );
        for (const t of tasksWithOnlyGivenUp) {
          assert.ok(!worked.has(t), `expected ${t} (only given-up entries) to be excluded from worked-task-names-in, got ${raw}`);
        }
        const tasksWithNonGivenUp = new Set(entries.filter((e) => !e.givenUp).map((e) => e.task));
        for (const t of tasksWithNonGivenUp) {
          assert.ok(worked.has(t), `expected ${t} (a real completed entry) to be attributed as worked, got ${raw}`);
        }
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    }),
    { numRuns: 40 }
  );
});

test('invariant 1b: given-up-task-names-in is seat-specific - a sibling reading the same shared directory sees an empty set', () => {
  fc.assert(
    fc.property(fc.array(entryArb.filter((e) => e.givenUp), { minLength: 1, maxLength: 5 }), (entries) => {
      const root = mkTmpDir(FIXTURE_PREFIX);
      const dir = path.join(root, 'completed');
      try {
        entries.forEach((e, i) => writeHandoff(dir, `50_2026_${i}.handoff`, { task: e.task, outcome: 'given-up', outcomeSeat: e.seat }));
        const seatsPresent = new Set(entries.map((e) => e.seat));
        for (const seat of ['coder', 'coder@2', 'coder@3']) {
          const raw = bbEval(HANDOFF_LIB, `(println (handoff-lib/given-up-task-names-in "${dir}" "${seat}"))`);
          const got = new Set((raw.match(/[A-Za-z0-9-]+/g) || []).filter((s) => s.startsWith('BL-')));
          const expected = new Set(entries.filter((e) => e.seat === seat).map((e) => e.task));
          assert.deepEqual(got, expected, `seat ${seat}: expected ${[...expected]}, got ${raw} (present seats: ${[...seatsPresent]})`);
        }
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    }),
    { numRuns: 30 }
  );
});

test('non-vacuous: worked-task-names-in DOES attribute a plain git_handoff with no outcome header (proves the exclusion is outcome-specific, not "always empty")', () => {
  const root = mkTmpDir(FIXTURE_PREFIX);
  const dir = path.join(root, 'completed');
  try {
    writeHandoff(dir, '50_2026_0.handoff', { task: 'BL-9' });
    const raw = bbEval(HANDOFF_LIB, `(println (handoff-lib/worked-task-names-in "${dir}"))`);
    assert.match(raw, /BL-9/, `expected a plain (non-given-up) completed git_handoff to still be attributed, got: ${raw}`);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// ── Invariant 2 (tree half): revert-attempt-commits! (BL-1778) ────────────

function makeRepo(root) {
  git(root, ['init', '-q', '-b', 'main']);
  git(root, ['config', 'user.email', 'prop@example.test']);
  git(root, ['config', 'user.name', 'Prop']);
  fs.writeFileSync(path.join(root, 'seed.txt'), 'seed\n');
  git(root, ['add', '-A']);
  git(root, ['commit', '-q', '-m', 'seed']);
}

// BL-1778: builds a claim's post-merge-head under one of four combinations
// - {mainMerge: true|false} x {receivedFastForward: true|false} - then
// returns it plus the repo, for the caller to layer an attempt chain on
// top of.
function buildClaim(root, { mainMerge, receivedFastForward }) {
  makeRepo(root);
  if (mainMerge) {
    const branch = 'main-advance';
    git(root, ['checkout', '-q', '-b', branch]);
    fs.writeFileSync(path.join(root, 'main-advanced.txt'), 'main advanced\n');
    git(root, ['add', '-A']);
    git(root, ['commit', '-q', '-m', 'main: advance']);
    git(root, ['checkout', '-q', 'main']);
    git(root, ['merge', '-q', '--no-ff', branch, '-m', 'Merge main.']);
    git(root, ['branch', '-q', '-D', branch]);
  }
  const senderBranch = 'sender';
  const startSha = git(root, ['rev-parse', 'HEAD']).trim();
  git(root, ['checkout', '-q', '-b', senderBranch]);
  fs.writeFileSync(path.join(root, 'received.txt'), 'received content\n');
  git(root, ['add', '-A']);
  git(root, ['commit', '-q', '-m', 'sender commit']);
  const senderSha = git(root, ['rev-parse', 'HEAD']).trim();
  git(root, ['checkout', '-q', 'main']);
  if (!receivedFastForward) {
    git(root, ['reset', '-q', '--hard', startSha]);
  }
  git(root, ['merge', ...(receivedFastForward ? ['--ff-only'] : ['--no-ff', '-m', 'merge sender']), senderSha]);
  git(root, ['branch', '-q', '-D', senderBranch]);
  return git(root, ['rev-parse', 'HEAD']).trim();
}

const claimShapeArb = fc.record({
  mainMerge: fc.boolean(),
  receivedFastForward: fc.boolean(),
});
const CLAIM_SHAPE_CELLS = [
  'mainMerge=false,ff=false',
  'mainMerge=false,ff=true',
  'mainMerge=true,ff=false',
  'mainMerge=true,ff=true',
];
const CLAIM_SHAPE_FLOOR = 2;

test('invariants 1 and 2: revert-attempt-commits! reverts only the attempt, keeping the post-merge tree, over generated claim shapes and attempt chains', () => {
  const reach = {};
  fc.assert(
    fc.property(claimShapeArb, fc.integer({ min: 0, max: 4 }), (claimShape, attemptCount) => {
      const cell = `mainMerge=${claimShape.mainMerge},ff=${claimShape.receivedFastForward}`;
      reach[cell] = (reach[cell] || 0) + 1;
      const root = mkTmpDir(FIXTURE_PREFIX);
      try {
        const postMergeHead = buildClaim(root, claimShape);
        const postMergeFiles = fs.readdirSync(root).filter((f) => f !== '.git').sort();
        const historyBefore = git(root, ['rev-list', '--count', 'HEAD']).trim();

        for (let i = 0; i < attemptCount; i += 1) {
          fs.writeFileSync(path.join(root, `attempt-${i}.txt`), `attempt ${i}\n`);
          git(root, ['add', '-A']);
          git(root, ['commit', '-q', '-m', `attempt ${i}`]);
        }

        execFileSync('bb', [
          '-e',
          `(load-file "${LIB}") (local-parcel-driver-lib/revert-attempt-commits! "${root}" "${postMergeHead}")`,
        ]);

        // Invariant 2: the tree after the revert equals the post-merge
        // tree, whatever the claim shape or attempt chain length.
        const diff = git(root, ['diff', postMergeHead, 'HEAD', '--stat']).trim();
        assert.equal(
          diff,
          '',
          `claim=${JSON.stringify(claimShape)} attemptCount=${attemptCount}: expected the tree to match post-merge-head, diff:\n${diff}`
        );
        const filesAfter = fs.readdirSync(root).filter((f) => f !== '.git').sort();
        assert.deepEqual(
          filesAfter,
          postMergeFiles,
          `claim=${JSON.stringify(claimShape)} attemptCount=${attemptCount}: expected the exact post-merge file set`
        );

        // Invariant 1: never a reset (history only grows: the original
        // attempt commits stay, plus exactly one revert commit per
        // attempt commit - 2*attemptCount new commits total), never a
        // revert of the claim's own merge or received-commit content.
        const historyAfter = git(root, ['rev-list', '--count', 'HEAD']).trim();
        assert.equal(
          Number(historyAfter),
          Number(historyBefore) + 2 * attemptCount,
          `claim=${JSON.stringify(claimShape)} attemptCount=${attemptCount}: expected ${attemptCount} attempt commit(s) plus ${attemptCount} revert commit(s), before=${historyBefore} after=${historyAfter}`
        );
        const subjectsSince = git(root, ['log', '--format=%s', `${postMergeHead}..HEAD`])
          .trim()
          .split('\n')
          .filter(Boolean);
        for (const subj of subjectsSince) {
          assert.ok(
            !/^Revert "(Merge main\.|merge sender|sender commit|main: advance)"$/.test(subj),
            `claim=${JSON.stringify(claimShape)} attemptCount=${attemptCount}: a claim commit was reverted: "${subj}"`
          );
        }
        const revertSubjects = subjectsSince.filter((s) => /^Revert "attempt \d+"$/.test(s));
        const attemptSubjects = subjectsSince.filter((s) => /^attempt \d+$/.test(s));
        assert.equal(
          revertSubjects.length,
          attemptCount,
          `claim=${JSON.stringify(claimShape)} attemptCount=${attemptCount}: expected exactly ${attemptCount} revert-of-attempt subject(s), got ${JSON.stringify(subjectsSince)}`
        );
        assert.equal(
          attemptSubjects.length,
          attemptCount,
          `claim=${JSON.stringify(claimShape)} attemptCount=${attemptCount}: expected the original ${attemptCount} attempt subject(s) to remain in history (revert, never reset), got ${JSON.stringify(subjectsSince)}`
        );
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    }),
    { numRuns: 60 }
  );
  assertReachFloor(reach, CLAIM_SHAPE_CELLS, CLAIM_SHAPE_FLOOR, 'claim shape');
});

test('a merge the attempt itself made mid-attempt keeps its content - excluded from revert by --no-merges, never the attempt\'s own work', () => {
  const root = mkTmpDir(FIXTURE_PREFIX);
  try {
    const postMergeHead = buildClaim(root, { mainMerge: false, receivedFastForward: false });

    fs.writeFileSync(path.join(root, 'attempt-0.txt'), 'attempt 0\n');
    git(root, ['add', '-A']);
    git(root, ['commit', '-q', '-m', 'attempt 0']);

    const sideBranch = 'attempt-side';
    git(root, ['checkout', '-q', '-b', sideBranch]);
    fs.writeFileSync(path.join(root, 'attempt-side.txt'), 'attempt side content\n');
    git(root, ['add', '-A']);
    git(root, ['commit', '-q', '-m', 'attempt side commit']);
    git(root, ['checkout', '-q', 'main']);
    git(root, ['merge', '-q', '--no-ff', sideBranch, '-m', 'attempt merges its own side branch']);
    git(root, ['branch', '-q', '-D', sideBranch]);

    fs.writeFileSync(path.join(root, 'attempt-1.txt'), 'attempt 1\n');
    git(root, ['add', '-A']);
    git(root, ['commit', '-q', '-m', 'attempt 1']);

    execFileSync('bb', [
      '-e',
      `(load-file "${LIB}") (local-parcel-driver-lib/revert-attempt-commits! "${root}" "${postMergeHead}")`,
    ]);

    // The two plain attempt commits are reverted; the mid-attempt merge
    // (and the side content it brought) is kept.
    assert.ok(fs.existsSync(path.join(root, 'attempt-side.txt')), 'expected the mid-attempt merge\'s own content to survive the revert');
    assert.ok(!fs.existsSync(path.join(root, 'attempt-0.txt')), 'expected attempt 0 to be reverted');
    assert.ok(!fs.existsSync(path.join(root, 'attempt-1.txt')), 'expected attempt 1 to be reverted');
    const subjectsSince = git(root, ['log', '--format=%s', `${postMergeHead}..HEAD`]).trim().split('\n').filter(Boolean);
    assert.ok(
      !subjectsSince.includes('Revert "attempt merges its own side branch"'),
      `expected the mid-attempt merge itself never reverted, got: ${JSON.stringify(subjectsSince)}`
    );
    assert.ok(
      subjectsSince.includes('Revert "attempt 0"') && subjectsSince.includes('Revert "attempt 1"'),
      `expected both plain attempt commits reverted, got: ${JSON.stringify(subjectsSince)}`
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('non-vacuous: revert-attempt-commits! is a no-op when HEAD already equals post-merge-head', () => {
  const root = mkTmpDir(FIXTURE_PREFIX);
  try {
    makeRepo(root);
    const head = git(root, ['rev-parse', 'HEAD']).trim();
    execFileSync('bb', [
      '-e',
      `(load-file "${LIB}") (local-parcel-driver-lib/revert-attempt-commits! "${root}" "${head}")`,
    ]);
    assert.equal(git(root, ['rev-parse', 'HEAD']).trim(), head, 'expected no new commit when already at post-merge-head');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
