'use strict';

// BL-1785: step handlers for "a closed owner's own ticket-record stray
// lands onto its done copy". Drives the REAL swarmforge/scripts/
// land_step_cli.bb - never a reimplementation of the decision, mirroring
// bl1650LandStepPureEvidenceStraySteps.js's own fixture technique (a real
// git repository under mkdtemp with its own origin remote, BL-1390).

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const { mkSocketFixtureRoot } = require('./lib/socketFixtureRoot');

const FEATURE = "BL-1785 A closed owner's own ticket-record stray lands onto its done copy";

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const CLI = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'land_step_cli.bb');

const LANDING = 'BL-9785';
const SIBLING = 'BL-9787';
const RECORD_LINE = 'abandoned_commits: [abcdef1234]';

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

function appendToFile(root, rel, extra) {
  const abs = path.join(root, rel);
  fs.writeFileSync(abs, fs.readFileSync(abs, 'utf8') + extra);
}

function markOriginMain(root) {
  git(root, 'update-ref', 'refs/remotes/origin/main', head(root));
}

function runCli(root, taskName, commit) {
  const r = spawnSync('bb', [CLI, taskName, commit], { cwd: root, encoding: 'utf8' });
  return { status: r.status, stdout: r.stdout || '', stderr: r.stderr || '' };
}

// The two Scenario Outline placeholders, explicit KNOWN_VALUES per the
// project's own Scenario Outline handler rule - a row naming a shape this
// handler does not recognize fails loudly rather than passing through
// unchecked. "backlog/active/" forks the role branch from BEFORE the
// sibling's own close (the real 2026-09-26 incident shape: QA's record
// commit lands on a branch that still has the file at its old path,
// independent of whatever origin/main does on its own line);
// "backlog/done/M8/" forks from AFTER the close, when the file already
// sits at its done path on that branch too.
const RECORD_COPY_FORK_POINTS = {
  'backlog/active/': (ctx) => ctx.siblingPreCloseCommit,
  'backlog/done/M8/': (ctx) => ctx.siblingClosedCommit,
};

const OTHER_PATH_KNOWN_VALUES = new Set(['android/bl9785_fixture.txt', 'backlog/active/BL-9786-another-ticket.yaml']);

function siblingFilePath(folder) {
  return `${folder}${SIBLING}-fixture.yaml`;
}

// A REAL ticket YAML is a hundred-plus lines; a bare "id: BL-9787\n" is
// not, and its tiny size falsifies scenario 02's own proof for a reason
// that has nothing to do with this ticket's fix: git's cherry-pick rename
// detection compares the STRAY's parent tree against the target tree by
// CONTENT SIMILARITY, and a one-line record addition to a 12-byte file
// drops that ratio under git's ~50% default threshold - measured directly:
// the exact same fixture shape with this multi-line body cherry-picks
// clean (git recognizes the rename and reports the by-then-already-
// landed patch as empty); the one-line body instead produces a genuine
// modify/delete conflict, never reached in real use where every ticket
// file is already this size.
const SIBLING_TICKET_BODY = `id: ${SIBLING}\ntitle: fixture ticket for BL-1785\nmilestone: M8\ntype: chore\nstatus: done\nhuman_approval: approved\nassigned_to: coder\n`;

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(/^a fixture repository with an origin and a main branch$/, (ctx) => {
    const root = mkSocketFixtureRoot('bl1785-fixture-');
    git(root, 'init', '-q', '-b', 'main', '.');
    git(root, 'config', 'user.email', 't@t');
    git(root, 'config', 'user.name', 't');
    git(root, 'config', 'commit.gpgsign', 'false');
    commitFile(root, 'seed.txt', 'seed\n', 'seed before origin/main');
    markOriginMain(root);
    ctx.root = root;
  });

  scoped(/^a sibling ticket whose file origin\/main has moved from backlog\/active\/ to backlog\/done\/M8\/$/, (ctx) => {
    git(ctx.root, 'checkout', '-q', 'main');
    commitFile(ctx.root, siblingFilePath('backlog/active/'), SIBLING_TICKET_BODY, `${SIBLING}: own work, still open`);
    ctx.siblingPreCloseCommit = head(ctx.root);
    // A real `git mv`, never a delete-then-add, so git's own rename
    // detection is what actually carries a later stray edit onto this
    // path - the whole mechanism this ticket depends on, never
    // special-cased in this fixture. `git mv` itself never creates the
    // destination directory (measured: "fatal: renaming ... failed: No
    // such file or directory" without this).
    fs.mkdirSync(path.join(ctx.root, 'backlog', 'done', 'M8'), { recursive: true });
    git(ctx.root, 'mv', siblingFilePath('backlog/active/'), siblingFilePath('backlog/done/M8/'));
    git(ctx.root, 'commit', '-q', '-m', `${SIBLING}: closed, moved to backlog/done/M8/`);
    markOriginMain(ctx.root);
    ctx.siblingClosedCommit = head(ctx.root);
  });

  // ── scenarios 01 and 02 share this Given: it also fires for scenario
  // 02's own literal "backlog/active/" text (the Outline's placeholder
  // substitutes to the same literal string that step's own text uses, so
  // one definition serves both). ─────────────────────────────────────────
  scoped(
    /^a commit on a role branch, whose subject leads with the sibling's id, adding "abandoned_commits: \[abcdef1234\]" to the sibling's (.+) file$/,
    (ctx, recordCopy) => {
      const forkPoint = RECORD_COPY_FORK_POINTS[recordCopy];
      assert.ok(forkPoint, `unknown <record copy> example value "${recordCopy}"`);
      git(ctx.root, 'checkout', '-q', '-b', 'role', forkPoint(ctx));
      const filePath = siblingFilePath(recordCopy);
      appendToFile(ctx.root, filePath, `${RECORD_LINE}\n`);
      git(ctx.root, 'add', '-A');
      git(ctx.root, 'commit', '-q', '-m', `${SIBLING}: record abandoned_commits for the tip-pure land`);
      ctx.strayCommit = head(ctx.root);
    },
  );

  scoped(/^the landing ticket's own commit is on the same role branch$/, (ctx) => {
    commitFile(ctx.root, `backlog/active/${LANDING}-fixture.yaml`, `id: ${LANDING}\n`, `${LANDING}: own work`);
  });

  scoped(/^the land step runs for the landing ticket at the tip$/, (ctx) => {
    ctx.tip = head(ctx.root);
    ctx.cli = runCli(ctx.root, `${LANDING}-fixture`, ctx.tip);
  });

  scoped(/^it exits LAND_REPLAY and prints LAND_STRAY_EVIDENCE_LANDED naming the stray's own commit$/, (ctx) => {
    assert.equal(ctx.cli.status, 0, `expected LAND_REPLAY (exit 0), got: ${JSON.stringify(ctx.cli)}`);
    assert.ok(ctx.cli.stdout.includes('LAND_REPLAY'), `expected LAND_REPLAY, got: ${ctx.cli.stdout}`);
    const line = ctx.cli.stdout.split('\n').find((l) => l.startsWith('LAND_STRAY_EVIDENCE_LANDED'));
    assert.ok(line, `expected a LAND_STRAY_EVIDENCE_LANDED line, got: ${ctx.cli.stdout}`);
    assert.ok(line.includes(ctx.strayCommit), `stray line does not name the stray's own commit: ${line}`);
    const branchLine = ctx.cli.stdout.split('\n').find((l) => l.startsWith('LAND_REPLAY'));
    ctx.replayBranch = branchLine.split(' ')[1];
    ctx.replayCommit = branchLine.split(' ')[2];
  });

  scoped(/^it exits LAND_REPLAY and prints LAND_STRAY_EVIDENCE_ALREADY_LANDED naming the stray's own commit$/, (ctx) => {
    assert.equal(ctx.cli.status, 0, `expected LAND_REPLAY (exit 0), got: ${JSON.stringify(ctx.cli)}`);
    assert.ok(ctx.cli.stdout.includes('LAND_REPLAY'), `expected LAND_REPLAY, got: ${ctx.cli.stdout}`);
    assert.ok(
      !ctx.cli.stdout.split('\n').some((l) => l.startsWith('LAND_STRAY_EVIDENCE_LANDED ')),
      `an already-applied stray must never print as a fresh LAND_STRAY_EVIDENCE_LANDED: ${ctx.cli.stdout}`,
    );
    const line = ctx.cli.stdout.split('\n').find((l) => l.startsWith('LAND_STRAY_EVIDENCE_ALREADY_LANDED'));
    assert.ok(line, `expected a LAND_STRAY_EVIDENCE_ALREADY_LANDED line, got: ${ctx.cli.stdout}`);
    assert.ok(line.includes(ctx.strayCommit), `already-landed line does not name the stray's own commit: ${line}`);
    const branchLine = ctx.cli.stdout.split('\n').find((l) => l.startsWith('LAND_REPLAY'));
    ctx.replayBranch = branchLine.split(' ')[1];
    ctx.replayCommit = branchLine.split(' ')[2];
  });

  scoped(/^the replay branch's tip carries "abandoned_commits: \[abcdef1234\]" exactly once in the sibling's backlog\/done\/M8\/ file$/, (ctx) => {
    const content = git(ctx.root, 'show', `${ctx.replayCommit}:${siblingFilePath('backlog/done/M8/')}`);
    const occurrences = content.split(RECORD_LINE).length - 1;
    assert.equal(occurrences, 1, `expected "${RECORD_LINE}" exactly once, got ${occurrences} in:\n${content}`);
  });

  scoped(/^the replay branch's tip has no file for the sibling under backlog\/active\/ or backlog\/paused\/$/, (ctx) => {
    const listing = git(ctx.root, 'ls-tree', '-r', '--name-only', ctx.replayCommit).split('\n');
    const stray = listing.filter((f) => (f.startsWith('backlog/active/') || f.startsWith('backlog/paused/')) && f.includes(SIBLING));
    assert.deepEqual(stray, [], `expected no active/paused file for ${SIBLING}, found: ${JSON.stringify(stray)}`);
    spawnSync('git', ['-C', ctx.root, 'branch', '-q', '-D', ctx.replayBranch]);
  });

  // ── scenario 02's own Given: a record edit the done copy already
  // carries, written straight onto origin/main - the second shape BL-1785
  // widens for (QA's post-land record landing directly on the done
  // copy). ────────────────────────────────────────────────────────────
  scoped(/^origin\/main's backlog\/done\/M8\/ file for the sibling already carries "abandoned_commits: \[abcdef1234\]"$/, (ctx) => {
    git(ctx.root, 'checkout', '-q', 'main');
    appendToFile(ctx.root, siblingFilePath('backlog/done/M8/'), `${RECORD_LINE}\n`);
    git(ctx.root, 'add', '-A');
    git(ctx.root, 'commit', '-q', '-m', `${SIBLING}: record abandoned_commits for the tip-pure land (already landed by hand)`);
    markOriginMain(ctx.root);
    // Refresh: the "backlog/active/" fork point in the shared Given above
    // is unaffected (still the pre-close commit), but the closed-copy ref
    // itself has moved and no scenario in this feature reads it again.
  });

  // ── scenario 03 ──────────────────────────────────────────────────────

  scoped(
    /^a commit on a role branch, whose subject leads with the sibling's id, editing the sibling's backlog\/active\/ file and "(.+)"$/,
    (ctx, otherPath) => {
      assert.ok(OTHER_PATH_KNOWN_VALUES.has(otherPath), `unknown <other path> example value "${otherPath}"`);
      git(ctx.root, 'checkout', '-q', '-b', 'role', ctx.siblingPreCloseCommit);
      appendToFile(ctx.root, siblingFilePath('backlog/active/'), `${RECORD_LINE}\n`);
      fs.mkdirSync(path.dirname(path.join(ctx.root, otherPath)), { recursive: true });
      fs.writeFileSync(path.join(ctx.root, otherPath), 'a wider edit riding the same commit as the record\n');
      git(ctx.root, 'add', '-A');
      git(ctx.root, 'commit', '-q', '-m', `${SIBLING}: record plus a wider edit riding the same commit`);
      ctx.strayCommit = head(ctx.root);
      ctx.otherPath = otherPath;
    },
  );

  scoped(/^it exits LAND_ESCALATE and the reason names "(.+)" and the sibling's id$/, (ctx, otherPath) => {
    assert.equal(ctx.cli.status, 1, `expected LAND_ESCALATE (exit 1), got: ${JSON.stringify(ctx.cli)}`);
    assert.ok(ctx.cli.stdout.includes('LAND_ESCALATE'), `expected LAND_ESCALATE, got: ${ctx.cli.stdout}`);
    assert.ok(ctx.cli.stdout.includes(otherPath), `reason does not name ${otherPath}: ${ctx.cli.stdout}`);
    assert.ok(ctx.cli.stdout.includes(SIBLING), `reason does not name ${SIBLING}: ${ctx.cli.stdout}`);
  });

  scoped(/^no LAND_STRAY_EVIDENCE_LANDED line is printed$/, (ctx) => {
    assert.ok(!ctx.cli.stdout.includes('LAND_STRAY_EVIDENCE_LANDED'), `must never print LAND_STRAY_EVIDENCE_LANDED, got: ${ctx.cli.stdout}`);
  });
}

module.exports = { registerSteps };
