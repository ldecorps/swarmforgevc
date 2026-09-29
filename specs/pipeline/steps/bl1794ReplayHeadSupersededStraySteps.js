'use strict';

// BL-1794: step handlers for "a stray an earlier stray in the same replay
// already landed is superseded". Drives the REAL swarmforge/scripts/
// land_step_cli.bb - never a reimplementation of the decision, mirroring
// bl1785ClosedOwnerRecordStraySteps.js's own fixture technique (a real git
// repository under mkdtemp with its own origin remote, BL-1390).
//
// The real incident (BL-1711's record fa79e88fa7) needed a FOLLOW-UP
// commit interposed between an original record and a later copy: without
// it, a copy carrying the identical patch as the record cherry-picks as an
// empty, already-applied no-op (never a genuine conflict) once the record
// alone is on the scratch branch. The follow-up shifts the surrounding
// context so the later copy's cherry-pick genuinely conflicts - reproduced
// here with explicit commit dates (GIT_COMMITTER_DATE/GIT_AUTHOR_DATE) so
// `stray-evidence-commits`' rev-list ordering is deterministic regardless
// of how fast this fixture's commits run: record, then follow-up, then the
// second copy, oldest first.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const { mkSocketFixtureRoot } = require('./lib/socketFixtureRoot');

const FEATURE = 'BL-1794 A stray an earlier stray in the same replay already landed is superseded';

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const CLI = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'land_step_cli.bb');

const LANDING = 'BL-9785';
const SIBLING = 'BL-9787';
const TICKET_PATH = `backlog/done/${SIBLING}-fixture.yaml`;
const EVIDENCE_PATH = `backlog/evidence/${SIBLING}-fixture.md`;

const BASE_TICKET_BODY = `id: ${SIBLING}\ntitle: sibling fixture for BL-1794\nmilestone: M8\ntype: chore\nstatus: done\nhuman_approval: approved\nassigned_to: coder\n`;
const BASE_EVIDENCE_BODY = `# ${SIBLING} evidence\n\nbase text, no land section yet.\n`;
const LAND_SECTION = 'land_section:\n  landed_at: 2026-01-01\n';
const FOLLOWUP_LINE = '  more: 1\n';
const EXTRA_LINE = '  unexpected_new_field: true\n';

function git(root, ...args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
}

function head(root) {
  return git(root, 'rev-parse', 'HEAD');
}

function commitAll(root, message, isoDate) {
  git(root, 'add', '-A');
  execFileSync('git', ['commit', '-q', '-m', message], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, GIT_AUTHOR_DATE: isoDate, GIT_COMMITTER_DATE: isoDate },
  });
  return head(root);
}

function appendToFile(root, rel, extra) {
  const abs = path.join(root, rel);
  fs.writeFileSync(abs, fs.readFileSync(abs, 'utf8') + extra);
}

function writeFile(root, rel, body) {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, body);
}

function markOriginMain(root) {
  git(root, 'update-ref', 'refs/remotes/origin/main', head(root));
}

function runCli(root, taskName, commit) {
  const r = spawnSync('bb', [CLI, taskName, commit], { cwd: root, encoding: 'utf8' });
  return { status: r.status, stdout: r.stdout || '', stderr: r.stderr || '' };
}

// Explicit KNOWN_VALUES for the Scenario Outline's <copy shape> placeholder.
const COPY_SHAPES = {
  'the same patch as the record commit': (ctx) => {
    // Same two files, same content, as the record commit - a byte-identical
    // patch but a DIFFERENT sha (a different branch, so a different parent
    // chain), the f37671e359/fa79e88fa7 shape (BL-1794's own description).
    writeFile(ctx.root, TICKET_PATH, ctx.ticketAfterRecord);
    appendToFile(ctx.root, EVIDENCE_PATH, LAND_SECTION);
  },
  'the evidence append alone, without its record edit': (ctx) => {
    // Touches ONLY the evidence file - the d61cb0d081 shape (a copy of the
    // evidence append alone, a different patch-id from the record commit,
    // which also touched the sibling's own ticket file).
    appendToFile(ctx.root, EVIDENCE_PATH, LAND_SECTION);
  },
};

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(/^a fixture repository with an origin and a main branch$/, (ctx) => {
    const root = mkSocketFixtureRoot('bl1794-fixture-');
    git(root, 'init', '-q', '-b', 'main', '.');
    git(root, 'config', 'user.email', 't@t');
    git(root, 'config', 'user.name', 't');
    git(root, 'config', 'commit.gpgsign', 'false');
    ctx.root = root;
    ctx.t0 = Date.parse('2026-01-01T00:00:00Z');
  });

  scoped(/^a sibling ticket closed on origin\/main whose evidence file origin\/main carries without a land section$/, (ctx) => {
    writeFile(ctx.root, TICKET_PATH, BASE_TICKET_BODY);
    writeFile(ctx.root, EVIDENCE_PATH, BASE_EVIDENCE_BODY);
    commitAll(ctx.root, `${SIBLING}: closed, no land section yet`, new Date(ctx.t0).toISOString());
    markOriginMain(ctx.root);
    ctx.origin = head(ctx.root);
    ctx.ticketAfterRecord = BASE_TICKET_BODY + 'land_note: true\n';
  });

  scoped(/^a record commit on a role branch, whose subject leads with the sibling's id, appending a land section to that evidence file$/, (ctx) => {
    git(ctx.root, 'checkout', '-q', '-b', 'role', ctx.origin);
    // The record commit is compound (BL-1785's own precedent): it touches
    // both the sibling's own ticket file AND the evidence file - so the
    // two <copy shape> examples below (whole-patch vs evidence-only) are
    // genuinely distinct diffs, not the same content restated.
    writeFile(ctx.root, TICKET_PATH, ctx.ticketAfterRecord);
    appendToFile(ctx.root, EVIDENCE_PATH, LAND_SECTION);
    ctx.recordCommit = commitAll(ctx.root, `${SIBLING}: land record`, new Date(ctx.t0 + 1000).toISOString());
  });

  scoped(/^a follow-up commit on the same role branch appending more lines after the land section$/, (ctx) => {
    appendToFile(ctx.root, EVIDENCE_PATH, FOLLOWUP_LINE);
    ctx.followupCommit = commitAll(ctx.root, `${SIBLING}: land record follow-up`, new Date(ctx.t0 + 2000).toISOString());
  });

  // ── Scenario Outline 01 ────────────────────────────────────────────────
  scoped(/^a second copy of the record commit on another role branch, carrying (.+)$/, (ctx, copyShape) => {
    const build = COPY_SHAPES[copyShape];
    assert.ok(build, `unknown <copy shape> example value "${copyShape}"`);
    git(ctx.root, 'checkout', '-q', '-b', 'role2', ctx.origin);
    build(ctx);
    ctx.copyCommit = commitAll(ctx.root, `${SIBLING}: land record (copy)`, new Date(ctx.t0 + 3000).toISOString());
    ctx.copyShape = copyShape;
  });

  // ── Scenario 02 ─────────────────────────────────────────────────────────
  scoped(/^a second copy of the record commit on another role branch that also adds a line no earlier stray carries$/, (ctx) => {
    git(ctx.root, 'checkout', '-q', '-b', 'role2', ctx.origin);
    appendToFile(ctx.root, EVIDENCE_PATH, LAND_SECTION.replace(/\n$/, '') + '\n' + EXTRA_LINE);
    ctx.copyCommit = commitAll(ctx.root, `${SIBLING}: land record (copy with extra line)`, new Date(ctx.t0 + 3000).toISOString());
  });

  // ── shared: merges role2's copy in, then adds the landing ticket's own
  //    commit, all on `role` - so ancestry-commits (full ancestry, not
  //    first-parent-only) reaches the copy via the merge's second parent,
  //    and rev-list's own date-ordering (oldest first, after reverse)
  //    places it after the follow-up. `-X ours` only resolves the
  //    CONSTRUCTION-time merge conflict here (role's own tip wins); it
  //    never touches the copy commit's own parent or diff, which is what
  //    the later simulated replay actually cherry-picks. ─────────────────
  scoped(/^the landing ticket's own tip carries all three, with the second copy after the follow-up in the replay's order$/, (ctx) => {
    git(ctx.root, 'checkout', '-q', 'role');
    spawnSync('git', ['-C', ctx.root, 'merge', '-q', '--no-ff', '-X', 'ours', '-m', `${SIBLING}: merge role2 copy`, 'role2'], {
      encoding: 'utf8',
      env: { ...process.env, GIT_AUTHOR_DATE: new Date(ctx.t0 + 4000).toISOString(), GIT_COMMITTER_DATE: new Date(ctx.t0 + 4000).toISOString() },
    });
    writeFile(ctx.root, `backlog/active/${LANDING}-fixture.yaml`, `id: ${LANDING}\ntitle: landing fixture\nmilestone: M8\n`);
    ctx.landingCommit = commitAll(ctx.root, `${LANDING}: own work`, new Date(ctx.t0 + 5000).toISOString());
  });

  scoped(/^the land step runs for the landing ticket at the tip$/, (ctx) => {
    ctx.tip = head(ctx.root);
    ctx.cli = runCli(ctx.root, `${LANDING}-fixture`, ctx.tip);
  });

  // ── Then: scenario 01 ─────────────────────────────────────────────────
  scoped(/^it exits LAND_REPLAY and prints LAND_STRAY_SUPERSEDED naming the second copy's commit with the reason "content-subset-of-replay-head"$/, (ctx) => {
    assert.equal(ctx.cli.status, 0, `expected LAND_REPLAY (exit 0), got: ${JSON.stringify(ctx.cli)}`);
    assert.ok(ctx.cli.stdout.includes('LAND_REPLAY'), `expected LAND_REPLAY, got: ${ctx.cli.stdout}`);
    const line = ctx.cli.stdout.split('\n').find((l) => l.startsWith('LAND_STRAY_SUPERSEDED') && l.includes(ctx.copyCommit));
    assert.ok(line, `expected a LAND_STRAY_SUPERSEDED line naming ${ctx.copyCommit}, got:\n${ctx.cli.stdout}`);
    assert.ok(line.endsWith('content-subset-of-replay-head'), `expected reason content-subset-of-replay-head, got: ${line}`);
    const branchLine = ctx.cli.stdout.split('\n').find((l) => l.startsWith('LAND_REPLAY'));
    ctx.replayBranch = branchLine.split(' ')[1];
    ctx.replayCommit = branchLine.split(' ')[2];
  });

  scoped(/^the replay branch's tip carries the land section and the follow-up lines exactly once in the evidence file$/, (ctx) => {
    const content = git(ctx.root, 'show', `${ctx.replayCommit}:${EVIDENCE_PATH}`);
    const landOccurrences = content.split('landed_at: 2026-01-01').length - 1;
    const followupOccurrences = content.split('more: 1').length - 1;
    assert.equal(landOccurrences, 1, `expected the land section exactly once, got ${landOccurrences} in:\n${content}`);
    assert.equal(followupOccurrences, 1, `expected the follow-up line exactly once, got ${followupOccurrences} in:\n${content}`);
    assert.ok(!content.includes('<<<<<<<'), `expected no leftover conflict markers, got:\n${content}`);
    spawnSync('git', ['-C', ctx.root, 'branch', '-q', '-D', ctx.replayBranch]);
  });

  // ── Then: scenario 02 ─────────────────────────────────────────────────
  scoped(/^it exits LAND_ESCALATE and the reason names the second copy's commit$/, (ctx) => {
    assert.equal(ctx.cli.status, 1, `expected LAND_ESCALATE (exit 1), got: ${JSON.stringify(ctx.cli)}`);
    assert.ok(ctx.cli.stdout.includes('LAND_ESCALATE'), `expected LAND_ESCALATE, got: ${ctx.cli.stdout}`);
    assert.ok(ctx.cli.stdout.includes(ctx.copyCommit), `reason does not name ${ctx.copyCommit}: ${ctx.cli.stdout}`);
  });

  scoped(/^no LAND_STRAY_SUPERSEDED line names the second copy's commit$/, (ctx) => {
    assert.ok(
      !ctx.cli.stdout.split('\n').some((l) => l.startsWith('LAND_STRAY_SUPERSEDED') && l.includes(ctx.copyCommit)),
      `must never print LAND_STRAY_SUPERSEDED naming ${ctx.copyCommit}, got:\n${ctx.cli.stdout}`
    );
  });
}

module.exports = { registerSteps };
