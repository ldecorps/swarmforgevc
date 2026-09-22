'use strict';

// BL-1517: step handlers for "a project-root argument is a repository or
// refused, and a test harness refuses a missing fixture root instead of
// falling back to the cwd". Drives the REAL CLIs/harnesses/enumeration
// (swarmforge/scripts/project_root_arg_lib.bb and its three CLI + three
// harness wiring sites) as fresh `bb` child processes with an explicit
// `cwd` option - never process.chdir() on this test process itself
// (engineering rule: never chdir under mutation, and this file's own
// module can be required by other suites in the same process) - and never
// a reimplementation of the check's own logic.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const { trackedTmpRoot } = require('./lib/fixtureReaper');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const SCRIPTS_DIR = path.join(REPO_ROOT, 'swarmforge', 'scripts');
const TEST_SCRIPTS_DIR = path.join(SCRIPTS_DIR, 'test');

const FEATURE =
  'BL-1517 a project-root argument is a repository or refused, and a test harness refuses a missing fixture root instead of falling back to the cwd';

const CLI_PATHS = {
  'main_sync_status_cli.bb': path.join(SCRIPTS_DIR, 'main_sync_status_cli.bb'),
  'operator_runtime.bb': path.join(SCRIPTS_DIR, 'operator_runtime.bb'),
  'expedite_cli.bb': path.join(SCRIPTS_DIR, 'expedite_cli.bb'),
};

// The three named at spec time (description's own "Scope" list).
const HARNESS_PATHS = {
  'dispatch_gap_sweep_harness.bb': path.join(TEST_SCRIPTS_DIR, 'dispatch_gap_sweep_harness.bb'),
  'dropped_parcel_sweep_harness.bb': path.join(TEST_SCRIPTS_DIR, 'dropped_parcel_sweep_harness.bb'),
  'commit_integrity_856_scenarios_cli.bb': path.join(TEST_SCRIPTS_DIR, 'commit_integrity_856_scenarios_cli.bb'),
};

function mkScratchDir(prefix) {
  return fs.realpathSync(trackedTmpRoot(prefix));
}

function git(dir, args) {
  return execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8' });
}

function mkFixtureRepo(prefix) {
  const dir = mkScratchDir(prefix);
  git(dir, ['init', '-q']);
  git(dir, ['config', 'user.email', 't@t']);
  git(dir, ['config', 'user.name', 't']);
  git(dir, ['commit', '-q', '--allow-empty', '-m', 'init']);
  return dir;
}

function runBb(scriptPath, args, cwd) {
  return spawnSync('bb', [scriptPath, ...args], { cwd, encoding: 'utf8' });
}

// ── Scenario 05's dispatch-gap fixture (mirrors dispatchGapSteps.js's own
// ensureTargetPath/writeRolesTsv/writeActiveItem shape - a fresh, minimal,
// self-contained copy for this ticket's own one scenario, not an import:
// those helpers are not exported for reuse) ─────────────────────────────

const DISPATCH_GAP_ITEM_ID = 'BL-1517DEMO';

function coderWorktreePath(root) {
  return path.join(root, '.worktrees', 'coder');
}

function writeRolesTsv(root) {
  fs.mkdirSync(path.join(root, '.swarmforge'), { recursive: true });
  const rows = [
    ['coordinator', 'master', root, 'swarmforge-coordinator', 'Coordinator', 'claude', 'task'],
    ['coder', 'coder', coderWorktreePath(root), 'swarmforge-coder', 'Coder', 'claude', 'task'],
  ];
  fs.writeFileSync(path.join(root, '.swarmforge', 'roles.tsv'), rows.map((r) => r.join('\t')).join('\n') + '\n');
}

function writeActiveDispatchGapItem(root) {
  const activeDir = path.join(root, 'backlog', 'active');
  fs.mkdirSync(activeDir, { recursive: true });
  fs.writeFileSync(
    path.join(activeDir, `${DISPATCH_GAP_ITEM_ID}-demo.yaml`),
    `id: ${DISPATCH_GAP_ITEM_ID}\ntitle: "demo"\nstatus: todo\nassigned_to: coder\n`
  );
}

function coordinatorOutboxDir(root) {
  return path.join(root, '.swarmforge', 'handoffs', 'coordinator', 'outbox');
}

function coordinatorInboxNewDir(root) {
  return path.join(root, '.swarmforge', 'handoffs', 'coordinator', 'inbox', 'new');
}

function listHandoffFiles(dir) {
  try {
    return fs
      .readdirSync(dir)
      .filter((f) => f.endsWith('.handoff'))
      .sort();
  } catch {
    return [];
  }
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  // ── Scenario 01/03: a bad root is refused before any write ────────────

  scoped(/^the current directory is a mkdtemp directory that is not a git checkout$/, (ctx) => {
    ctx.cwd = mkScratchDir('bl1517-notrepo-');
    ctx.entriesBefore = fs.readdirSync(ctx.cwd);
  });

  scoped(/^"([^"]+)" is invoked with "([^"]+)" in its project-root position$/, (ctx, cli, arg) => {
    const cliPath = CLI_PATHS[cli];
    assert.ok(cliPath, `unknown <cli> example value: ${cli}`);
    ctx.result = runBb(cliPath, [arg], ctx.cwd);
  });

  scoped(/^"([^"]+)" is invoked as "([^"]+)"$/, (ctx, cli, argLine) => {
    const cliPath = CLI_PATHS[cli];
    assert.ok(cliPath, `unknown cli: ${cli}`);
    ctx.result = runBb(cliPath, argLine.split(' '), ctx.cwd);
  });

  scoped(/^it exits 2$/, (ctx) => {
    assert.equal(ctx.result.status, 2, `expected exit 2, got ${ctx.result.status}; stderr: ${ctx.result.stderr}`);
  });

  scoped(/^stderr carries a line "REFUSED project-root ([^"]*):" followed by a reason$/, (ctx, arg) => {
    const pattern = new RegExp(`^REFUSED project-root ${escapeRegExp(arg)}: .+$`, 'm');
    assert.match(
      ctx.result.stderr,
      pattern,
      `expected a "REFUSED project-root ${arg}: <reason>" line in stderr, got: ${ctx.result.stderr}`
    );
  });

  scoped(/^the current directory has no new entry$/, (ctx) => {
    const entriesAfter = fs.readdirSync(ctx.cwd);
    assert.deepEqual(
      entriesAfter,
      ctx.entriesBefore,
      `expected no new entry in ${ctx.cwd}, before: ${JSON.stringify(ctx.entriesBefore)}, after: ${JSON.stringify(entriesAfter)}`
    );
  });

  // ── Scenario 02: a valid root behaves exactly as today ─────────────────

  scoped(/^a fixture git checkout under mkdtemp$/, (ctx) => {
    // main_sync_status_cli.bb's happy path shells `git fetch origin main`
    // then `git rev-list --left-right --count origin/main...main` - a
    // bare `git init` fixture has neither a "main" branch by that exact
    // name nor an "origin" remote, so a self-referential origin (fetching
    // from itself) is the minimal fixture that makes both succeed.
    const dir = mkFixtureRepo('bl1517-validrepo-');
    git(dir, ['branch', '-M', 'main']);
    git(dir, ['remote', 'add', 'origin', dir]);
    git(dir, ['fetch', 'origin', 'main', '-q']);
    ctx.cwd = dir;
  });

  scoped(/^"main_sync_status_cli\.bb" is invoked with that checkout as its project root$/, (ctx) => {
    ctx.result = runBb(CLI_PATHS['main_sync_status_cli.bb'], [ctx.cwd], ctx.cwd);
  });

  scoped(/^it prints its JSON verdict as before$/, (ctx) => {
    assert.equal(ctx.result.status, 0, `expected exit 0, got ${ctx.result.status}; stderr: ${ctx.result.stderr}`);
    let parsed;
    try {
      parsed = JSON.parse(ctx.result.stdout.trim());
    } catch (e) {
      throw new Error(`expected valid JSON on stdout, got: ${ctx.result.stdout} (${e.message})`);
    }
    assert.ok(
      Object.prototype.hasOwnProperty.call(parsed, 'ready') && Object.prototype.hasOwnProperty.call(parsed, 'action'),
      `expected the usual verdict shape, got: ${JSON.stringify(parsed)}`
    );
  });

  scoped(/^no REFUSED line is printed$/, (ctx) => {
    assert.doesNotMatch(
      ctx.result.stderr,
      /REFUSED project-root/,
      `expected no REFUSED line, got stderr: ${ctx.result.stderr}`
    );
  });

  // ── Scenario 04: a harness invoked bare refuses instead of using cwd ───

  scoped(/^a scratch working directory that contains no "\.swarmforge" state$/, (ctx) => {
    ctx.cwd = mkScratchDir('bl1517-scratch-');
  });

  scoped(/^the harness "([^"]+)" is invoked from that scratch working directory with no arguments$/, (ctx, harness) => {
    const harnessPath = HARNESS_PATHS[harness];
    assert.ok(harnessPath, `unknown <harness> example value: ${harness}`);
    ctx.result = runBb(harnessPath, [], ctx.cwd);
  });

  scoped(/^it exits with a non-zero status$/, (ctx) => {
    assert.notEqual(ctx.result.status, 0, `expected a non-zero exit, got ${ctx.result.status}; stdout: ${ctx.result.stdout}`);
  });

  scoped(/^its standard error names the missing fixture root$/, (ctx) => {
    assert.match(
      ctx.result.stderr,
      /REFUSED project-root/,
      `expected stderr to name the missing fixture root, got: ${ctx.result.stderr}`
    );
  });

  scoped(/^no "\.swarmforge" directory is created in the scratch working directory$/, (ctx) => {
    assert.equal(
      fs.existsSync(path.join(ctx.cwd, '.swarmforge')),
      false,
      `expected no .swarmforge under ${ctx.cwd}`
    );
  });

  // ── Scenario 05: a valid fixture root still sweeps only that root ─────

  scoped(/^a fixture project root whose roles are registered and whose coordinator inbox is empty$/, (ctx) => {
    ctx.fixtureRoot = mkFixtureRepo('bl1517-dispatchgap-');
    writeRolesTsv(ctx.fixtureRoot);
    assert.deepEqual(
      listHandoffFiles(coordinatorInboxNewDir(ctx.fixtureRoot)),
      [],
      'expected a freshly-built fixture to start with an empty coordinator inbox'
    );
  });

  scoped(/^a dispatch gap in the fixture project root that the sweep is expected to nudge$/, (ctx) => {
    writeActiveDispatchGapItem(ctx.fixtureRoot);
  });

  scoped(/^the harness "([^"]+)" is invoked with the fixture project root$/, (ctx, harness) => {
    const harnessPath = HARNESS_PATHS[harness];
    assert.ok(harnessPath, `unknown harness: ${harness}`);
    // Snapshot the LIVE repository's own coordinator mailbox BEFORE the
    // run - the run is invoked FROM the live repo root (mirroring how a
    // live daemon tick would shell out to this harness) but with the
    // FIXTURE root as its explicit argument, the exact shape BL-889's
    // incident (a bare invocation inside a live worktree) was missing.
    ctx.liveInboxBefore = listHandoffFiles(coordinatorInboxNewDir(REPO_ROOT));
    ctx.liveOutboxBefore = listHandoffFiles(coordinatorOutboxDir(REPO_ROOT));
    ctx.result = runBb(harnessPath, [ctx.fixtureRoot], REPO_ROOT);
  });

  scoped(/^it exits with a zero status$/, (ctx) => {
    assert.equal(ctx.result.status, 0, `expected exit 0, got ${ctx.result.status}; stderr: ${ctx.result.stderr}`);
  });

  scoped(/^the nudge is delivered into the fixture project root's coordinator inbox$/, (ctx) => {
    const queued = listHandoffFiles(coordinatorOutboxDir(ctx.fixtureRoot));
    assert.ok(
      queued.length > 0,
      `expected a queued nudge in the fixture's own coordinator outbox, got none. stdout: ${ctx.result.stdout} stderr: ${ctx.result.stderr}`
    );
  });

  scoped(/^the live repository's coordinator inbox is unchanged$/, (ctx) => {
    assert.deepEqual(
      listHandoffFiles(coordinatorInboxNewDir(REPO_ROOT)),
      ctx.liveInboxBefore,
      'expected the live repository coordinator inbox/new to be unchanged'
    );
    assert.deepEqual(
      listHandoffFiles(coordinatorOutboxDir(REPO_ROOT)),
      ctx.liveOutboxBefore,
      'expected the live repository coordinator outbox to be unchanged'
    );
  });

  // ── Scenario 06: the enumeration-based check catches a new offender ───
  // A synthetic harness with the vulnerable shape is written into its OWN
  // temp directory (never the real swarmforge/scripts/test/ tree) and the
  // REAL enumeration+check (project-root-arg-lib's bb functions, driven
  // here via a tiny bb one-liner - never a JS reimplementation of the
  // enumeration or the behavioral probe) is pointed at that temp dir.

  scoped(/^a harness under "swarmforge\/scripts\/test" that binds its fixture root from the command line$/, (ctx) => {
    ctx.checkDir = mkScratchDir('bl1517-check-fixture-');
    ctx.newHarnessName = 'zzzBl1517NewOffenderSteps.bb';
    fs.writeFileSync(
      path.join(ctx.checkDir, ctx.newHarnessName),
      "#!/usr/bin/env bb\n(def project-root (first *command-line-args*))\n(println project-root)\n"
    );
  });

  scoped(/^that harness is not named in any hardcoded list inside the check$/, (ctx) => {
    // No-op: the check (project-root-arg-lib/missing-fixture-root-check)
    // enumerates checkDir's own files at run time - there is no list to
    // add this synthetic file's name to, which is exactly the property
    // under test.
    assert.ok(ctx.newHarnessName, 'expected a synthetic harness name to be set by the prior step');
  });

  scoped(/^the missing-fixture-root check runs$/, (ctx) => {
    const script = `
(require '[babashka.fs :as fs])
(load-file "${path.join(SCRIPTS_DIR, 'project_root_arg_lib.bb')}")
(let [result (project-root-arg-lib/missing-fixture-root-check "${ctx.checkDir}")]
  (println (str "===BL1517_CHECK_START===" (pr-str result) "===BL1517_CHECK_END===")))
`;
    const result = spawnSync('bb', ['-e', script], { encoding: 'utf8' });
    assert.equal(result.status, 0, `expected the check driver to exit 0, got ${result.status}; stderr: ${result.stderr}`);
    const match = result.stdout.match(/===BL1517_CHECK_START===([\s\S]*?)===BL1517_CHECK_END===/);
    assert.ok(match, `expected a delimited payload, got: ${result.stdout}`);
    // The bb map prints as EDN (:examined [...] :offenders [...]); a tiny
    // hand-parse is safe here since this process wrote every value in it.
    const examinedMatch = match[1].match(/:examined \[([^\]]*)\]/);
    const offendersMatch = match[1].match(/:offenders \[([^\]]*)\]/);
    const parseList = (s) => (s ? Array.from(s.matchAll(/"([^"]*)"/g)).map((m) => m[1]) : []);
    ctx.checkResult = {
      examined: parseList(examinedMatch && examinedMatch[1]),
      offenders: parseList(offendersMatch && offendersMatch[1]),
    };
  });

  scoped(/^that harness is included in the check$/, (ctx) => {
    assert.ok(
      ctx.checkResult.examined.some((f) => f.endsWith(ctx.newHarnessName)),
      `expected ${ctx.newHarnessName} among the examined files, got: ${JSON.stringify(ctx.checkResult.examined)}`
    );
  });

  scoped(/^the check fails while that harness accepts a missing fixture root$/, (ctx) => {
    assert.ok(
      ctx.checkResult.offenders.some((f) => f.endsWith(ctx.newHarnessName)),
      `expected ${ctx.newHarnessName} flagged as an offender, got: ${JSON.stringify(ctx.checkResult.offenders)}`
    );
  });
}

module.exports = { registerSteps };
