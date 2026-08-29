'use strict';

// BL-1257: step handlers for "the review-time entangled-tip check answers
// 'did this author work outside the ticket?'". Drives the REAL
// task_scope_gate_lib.bb (via a `bb -e` call, matching the JSON-result
// pattern already established this session) and the REAL
// task_scope_gate_cli.bb end to end against a real git fixture - the same
// fixture shape task_scope_gate_lib_test_runner.bb already establishes for
// this exact lib, never a reimplementation of the scope walk.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const SCRIPTS_DIR = path.join(REPO_ROOT, 'swarmforge', 'scripts');
const SCOPE_LIB = path.join(SCRIPTS_DIR, 'task_scope_gate_lib.bb');
const SCOPE_CLI = path.join(SCRIPTS_DIR, 'task_scope_gate_cli.bb');
const FEATURE = 'The review-time entangled-tip check answers "did this author work outside the ticket?"';

const GIT_ID = ['-c', 'user.email=t@t', '-c', 'user.name=t'];

function git(cwd, args) {
  execFileSync('git', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
}

function gitOut(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

function gitCommit(cwd, message) {
  git(cwd, [...GIT_ID, 'commit', '-q', '-m', message]);
}

function commitFile(root, relPath, content, message) {
  const full = path.join(root, relPath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
  git(root, ['add', '-A']);
  gitCommit(root, message);
}

function markOriginMainHere(root) {
  const sha = gitOut(root, ['rev-parse', 'HEAD']);
  git(root, ['update-ref', 'refs/remotes/origin/main', sha]);
}

// Records a completed handoff for taskName citing commit - the durable
// boundary last-handoff-commit reads back, mirroring
// task_scope_gate_lib_test_runner.bb's own record-handoff! exactly.
function recordHandoff(root, taskName, commit) {
  const rolesTsv = path.join(root, '.swarmforge', 'roles.tsv');
  if (!fs.existsSync(rolesTsv)) {
    fs.mkdirSync(path.dirname(rolesTsv), { recursive: true });
    fs.writeFileSync(rolesTsv, ['cleaner', 'cleaner', root, 'session', 'Cleaner', 'claude', 'task'].join('\t') + '\n');
  }
  const completedDir = path.join(root, '.swarmforge', 'handoffs', 'inbox', 'completed');
  fs.mkdirSync(completedDir, { recursive: true });
  fs.writeFileSync(
    path.join(completedDir, `00_${process.hrtime.bigint()}_from_coder_to_cleaner_for_cleaner.handoff`),
    `task: ${taskName}\ncommit: ${commit}\nto: cleaner\nfrom: coder\n`,
  );
}

function runScopeLib(root, taskName, commit) {
  const script = `
(require '[cheshire.core :as json])
(load-file "${SCOPE_LIB}")
(def result (task-scope-gate-lib/findings-for-git-handoff {:root "${root}" :task-name "${taskName}" :commit "${commit}"}))
(println (json/generate-string result))
`;
  const out = execFileSync('bb', ['-e', script], { encoding: 'utf8' });
  return JSON.parse(out.trim().split('\n').pop());
}

function runScopeCli(root, taskName, commit) {
  const res = spawnSync('bb', [SCOPE_CLI, taskName, commit, root], { encoding: 'utf8' });
  return { status: res.status, out: `${res.stdout || ''}${res.stderr || ''}` };
}

function mkRoot(ctx) {
  if (ctx.bl1257?.root) return ctx.bl1257.root;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bl1257-'));
  git(root, ['init', '-q', '-b', 'main']);
  git(root, [...GIT_ID, 'commit', '-q', '--allow-empty', '-m', 'seed']);
  ctx.bl1257 = { root };
  return root;
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  // ── Background ───────────────────────────────────────────────────────
  scoped(
    /^a repository whose local "main" is ahead of "origin\/main" by commits the parcel's author did not write$/,
    (ctx) => {
      const root = mkRoot(ctx);
      markOriginMainHere(root);
      // A batch sibling's own commit, tagged for a DIFFERENT ticket -
      // exactly the "local main lags origin by design" lag this ticket
      // exists to stop mattering.
      commitFile(root, 'backlog/active/BL-91003-fixture.yaml', 'id: BL-91003\n', 'BL-91003: unrelated sibling work');
      ctx.bl1257.lagPath = 'backlog/active/BL-91003-fixture.yaml';
    },
  );

  scoped(/^a parcel citing a commit for the task "BL-alpha"$/, (ctx) => {
    mkRoot(ctx);
    ctx.bl1257.taskName = 'BL-91001-fixture';
    ctx.bl1257.taskTicketId = 'BL-91001';
  });

  // ── Scenario 01 ──────────────────────────────────────────────────────
  scoped(/^the cited commit's own commits for "BL-alpha" touch only paths owned by "BL-alpha"$/, (ctx) => {
    const { root, taskName } = ctx.bl1257;
    // The prior handoff boundary sits BEFORE this task's own work, so the
    // walk starts here - matching "a parcel citing a commit" (its own
    // commits since its last handoff), never picking up the lag commit
    // above as one of ITS OWN commits (it is not tagged for this task).
    const boundary = gitOut(root, ['rev-parse', 'HEAD']);
    recordHandoff(root, taskName, boundary);
    commitFile(root, 'backlog/active/BL-91001-fixture.yaml', 'id: BL-91001\n', `${taskName}: own work`);
  });

  scoped(/^the tip additionally contains commits that are already on local "main"$/, () => {
    // No-op: the Background's lag commit is already an ancestor of HEAD -
    // "additionally contains" describes the fixture already built above.
  });

  scoped(/^the review-time scope check runs on the cited commit$/, (ctx) => {
    const { root, taskName } = ctx.bl1257;
    const commit = gitOut(root, ['rev-parse', 'HEAD']);
    ctx.bl1257.commit = commit;
    ctx.bl1257.libResult = runScopeLib(root, taskName, commit);
  });

  scoped(/^the check reports no foreign scope$/, (ctx) => {
    const findings = ctx.bl1257.libResult.findings || [];
    assert.equal(findings.length, 0, `expected no foreign scope, got: ${JSON.stringify(findings)}`);
  });

  scoped(/^the paths contributed by the commits already on local "main" are not listed$/, (ctx) => {
    const { libResult, lagPath } = ctx.bl1257;
    const paths = (libResult.findings || []).map((f) => f.path);
    assert.ok(!paths.includes(lagPath), `expected the lag path "${lagPath}" not to appear, got: ${JSON.stringify(paths)}`);
  });

  // ── Scenario 02 ──────────────────────────────────────────────────────
  scoped(/^a commit named for "BL-alpha" also touches a path owned by "BL-beta"$/, (ctx) => {
    const { root, taskName } = ctx.bl1257;
    const boundary = gitOut(root, ['rev-parse', 'HEAD']);
    recordHandoff(root, taskName, boundary);
    fs.mkdirSync(path.join(root, 'backlog', 'active'), { recursive: true });
    fs.writeFileSync(path.join(root, 'backlog', 'active', 'BL-91001-fixture.yaml'), 'id: BL-91001\n');
    fs.writeFileSync(path.join(root, 'backlog', 'active', 'BL-91002-fixture.yaml'), 'id: BL-91002\n');
    git(root, ['add', '-A']);
    gitCommit(root, `${taskName}: own work, but also touches BL-91002's yaml`);
    ctx.bl1257.foreignPath = 'backlog/active/BL-91002-fixture.yaml';
    ctx.bl1257.commit = gitOut(root, ['rev-parse', 'HEAD']);
  });

  scoped(/^the check reports foreign scope$/, (ctx) => {
    const findings = ctx.bl1257.libResult.findings || [];
    assert.ok(findings.length > 0, `expected foreign scope, got none: ${JSON.stringify(ctx.bl1257.libResult)}`);
  });

  scoped(/^the reported paths include the path owned by "BL-beta"$/, (ctx) => {
    const paths = (ctx.bl1257.libResult.findings || []).map((f) => f.path);
    assert.ok(paths.includes(ctx.bl1257.foreignPath), `expected ${ctx.bl1257.foreignPath} in ${JSON.stringify(paths)}`);
  });

  // ── Scenario 03 (outline) ────────────────────────────────────────────
  const KNOWN_SHAPES = new Set([
    'authored-scope-clean-with-origin-lag',
    'authored-scope-clean-with-landed-siblings',
    'authored-commit-touching-a-foreign-ticket',
  ]);

  scoped(/^a cited commit of shape "(.+)"$/, (ctx, shape) => {
    assert.ok(KNOWN_SHAPES.has(shape), `unknown shape "${shape}"`);
    // Always a FRESH root, never the Background's - the Background already
    // committed a "BL-91003-fixture.yaml: unrelated sibling work" fixture,
    // and this scenario's own "origin-lag" shape below commits the exact
    // same path+content again, which is a genuine no-op git commit
    // (nothing staged) against a reused root.
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bl1257-'));
    git(root, ['init', '-q', '-b', 'main']);
    git(root, [...GIT_ID, 'commit', '-q', '--allow-empty', '-m', 'seed']);
    ctx.bl1257 = { root };
    const taskName = 'BL-91001-fixture';
    ctx.bl1257.taskName = taskName;
    markOriginMainHere(root);
    if (shape === 'authored-scope-clean-with-origin-lag') {
      commitFile(root, 'backlog/active/BL-91003-fixture.yaml', 'id: BL-91003\n', 'BL-91003: lag commit, unrelated');
      const boundary = gitOut(root, ['rev-parse', 'HEAD']);
      recordHandoff(root, taskName, boundary);
      commitFile(root, 'backlog/active/BL-91001-fixture.yaml', 'id: BL-91001\n', `${taskName}: own work`);
    } else if (shape === 'authored-scope-clean-with-landed-siblings') {
      const boundary = gitOut(root, ['rev-parse', 'HEAD']);
      recordHandoff(root, taskName, boundary);
      // A batch sibling's OWN commit (tagged for its own ticket), landed
      // in the same turn, interleaved before this task's own commit.
      commitFile(root, 'backlog/active/BL-91004-fixture.yaml', 'id: BL-91004\n', 'BL-91004: batch sibling, own ticket');
      commitFile(root, 'backlog/active/BL-91001-fixture.yaml', 'id: BL-91001\n', `${taskName}: own work`);
    } else {
      const boundary = gitOut(root, ['rev-parse', 'HEAD']);
      recordHandoff(root, taskName, boundary);
      fs.mkdirSync(path.join(root, 'backlog', 'active'), { recursive: true });
      fs.writeFileSync(path.join(root, 'backlog', 'active', 'BL-91001-fixture.yaml'), 'id: BL-91001\n');
      fs.writeFileSync(path.join(root, 'backlog', 'active', 'BL-91002-fixture.yaml'), 'id: BL-91002\n');
      git(root, ['add', '-A']);
      gitCommit(root, `${taskName}: own work, also touches BL-91002`);
    }
    ctx.bl1257.commit = gitOut(root, ['rev-parse', 'HEAD']);
  });

  scoped(/^the send-time scope gate and the review-time scope check both run on it$/, (ctx) => {
    const { root, taskName, commit } = ctx.bl1257;
    ctx.bl1257.libResult = runScopeLib(root, taskName, commit);
    ctx.bl1257.cliResult = runScopeCli(root, taskName, commit);
  });

  scoped(/^both report foreign scope "(yes|no)"$/, (ctx, expected) => {
    const wantForeign = expected === 'yes';
    const libFindings = ctx.bl1257.libResult.findings || [];
    const libForeign = libFindings.length > 0;
    const cliForeign = ctx.bl1257.cliResult.status === 1;
    assert.equal(libForeign, wantForeign, `send-time gate: expected foreign=${wantForeign}, findings: ${JSON.stringify(libFindings)}`);
    assert.equal(cliForeign, wantForeign, `review-time check: expected foreign=${wantForeign}, out: ${ctx.bl1257.cliResult.out}`);
  });

  // ── Scenario 04 ──────────────────────────────────────────────────────
  scoped(/^the review-time scope check refuses the parcel$/, (ctx) => {
    const { root, taskName, commit } = ctx.bl1257;
    ctx.bl1257.cliResult = runScopeCli(root, taskName, commit);
    assert.equal(ctx.bl1257.cliResult.status, 1, ctx.bl1257.cliResult.out);
  });

  scoped(/^the refusal names each foreign path$/, (ctx) => {
    assert.match(ctx.bl1257.cliResult.out, /backlog\/active\/BL-91002-fixture\.yaml/, ctx.bl1257.cliResult.out);
  });

  scoped(/^the refusal names the ticket that owns each foreign path$/, (ctx) => {
    assert.match(ctx.bl1257.cliResult.out, /BL-91002/, ctx.bl1257.cliResult.out);
  });

  scoped(/^the refusal does not state a bare count of paths differing from "origin\/main"$/, (ctx) => {
    assert.doesNotMatch(ctx.bl1257.cliResult.out, /origin\/main/, ctx.bl1257.cliResult.out);
  });
}

module.exports = { registerSteps };
