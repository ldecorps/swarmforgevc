'use strict';

// BL-1650: step handlers for "the land step lands a pure-evidence
// closed-owner stray itself". Drives the REAL swarmforge/scripts/
// land_step_cli.bb - never a reimplementation of the decision, the same
// posture bl1546ClosedOwnerNeverSilentlyExcludesSteps.js already uses.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const { mkSocketFixtureRoot } = require('./lib/socketFixtureRoot');

const FEATURE = 'BL-1650 The land step lands a pure-evidence closed-owner stray itself';

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const CLI = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'land_step_cli.bb');

const LANDING = 'BL-9650';
const SIBLING = 'BL-9651';

function git(root, ...args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
}

function head(root) {
  return git(root, 'rev-parse', 'HEAD');
}

function commitFile(root, rel, body, message) {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, body);
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '-m', message);
}

function markOriginMain(root) {
  git(root, 'update-ref', 'refs/remotes/origin/main', head(root));
}

function writeDoneTicket(root, id, extra) {
  commitFile(
    root,
    `backlog/done/M8/${id}-fixture.yaml`,
    `id: ${id}\nstatus: done\nhuman_approval: approved\n${extra || ''}`,
    `${id}: done ticket fixture file`,
  );
}

function runCli(root, taskName, commit) {
  const r = spawnSync('bb', [CLI, taskName, commit], { cwd: root, encoding: 'utf8' });
  return { status: r.status, stdout: r.stdout || '', stderr: r.stderr || '' };
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(/^a fixture repository with an origin and a main branch$/, (ctx) => {
    const root = mkSocketFixtureRoot('bl1650-fixture-');
    git(root, 'init', '-q', '-b', 'main', '.');
    git(root, 'config', 'user.email', 't@t');
    git(root, 'config', 'user.name', 't');
    git(root, 'config', 'commit.gpgsign', 'false');
    commitFile(root, 'seed.txt', 'seed\n', 'seed before origin/main');
    markOriginMain(root);
    ctx.root = root;
  });

  scoped(
    /^a commit on a role branch, tagged with a sibling ticket id, touching only a path under backlog\/evidence\/$/,
    (ctx) => {
      git(ctx.root, 'checkout', '-q', '-b', 'role');
      commitFile(
        ctx.root,
        `backlog/evidence/${SIBLING}-role-20260919.md`,
        'incident notes\n',
        `${SIBLING}: incident evidence, committed after the ticket moved on`,
      );
      ctx.strayCommit = head(ctx.root);
      ctx.strayPath = `backlog/evidence/${SIBLING}-role-20260919.md`;
    },
  );

  scoped(
    /^a commit on a role branch, tagged with a sibling ticket id, touching a path under swarmforge\/scripts\/$/,
    (ctx) => {
      git(ctx.root, 'checkout', '-q', '-b', 'role');
      commitFile(
        ctx.root,
        'swarmforge/scripts/bl9651_fixture_lib.bb',
        '(ns bl9651-fixture-lib)\n',
        `${SIBLING}: a code change riding the same branch`,
      );
      ctx.strayCommit = head(ctx.root);
      ctx.strayPath = 'swarmforge/scripts/bl9651_fixture_lib.bb';
    },
  );

  scoped(/^that sibling ticket is closed on origin\/main$/, (ctx) => {
    // The sibling closes on ITS OWN line, off the seed, then main fast-
    // forwards to include it - so origin/main carries the closed ticket
    // file while the role branch (holding the stray) stays independent of
    // that fast-forward until the landing ticket's own branch merges it in
    // below, matching the ticket's own 2026-09-19 incident shape (BL-831
    // closed the day AFTER its stray committed).
    git(ctx.root, 'checkout', '-q', 'main');
    writeDoneTicket(ctx.root, SIBLING);
    markOriginMain(ctx.root);
    git(ctx.root, 'checkout', '-q', 'role');
  });

  scoped(/^the landing ticket's own commit is on the same role branch$/, (ctx) => {
    commitFile(ctx.root, `backlog/active/${LANDING}-fixture.yaml`, `id: ${LANDING}\n`, `${LANDING}: own work`);
  });

  scoped(/^the land step runs for the landing ticket at the tip$/, (ctx) => {
    ctx.tip = head(ctx.root);
    ctx.cli = runCli(ctx.root, `${LANDING}-fixture`, ctx.tip);
  });

  scoped(
    /^it exits LAND_REPLAY and prints LAND_STRAY_EVIDENCE_LANDED naming the stray's own commit and its path$/,
    (ctx) => {
      assert.equal(ctx.cli.status, 0, `expected LAND_REPLAY (exit 0), got: ${JSON.stringify(ctx.cli)}`);
      assert.ok(ctx.cli.stdout.includes('LAND_REPLAY'), `expected LAND_REPLAY, got: ${ctx.cli.stdout}`);
      const line = ctx.cli.stdout.split('\n').find((l) => l.startsWith('LAND_STRAY_EVIDENCE_LANDED'));
      assert.ok(line, `expected a LAND_STRAY_EVIDENCE_LANDED line, got: ${ctx.cli.stdout}`);
      assert.ok(line.includes(ctx.strayCommit), `stray line does not name the stray's own commit: ${line}`);
      assert.ok(line.includes(ctx.strayPath), `stray line does not name the stray's own path: ${line}`);
      const branchLine = ctx.cli.stdout.split('\n').find((l) => l.startsWith('LAND_REPLAY'));
      ctx.replayBranch = branchLine.split(' ')[1];
      ctx.replayCommit = branchLine.split(' ')[2];
    },
  );

  scoped(/^the sibling is reported LANDED_SIBLING, never ENTANGLED_SIBLING$/, (ctx) => {
    assert.ok(
      ctx.cli.stdout.split('\n').some((l) => l === `LANDED_SIBLING ${SIBLING}` || l.startsWith(`LANDED_SIBLING ${SIBLING} `)),
      `expected LANDED_SIBLING ${SIBLING}, got: ${ctx.cli.stdout}`,
    );
    assert.ok(
      !ctx.cli.stdout.includes(`ENTANGLED_SIBLING ${SIBLING}`),
      `must never print ENTANGLED_SIBLING ${SIBLING}, got: ${ctx.cli.stdout}`,
    );
  });

  scoped(/^the replay branch's tip carries the stray's own file content$/, (ctx) => {
    const content = git(ctx.root, 'show', `${ctx.replayCommit}:${ctx.strayPath}`);
    assert.equal(content, 'incident notes', `expected the stray's own content on the replay tip, got: ${content}`);
    spawnSync('git', ['-C', ctx.root, 'branch', '-q', '-D', ctx.replayBranch]);
  });

  scoped(/^it exits LAND_ESCALATE and the reason names that path and the closed sibling's id$/, (ctx) => {
    assert.equal(ctx.cli.status, 1, `expected LAND_ESCALATE (exit 1), got: ${JSON.stringify(ctx.cli)}`);
    assert.ok(ctx.cli.stdout.includes('LAND_ESCALATE'), `expected LAND_ESCALATE, got: ${ctx.cli.stdout}`);
    assert.ok(ctx.cli.stdout.includes(ctx.strayPath), `reason does not name the path: ${ctx.cli.stdout}`);
    assert.ok(ctx.cli.stdout.includes(SIBLING), `reason does not name the closed sibling: ${ctx.cli.stdout}`);
  });

  scoped(/^no LAND_STRAY_EVIDENCE_LANDED line is printed$/, (ctx) => {
    assert.ok(
      !ctx.cli.stdout.includes('LAND_STRAY_EVIDENCE_LANDED'),
      `must never print LAND_STRAY_EVIDENCE_LANDED, got: ${ctx.cli.stdout}`,
    );
  });

  // ── scenario 03: a non-first-parent-merge sibling already on origin/main ─

  scoped(/^origin\/main already carries a path's content under its own commit$/, (ctx) => {
    commitFile(ctx.root, 'shared.txt', 'shared content\n', `${SIBLING}: landed on main directly`);
    markOriginMain(ctx.root);
    ctx.originMain = head(ctx.root);
  });

  scoped(/^a sibling's own unrelated commit adds the same path with the same content$/, (ctx) => {
    git(ctx.root, 'checkout', '-q', '--orphan', 'sibling-line');
    execFileSync('git', ['rm', '-rq', '--cached', '.'], { cwd: ctx.root });
    commitFile(ctx.root, 'shared.txt', 'shared content\n', `${SIBLING}: sibling's own commit, unrelated history`);
    ctx.siblingCommit = head(ctx.root);
  });

  scoped(
    /^the landing ticket's branch merges the sibling's commit in as a non-first-parent ancestor$/,
    (ctx) => {
      git(ctx.root, 'checkout', '-q', '-b', 'parcel', ctx.originMain);
      commitFile(ctx.root, `backlog/active/${LANDING}-fixture.yaml`, `id: ${LANDING}\n`, `${LANDING}: own work`);
      git(ctx.root, 'merge', '-q', '--no-ff', '--allow-unrelated-histories', '-m', 'Merge sibling-line into parcel.', ctx.siblingCommit);
    },
  );

  // ── scenario 04: abandoned_commits exclusion ──────────────────────────

  scoped(
    /^a sibling ticket closed on origin\/main with abandoned_commits naming its own commit$/,
    (ctx) => {
      git(ctx.root, 'checkout', '-q', '-b', 'sibling-line');
      commitFile(ctx.root, 'sibling.txt', 'abandoned content\n', `${SIBLING}: sibling's commit, later abandoned`);
      ctx.siblingCommit = head(ctx.root);
      git(ctx.root, 'checkout', '-q', 'main');
      writeDoneTicket(ctx.root, SIBLING, `abandoned_commits: [${ctx.siblingCommit.slice(0, 10)}]\n`);
      markOriginMain(ctx.root);
      ctx.originMain = head(ctx.root);
    },
  );

  scoped(
    /^that same commit later becomes an ancestor of the landing ticket's branch through an ordinary merge$/,
    (ctx) => {
      git(ctx.root, 'checkout', '-q', '-b', 'parcel', ctx.originMain);
      commitFile(ctx.root, `backlog/active/${LANDING}-fixture.yaml`, `id: ${LANDING}\n`, `${LANDING}: own work`);
      git(ctx.root, 'merge', '-q', '--no-ff', '-m', 'Merge sibling-line into parcel.', ctx.siblingCommit);
    },
  );

  scoped(/^it exits LAND_CLEAN$/, (ctx) => {
    assert.equal(ctx.cli.status, 0, `expected LAND_CLEAN (exit 0), got: ${JSON.stringify(ctx.cli)}`);
    assert.ok(ctx.cli.stdout.trim().startsWith('LAND_CLEAN'), `expected LAND_CLEAN, got: ${ctx.cli.stdout}`);
  });

  // ── scenario 05 (QA bounce D1): an already-landed stray ────────────────

  scoped(/^origin\/main already carries the stray's own file content under a separate commit$/, (ctx) => {
    // A SEPARATE commit on main, byte-identical content at the stray's own
    // path - never the stray's own sha - the "hand-landed once already"
    // shape `git cherry-pick -x` sees as an empty patch, not a conflict.
    git(ctx.root, 'checkout', '-q', 'main');
    commitFile(ctx.root, ctx.strayPath, 'incident notes\n', `${SIBLING}: landed by hand during an earlier adjudication`);
    markOriginMain(ctx.root);
    git(ctx.root, 'checkout', '-q', 'role');
  });

  scoped(
    /^it exits LAND_REPLAY and prints LAND_STRAY_EVIDENCE_ALREADY_LANDED naming the stray's own commit and its path$/,
    (ctx) => {
      assert.equal(ctx.cli.status, 0, `expected LAND_REPLAY (exit 0), got: ${JSON.stringify(ctx.cli)}`);
      assert.ok(ctx.cli.stdout.includes('LAND_REPLAY'), `expected LAND_REPLAY, got: ${ctx.cli.stdout}`);
      assert.ok(
        !ctx.cli.stdout.split('\n').some((l) => l.startsWith('LAND_STRAY_EVIDENCE_LANDED ')),
        `an already-applied stray must never print as a fresh LAND_STRAY_EVIDENCE_LANDED: ${ctx.cli.stdout}`,
      );
      const line = ctx.cli.stdout.split('\n').find((l) => l.startsWith('LAND_STRAY_EVIDENCE_ALREADY_LANDED'));
      assert.ok(line, `expected a LAND_STRAY_EVIDENCE_ALREADY_LANDED line, got: ${ctx.cli.stdout}`);
      assert.ok(line.includes(ctx.strayCommit), `already-landed line does not name the stray's own commit: ${line}`);
      assert.ok(line.includes(ctx.strayPath), `already-landed line does not name the stray's own path: ${line}`);
      const branchLine = ctx.cli.stdout.split('\n').find((l) => l.startsWith('LAND_REPLAY'));
      ctx.replayBranch = branchLine.split(' ')[1];
      // No separate "replay branch's tip" step for this scenario - clean up
      // the branch the library leaves behind on success right here, the
      // same tidiness scenario 01's own dedicated step performs.
      spawnSync('git', ['-C', ctx.root, 'branch', '-q', '-D', ctx.replayBranch]);
    },
  );

  // ── scenario 06 (QA bounce D1 rework, tip-content ruling): a stray whose
  // path content on the REPLAY TIP already equals origin/main, even though
  // the stray's own historical diff is a strict subset of how far main's
  // copy has since grown - no cherry-pick attempt at all. ────────────────

  scoped(
    /^a closed ticket's evidence commit off the lineage that added part of a file origin\/main now carries in full$/,
    (ctx) => {
      git(ctx.root, 'checkout', '-q', '-b', 'role');
      const partial = Array.from({ length: 9 }, (_, i) => `line ${i + 1}`).join('\n') + '\n';
      const path6 = `backlog/evidence/${SIBLING}-grown-20260919.md`;
      commitFile(ctx.root, path6, partial, `${SIBLING}: incident evidence, committed after the ticket moved on`);
      ctx.strayCommit = head(ctx.root);
      ctx.strayPath = path6;

      git(ctx.root, 'checkout', '-q', 'main');
      writeDoneTicket(ctx.root, SIBLING);
      const grown = partial + Array.from({ length: 31 }, (_, i) => `extra ${i + 1}`).join('\n') + '\n';
      ctx.fullContent = grown;
      commitFile(ctx.root, path6, grown, `${SIBLING}: a later commit grows the evidence file on main`);
      markOriginMain(ctx.root);
      git(ctx.root, 'checkout', '-q', 'role');
    },
  );

  scoped(/^a replay tip whose copy of that file equals origin\/main's$/, (ctx) => {
    // Untagged on purpose: this must not itself read as a fresh sibling
    // commit (commit-ticket-id finds no id), only as ordinary convergence -
    // the everyday shape of a role branch that has caught up with main.
    commitFile(ctx.root, ctx.strayPath, ctx.fullContent, "Converge the evidence file with main's grown copy");
  });

  scoped(/^the land step replays the cited ticket$/, (ctx) => {
    commitFile(ctx.root, `backlog/active/${LANDING}-fixture.yaml`, `id: ${LANDING}\n`, `${LANDING}: own work`);
    ctx.tip = head(ctx.root);
    ctx.cli = runCli(ctx.root, `${LANDING}-fixture`, ctx.tip);
  });

  scoped(/^no cherry-pick is attempted for the stray$/, (ctx) => {
    assert.equal(ctx.cli.status, 0, `expected LAND_REPLAY (exit 0), got: ${JSON.stringify(ctx.cli)}`);
    assert.ok(ctx.cli.stdout.includes('LAND_REPLAY'), `expected LAND_REPLAY, got: ${ctx.cli.stdout}`);
    assert.ok(
      !ctx.cli.stdout
        .split('\n')
        .some((l) => l.startsWith('LAND_STRAY_EVIDENCE_LANDED') || l.startsWith('LAND_STRAY_EVIDENCE_ALREADY_LANDED')),
      `must not attempt any stray cherry-pick for an already tip-landed path, got: ${ctx.cli.stdout}`,
    );
  });

  scoped(/^the replay reports the sibling landed and lands the ticket's own paths$/, (ctx) => {
    assert.ok(
      ctx.cli.stdout.split('\n').some((l) => l === `LANDED_SIBLING ${SIBLING}` || l.startsWith(`LANDED_SIBLING ${SIBLING} `)),
      `expected LANDED_SIBLING ${SIBLING}, got: ${ctx.cli.stdout}`,
    );
    assert.ok(
      !ctx.cli.stdout.includes(`ENTANGLED_SIBLING ${SIBLING}`),
      `must never print ENTANGLED_SIBLING ${SIBLING}, got: ${ctx.cli.stdout}`,
    );
    const branchLine = ctx.cli.stdout.split('\n').find((l) => l.startsWith('LAND_REPLAY'));
    assert.ok(branchLine, `expected a LAND_REPLAY line, got: ${ctx.cli.stdout}`);
    const replayBranch = branchLine.split(' ')[1];
    const replayCommit = branchLine.split(' ')[2];
    const ownFile = git(ctx.root, 'show', `${replayCommit}:backlog/active/${LANDING}-fixture.yaml`);
    assert.equal(ownFile.trim(), `id: ${LANDING}`, `expected the landing ticket's own path on the replay tip, got: ${ownFile}`);
    spawnSync('git', ['-C', ctx.root, 'branch', '-q', '-D', replayBranch]);
  });
}

module.exports = { registerSteps };
