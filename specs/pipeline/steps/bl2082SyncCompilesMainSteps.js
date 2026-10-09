'use strict';

// BL-2082: step handlers for "sync compiles main's committed extension
// tree". Drives the REAL build_freshness_cli.bb sync (which now routes its
// recompile through safe_recompile_lib.bb/recompile-extension-from-main!,
// BL-2065) against a real fixture git repo and a real handoffd process -
// never a restatement of the git-archive/compile decision itself. The
// compile fixture (package.json + compile.js bundling src/*.js into
// out/bundle.js) mirrors bl2065LiveBuildFromMainSteps.js's own shape; the
// stale-daemon setup mirrors bl629SyncQaApprovalGateSteps.js's "a tracked
// process is stale against main" step.

const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { mkFixtureGitRoot } = require('./lib/operatorRuntimeFixtureGitRoot');

const FEATURE = "sync compiles main's committed extension tree";

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const CLI = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'build_freshness_cli.bb');
const START_HANDOFF_DAEMON = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'start_handoff_daemon.sh');

const MAIN_GREETING = "module.exports = 'FROM_MAIN';\n";
const DIRTY_EDIT = "module.exports = 'DIRTY_EDIT';\n";
const UNTRACKED_EVIL = "module.exports = 'EVIL';\n";

// BL-2065's own trivial, dependency-free "compile" step, reused verbatim in
// shape: concatenates every *.js file under src/ into out/bundle.js. The
// point of this fixture is never whether a real TypeScript build runs, only
// whether the bytes it reads come from main's committed tree or from
// whatever the working tree happens to hold at call time.
const COMPILE_JS = [
  "const fs = require('fs');",
  "const path = require('path');",
  "const srcDir = path.join(__dirname, 'src');",
  "const outDir = path.join(__dirname, 'out');",
  "fs.mkdirSync(outDir, { recursive: true });",
  "const files = fs.readdirSync(srcDir).filter((f) => f.endsWith('.js')).sort();",
  "const bundled = files.map((f) => fs.readFileSync(path.join(srcDir, f), 'utf8')).join('\\n');",
  "fs.writeFileSync(path.join(outDir, 'bundle.js'), bundled);",
  '',
].join('\n');

// Scenario 02: a compile script that always fails loudly, never silently.
const FAILING_COMPILE_JS = "process.stderr.write('fixture compile failure\\n'); process.exit(1);\n";

function git(cwd, args) {
  execFileSync('git', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
}

function gitOut(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

function writeFile(root, relPath, content) {
  const abs = path.join(root, relPath);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
}

function commitExtension(root, message, compileJs) {
  const extDir = path.join(root, 'extension');
  const srcDir = path.join(extDir, 'src');
  fs.mkdirSync(srcDir, { recursive: true });
  fs.writeFileSync(
    path.join(extDir, 'package.json'),
    JSON.stringify({ name: 'fixture-extension', version: '1.0.0', scripts: { compile: 'node compile.js' } }, null, 2)
  );
  fs.writeFileSync(path.join(extDir, 'compile.js'), compileJs);
  fs.writeFileSync(path.join(srcDir, 'greeting.js'), MAIN_GREETING);
  git(root, ['add', '-A']);
  git(root, ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', message]);
  return { extDir, srcDir };
}

function buildFixture(compileJs) {
  const root = mkFixtureGitRoot('sfvc-bl2082-');
  // A commit BEFORE extension/ exists at all - handoffd's own stale build
  // sha names this one, never main's tip, so it reads as behind regardless
  // of what the working tree is later made to hold.
  const staleSha = gitOut(root, ['rev-parse', 'HEAD']);
  const { extDir, srcDir } = commitExtension(root, 'add extension', compileJs);
  git(root, ['branch', '-M', 'main']);
  // BL-629: swarmforge-QA = main (zero drift) - this fixture is about the
  // recompile decision, never the QA gate, which --override exists for
  // anyway (the dirty-surface refusal this ticket's own scenarios trigger).
  git(root, ['branch', 'swarmforge-QA', 'main']);
  const mainSha = gitOut(root, ['rev-parse', 'main']);
  fs.mkdirSync(path.join(root, '.swarmforge', 'daemon'), { recursive: true });
  fs.writeFileSync(path.join(root, '.swarmforge', 'daemon', 'handoffd-build.json'), JSON.stringify({ build_sha: staleSha }));
  return { root, extDir, srcDir, mainSha, staleSha };
}

function applyWorkingTreeChange(ctx, change) {
  const { srcDir } = ctx.fixture;
  if (change === 'an uncommitted edit to a tracked source file') {
    fs.writeFileSync(path.join(srcDir, 'greeting.js'), DIRTY_EDIT);
    ctx.fixture.dirtyContent = DIRTY_EDIT;
    ctx.fixture.dirtyPath = path.join(srcDir, 'greeting.js');
    return;
  }
  if (change === 'an untracked source file') {
    fs.writeFileSync(path.join(srcDir, 'evil.js'), UNTRACKED_EVIL);
    ctx.fixture.dirtyPath = path.join(srcDir, 'evil.js');
    return;
  }
  throw new Error(`BL-2082: unrecognized working-tree change "${change}" - not in KNOWN_VALUES`);
}

function runCli(root, args, extraEnv) {
  try {
    const stdout = execFileSync('bb', [CLI, root, ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, ...extraEnv },
    });
    return { exitCode: 0, stdout, stderr: '' };
  } catch (err) {
    return { exitCode: err.status, stdout: err.stdout || '', stderr: err.stderr || '' };
  }
}

// restart-handoffd-group! shells the REAL start_handoff_daemon.sh, which in
// turn launches the real handoffd.bb/handoffd_supervisor.bb and waits for
// each to claim a live pidfile - this feature is about the COMPILE
// decision, not the daemon restart mechanics (BL-1225 owns proving those;
// "nothing here drives that"), so these stubs just claim their pidfile at
// once and exit, the way BL-1225's own HANDOFFD_BB/HANDOFFD_SUPERVISOR_BB
// env-var seam is designed for. Without a REAL claim, start_handoff_daemon.sh
// itself fails and throws past -main's try/catch, masking an otherwise-
// correct compile behind an unrelated exit 2.
function writeHandoffdStub(root, pidFileName) {
  const stubPath = path.join(root, `bl2082-${pidFileName}-stub.bb`);
  fs.writeFileSync(stubPath, [
    '#!/usr/bin/env bb',
    '(require (quote [babashka.fs :as fs]))',
    `(let [root (first *command-line-args*)`,
    `      pid-file (str (fs/path root ".swarmforge" "daemon" "${pidFileName}.pid"))]`,
    '  (spit pid-file (str (.pid (java.lang.ProcessHandle/current))))',
    '  (Thread/sleep 5000))',
    '',
  ].join('\n'));
  return stubPath;
}

function runSync(ctx) {
  const { root } = ctx.fixture;
  ctx.syncResult = runCli(root, ['sync', '--override'], {
    SWARMFORGE_FLEET_HOME: path.join(root, 'fleet-home'),
    HANDOFFD_BB: writeHandoffdStub(root, 'handoffd'),
    HANDOFFD_SUPERVISOR_BB: writeHandoffdStub(root, 'handoffd-supervisor'),
  });
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(new RegExp("^a fixture swarm whose main commits an extension that compiles$"), (ctx) => {
    ctx.fixture = buildFixture(COMPILE_JS);
  });

  scoped(new RegExp("^one of the fixture's daemons runs a build older than main$"), (ctx) => {
    // Already true the instant the fixture is built (handoffd-build.json
    // names the pre-extension commit) - this step only confirms it, since
    // the Background's two Given lines are otherwise unordered w.r.t. the
    // registry's own dispatch.
    const recorded = JSON.parse(fs.readFileSync(path.join(ctx.fixture.root, '.swarmforge', 'daemon', 'handoffd-build.json'), 'utf8'));
    assert.equal(recorded.build_sha, ctx.fixture.staleSha, 'handoffd must be recorded behind main from the start');
    assert.notEqual(ctx.fixture.staleSha, ctx.fixture.mainSha, 'the stale sha must actually differ from main');
  });

  scoped(new RegExp("^the fixture's master working tree holds (.+?)$"), (ctx, change) => {
    applyWorkingTreeChange(ctx, change);
  });

  scoped(new RegExp("^main's committed extension in the fixture does not compile$"), (ctx) => {
    ctx.fixture = buildFixture(FAILING_COMPILE_JS);
  });

  scoped(new RegExp("^sync runs with the override$"), (ctx) => {
    runSync(ctx);
  });

  scoped(new RegExp("^the compiled output holds main's committed code and not the change$"), (ctx) => {
    assert.equal(ctx.syncResult.exitCode, 0, `expected the override sync to succeed; got exit ${ctx.syncResult.exitCode}: ${ctx.syncResult.stderr}`);
    const bundlePath = path.join(ctx.fixture.extDir, 'out', 'bundle.js');
    const bundled = fs.readFileSync(bundlePath, 'utf8');
    assert.equal(bundled, MAIN_GREETING, "compiled output must equal main's committed extension/src, never the working tree's change");
  });

  scoped(new RegExp("^the compiled output's BUILD_SHA names main's commit$"), (ctx) => {
    const shaPath = path.join(ctx.fixture.extDir, 'out', 'BUILD_SHA');
    const sha = fs.readFileSync(shaPath, 'utf8').trim();
    assert.equal(sha, ctx.fixture.mainSha, "BUILD_SHA must name main's commit, not the stale daemon's");
  });

  scoped(new RegExp("^the fixture's master working tree is unchanged by the sync$"), (ctx) => {
    const content = fs.readFileSync(ctx.fixture.dirtyPath, 'utf8');
    const expected = ctx.fixture.dirtyContent !== undefined ? ctx.fixture.dirtyContent : UNTRACKED_EVIL;
    assert.equal(content, expected, 'the working tree change must survive the sync untouched - the export reads main via git archive, never the working tree');
  });

  scoped(new RegExp("^the sync exits non-zero naming the compile failure$"), (ctx) => {
    assert.notEqual(ctx.syncResult.exitCode, 0, 'expected the sync to fail when main\'s own committed extension does not compile');
    assert.match(ctx.syncResult.stderr, /npm run compile failed/, `expected the compile failure to be named; got: ${ctx.syncResult.stderr}`);
  });

  scoped(new RegExp("^no daemon group of the fixture is restarted$"), (ctx) => {
    const buildFile = path.join(ctx.fixture.root, '.swarmforge', 'daemon', 'handoffd-build.json');
    const recorded = JSON.parse(fs.readFileSync(buildFile, 'utf8'));
    assert.equal(recorded.build_sha, ctx.fixture.staleSha, 'handoffd must still read as the pre-recompile stale build - a failed compile must restart nothing');
    assert.equal(fs.existsSync(path.join(ctx.fixture.root, '.swarmforge', 'daemon', 'handoffd.pid')), false, 'a failed compile must never reach the restart step at all');
  });
}

module.exports = { registerSteps };
