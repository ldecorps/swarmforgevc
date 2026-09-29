'use strict';

// BL-1795: step handlers for "a closed owner's draft its own land
// superseded is never replayed". Drives the REAL swarmforge/scripts/
// land_step_cli.bb - never a reimplementation of the decision, mirroring
// bl1785ClosedOwnerRecordStraySteps.js / bl1794ReplayHeadSupersededStraySteps.js's
// own fixture technique (a real git repository under mkdtemp with its own
// origin remote, BL-1390).
//
// docs/ paths (not backlog/evidence/) are used throughout so the fixture's
// strays fall inside closed-owner-pure-evidence-stray?'s existing
// pure-evidence-or-docs-paths? allowlist (`stray-pure-evidence-prefixes`
// already includes "docs/") - the same shape the real incidents this
// ticket fixes hit (Specification.MD under docs/reference/, the
// handoff-flow.mmd/BL-1697 how-to under docs/).

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const { mkSocketFixtureRoot } = require('./lib/socketFixtureRoot');

const FEATURE = "BL-1795 A closed owner's draft its own land superseded is never replayed";

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const CLI = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'land_step_cli.bb');

const LANDING = 'BL-9785';
const SIBLING = 'BL-9787';
const TICKET_PATH = `backlog/done/${SIBLING}-fixture.yaml`;

const DOCS_PATHS = { shared: 'docs/shared.md', 'sibling-only': 'docs/sibling-only.md' };
const BASE_LINE = 'base line\n';
const DRAFT_LINE = 'draft entry\n';
const REWRITTEN_LINE = 'rewritten entry\n';
const LANDING_LINE = 'landing ticket entry\n';
const POST_LAND_LINE = 'post-land edit\n';
const OTHER_MAIN_LINE = "main's own unrelated later edit\n";

function git(root, ...args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
}

function head(root) {
  return git(root, 'rev-parse', 'HEAD');
}

function writeFile(root, rel, body) {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, body);
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

function markOriginMain(root) {
  git(root, 'update-ref', 'refs/remotes/origin/main', head(root));
}

function runCli(root, taskName, commit) {
  const r = spawnSync('bb', [CLI, taskName, commit], { cwd: root, encoding: 'utf8' });
  return { status: r.status, stdout: r.stdout || '', stderr: r.stderr || '' };
}

const ticketBody = (abandonedShaOrList) =>
  `id: ${SIBLING}\ntitle: sibling fixture for BL-1795\nmilestone: M8\ntype: chore\nstatus: done\n` +
  `human_approval: approved\nassigned_to: coder\nabandoned_commits: [${abandonedShaOrList}]\n`;

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);
  let clock = Date.parse('2026-01-01T00:00:00Z');
  const nextIso = () => {
    clock += 1000;
    return new Date(clock).toISOString();
  };

  scoped(/^a fixture repository with an origin and a main branch$/, (ctx) => {
    const root = mkSocketFixtureRoot('bl1795-fixture-');
    git(root, 'init', '-q', '-b', 'main', '.');
    git(root, 'config', 'user.email', 't@t');
    git(root, 'config', 'user.name', 't');
    git(root, 'config', 'commit.gpgsign', 'false');
    writeFile(root, DOCS_PATHS.shared, BASE_LINE);
    writeFile(root, DOCS_PATHS['sibling-only'], BASE_LINE);
    ctx.root = root;
    ctx.seedCommit = commitAll(root, 'seed', nextIso());
    markOriginMain(root);
    ctx.origin = head(root);
  });

  // The placeholder abandoned_commits entry (the seed commit itself) gives
  // the field its real production shape from the start; nothing is ever an
  // ancestor of the seed (the very first commit), so it is inert for the
  // ancestor check below until a scenario-specific Given replaces it with
  // the real approved tip once that commit's sha is known.
  scoped(
    /^a sibling ticket closed on origin\/main whose done copy lists its approved tip under abandoned_commits$/,
    (ctx) => {
      writeFile(ctx.root, TICKET_PATH, ticketBody(ctx.seedCommit));
      commitAll(ctx.root, `${SIBLING}: closed`, nextIso());
      markOriginMain(ctx.root);
      ctx.origin = head(ctx.root);
    }
  );

  function recordApprovedTip(ctx, approvedTip) {
    git(ctx.root, 'checkout', '-q', 'main');
    const body = fs.readFileSync(path.join(ctx.root, TICKET_PATH), 'utf8');
    const updated = body.replace(/abandoned_commits: \[[^\]]*\]\n/, `abandoned_commits: [${approvedTip}]\n`);
    assert.notEqual(updated, body, 'expected to replace the placeholder abandoned_commits entry');
    writeFile(ctx.root, TICKET_PATH, updated);
    commitAll(ctx.root, `${SIBLING}: record the approved tip`, nextIso());
    markOriginMain(ctx.root);
    ctx.origin = head(ctx.root);
  }

  // ── Scenarios 01/02's shared Given (quoted <docs file>/<action> pair) ──
  scoped(
    /^the sibling has a pre-land draft entry in a "([^"]+)" docs file, and its approved tip "([^"]+)" that entry$/,
    (ctx, fileKind, action) => {
      const docsPath = DOCS_PATHS[fileKind];
      assert.ok(docsPath, `unknown <docs file> example value "${fileKind}"`);
      assert.ok(['rewrites', 'removes'].includes(action), `unknown <action> example value "${action}"`);
      ctx.docsPath = docsPath;
      ctx.fileKind = fileKind;

      git(ctx.root, 'checkout', '-q', '-b', 'sibling-work', ctx.origin);
      writeFile(ctx.root, docsPath, BASE_LINE + DRAFT_LINE);
      ctx.draftCommit = commitAll(ctx.root, `${SIBLING}: pre-land draft entry`, nextIso());

      ctx.landedContent = action === 'rewrites' ? BASE_LINE + REWRITTEN_LINE : BASE_LINE;
      writeFile(ctx.root, docsPath, ctx.landedContent);
      ctx.approvedTip = commitAll(ctx.root, `${SIBLING}: ${action} the draft entry before landing`, nextIso());

      recordApprovedTip(ctx, ctx.approvedTip);
    }
  );

  scoped(/^origin\/main carries the sibling's landed copy of that file$/, (ctx) => {
    git(ctx.root, 'checkout', '-q', 'main');
    const abs = path.join(ctx.root, ctx.docsPath);
    // The "removes" action already leaves the file at BASE_LINE, identical
    // to what main already has - nothing to commit there, and committing
    // is skipped rather than failing on an empty index.
    if (fs.readFileSync(abs, 'utf8') !== ctx.landedContent) {
      writeFile(ctx.root, ctx.docsPath, ctx.landedContent);
      commitAll(ctx.root, `${SIBLING}: landed copy on main`, nextIso());
      markOriginMain(ctx.root);
      ctx.origin = head(ctx.root);
    }
  });

  // Forks from approvedTip (not draftCommit alone), so BOTH the draft and
  // its own rewrite/removal are in the role branch's ancestry: the
  // sibling's OWN line changes across the two then net to exactly what
  // origin/main already carries (the draft's lines are added by one commit
  // and taken back out by the other), reading as LANDED rather than
  // leaving an unlanded passenger on the shared path - a separate,
  // pre-existing entangled-siblings/BL-1375 concern this ticket does not
  // touch. Only the check this ticket adds decides whether draftCommit
  // itself is cherry-picked or superseded.
  scoped(/^the landing ticket's own commit adds its own entry to the shared docs file on the same role branch$/, (ctx) => {
    const forkFrom = ctx.postLandCommit || ctx.approvedTip;
    git(ctx.root, 'checkout', '-q', '-b', 'role', forkFrom);
    const abs = path.join(ctx.root, ctx.docsPath);
    fs.writeFileSync(abs, fs.readFileSync(abs, 'utf8') + LANDING_LINE);
    ctx.landingCommit = commitAll(ctx.root, `${LANDING}: own entry`, nextIso());
  });

  scoped(
    /^the landing ticket's own commit, which never touches the sibling-only docs file, is on the same role branch$/,
    (ctx) => {
      // Forks from draftCommit, never approvedTip: the landing ticket
      // never touches this path, so there is no shared-path passenger
      // concern to avoid here (unlike the shared-file scenario above) -
      // and the role branch's own tip must still carry the draft's line,
      // otherwise stray-tip-already-landed? (a pre-existing, unrelated
      // check) would already skip the cherry-pick attempt on content
      // grounds alone, before this ticket's own check is ever reached.
      git(ctx.root, 'checkout', '-q', '-b', 'role', ctx.draftCommit);
      writeFile(ctx.root, `backlog/active/${LANDING}-fixture.yaml`, `id: ${LANDING}\ntitle: landing fixture\nmilestone: M8\n`);
      ctx.landingCommit = commitAll(ctx.root, `${LANDING}: own work, unrelated file`, nextIso());
    }
  );

  // ── Scenario 03's own Given ─────────────────────────────────────────────
  scoped(
    /^the sibling has a commit made after its land, in the shared docs file, that adds a line origin\/main lacks and conflicts with origin\/main$/,
    (ctx) => {
      ctx.docsPath = DOCS_PATHS.shared;
      ctx.fileKind = 'shared';

      // Forks BEFORE main's own later edit below, so the stray's own patch
      // context (BASE_LINE) no longer matches main's tip once that edit
      // lands - a genuine conflict, never a clean apply.
      git(ctx.root, 'checkout', '-q', '-b', 'sibling-postland', ctx.origin);
      writeFile(ctx.root, ctx.docsPath, POST_LAND_LINE);
      ctx.postLandCommit = commitAll(ctx.root, `${SIBLING}: post-land edit, outside any abandoned_commits`, nextIso());

      // Never recorded under abandoned_commits - the placeholder (the seed
      // commit) is the only entry, and postLandCommit is not its ancestor.
      git(ctx.root, 'checkout', '-q', 'main');
      writeFile(ctx.root, ctx.docsPath, OTHER_MAIN_LINE);
      commitAll(ctx.root, "main: unrelated later edit of the same region", nextIso());
      markOriginMain(ctx.root);
      ctx.origin = head(ctx.root);
    }
  );

  scoped(/^the land step runs for the landing ticket at the tip$/, (ctx) => {
    ctx.tip = head(ctx.root);
    ctx.cli = runCli(ctx.root, `${LANDING}-fixture`, ctx.tip);
  });

  // ── Then: scenarios 01/02 ────────────────────────────────────────────────
  scoped(
    /^it exits LAND_REPLAY and prints LAND_STRAY_SUPERSEDED naming the draft commit with the reason "ancestor-of-owner-abandoned"$/,
    (ctx) => {
      assert.equal(ctx.cli.status, 0, `expected LAND_REPLAY (exit 0), got: ${JSON.stringify(ctx.cli)}`);
      assert.ok(ctx.cli.stdout.includes('LAND_REPLAY'), `expected LAND_REPLAY, got: ${ctx.cli.stdout}`);
      const line = ctx.cli.stdout.split('\n').find((l) => l.startsWith('LAND_STRAY_SUPERSEDED') && l.includes(ctx.draftCommit));
      assert.ok(line, `expected a LAND_STRAY_SUPERSEDED line naming ${ctx.draftCommit}, got:\n${ctx.cli.stdout}`);
      assert.ok(line.endsWith('ancestor-of-owner-abandoned'), `expected reason ancestor-of-owner-abandoned, got: ${line}`);
      const branchLine = ctx.cli.stdout.split('\n').find((l) => l.startsWith('LAND_REPLAY'));
      ctx.replayBranch = branchLine.split(' ')[1];
      ctx.replayCommit = branchLine.split(' ')[2];
    }
  );

  scoped(
    /^the replay branch's tip carries the landing ticket's own entry and the sibling's landed entry, and none of the draft entry's lines$/,
    (ctx) => {
      const content = git(ctx.root, 'show', `${ctx.replayCommit}:${ctx.docsPath}`);
      assert.ok(content.includes(LANDING_LINE.trim()), `expected the landing ticket's own entry, got:\n${content}`);
      assert.ok(content.includes(REWRITTEN_LINE.trim()), `expected the sibling's landed (rewritten) entry, got:\n${content}`);
      assert.ok(!content.includes(DRAFT_LINE.trim()), `expected none of the draft entry's lines, got:\n${content}`);
      spawnSync('git', ['-C', ctx.root, 'branch', '-q', '-D', ctx.replayBranch]);
    }
  );

  scoped(/^the replay branch's tip carries the sibling's docs file byte-identical to origin\/main's$/, (ctx) => {
    const replayContent = git(ctx.root, 'show', `${ctx.replayCommit}:${ctx.docsPath}`);
    const mainContent = git(ctx.root, 'show', `origin/main:${ctx.docsPath}`);
    assert.equal(replayContent, mainContent, `expected the replay's copy byte-identical to origin/main's`);
    spawnSync('git', ['-C', ctx.root, 'branch', '-q', '-D', ctx.replayBranch]);
  });

  // ── Then: scenario 03 ─────────────────────────────────────────────────
  scoped(/^it exits LAND_ESCALATE and the reason names the sibling's post-land commit$/, (ctx) => {
    assert.equal(ctx.cli.status, 1, `expected LAND_ESCALATE (exit 1), got: ${JSON.stringify(ctx.cli)}`);
    assert.ok(ctx.cli.stdout.includes('LAND_ESCALATE'), `expected LAND_ESCALATE, got: ${ctx.cli.stdout}`);
    assert.ok(ctx.cli.stdout.includes(ctx.postLandCommit), `reason does not name ${ctx.postLandCommit}: ${ctx.cli.stdout}`);
  });

  scoped(/^no LAND_STRAY_SUPERSEDED line names the sibling's post-land commit$/, (ctx) => {
    assert.ok(
      !ctx.cli.stdout.split('\n').some((l) => l.startsWith('LAND_STRAY_SUPERSEDED') && l.includes(ctx.postLandCommit)),
      `must never print LAND_STRAY_SUPERSEDED naming ${ctx.postLandCommit}, got:\n${ctx.cli.stdout}`
    );
  });
}

module.exports = { registerSteps };
