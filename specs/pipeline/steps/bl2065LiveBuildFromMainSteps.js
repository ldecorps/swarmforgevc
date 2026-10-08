'use strict';

// BL-2065: drives the REAL recompile mechanism (safe_recompile_cli.bb, the
// thin wrapper safe_recompile_lib.bb's recompile-extension-from-main!
// front_desk_supervisor.bb's own ensure-current-build! now delegates to)
// against a tiny fixture project, never a mock of the compile step. No
// production anchor (BL-1235): this never greps front_desk_supervisor.bb's
// own source for a particular shape - only the observable filesystem
// outcome of a real recompile matters.

const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { mkFixtureGitRoot } = require('./lib/operatorRuntimeFixtureGitRoot');

const FEATURE = "The live build is compiled from main, never from uncommitted edits";

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const SAFE_RECOMPILE_CLI = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'safe_recompile_cli.bb');

const MAIN_GREETING = "module.exports = 'FROM_MAIN';\n";
const DIRTY_EDIT = "module.exports = 'DIRTY_EDIT';\n";
const UNTRACKED_EVIL = "module.exports = 'EVIL';\n";

// A trivial, dependency-free "compile" step: concatenates every *.js file
// under src/ into out/bundle.js. No tsc/node_modules needed - the point of
// this fixture is never whether a real TypeScript build runs, only whether
// the files it reads come from main's committed tree or from whatever the
// working tree happens to hold at call time.
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

function buildFixture() {
  const root = mkFixtureGitRoot('sfvc-bl2065-');
  const extDir = path.join(root, 'extension');
  const srcDir = path.join(extDir, 'src');
  fs.mkdirSync(srcDir, { recursive: true });
  fs.writeFileSync(
    path.join(extDir, 'package.json'),
    JSON.stringify(
      { name: 'fixture-extension', version: '1.0.0', scripts: { compile: 'node compile.js' } },
      null,
      2
    )
  );
  fs.writeFileSync(path.join(extDir, 'compile.js'), COMPILE_JS);
  fs.writeFileSync(path.join(srcDir, 'greeting.js'), MAIN_GREETING);
  execFileSync('git', ['add', '-A'], { cwd: root });
  execFileSync('git', ['-c', 'user.email=test@test', '-c', 'user.name=test', 'commit', '-q', '-m', 'init extension'], {
    cwd: root,
  });
  execFileSync('git', ['branch', '-M', 'main'], { cwd: root });
  const mainSha = execFileSync('git', ['rev-parse', 'main'], { cwd: root, encoding: 'utf8' }).trim();
  return { root, extDir, srcDir, mainSha };
}

function applyChange(ctx, change) {
  const { srcDir } = ctx.fixture;
  if (change === 'no change') {
    return;
  }
  if (change === 'an uncommitted edit to a tracked source file') {
    fs.writeFileSync(path.join(srcDir, 'greeting.js'), DIRTY_EDIT);
    ctx.fixture.dirtyEditContent = DIRTY_EDIT;
    return;
  }
  if (change === 'an untracked source file imported by another') {
    fs.writeFileSync(path.join(srcDir, 'evil.js'), UNTRACKED_EVIL);
    return;
  }
  throw new Error(`BL-2065 fixture: unknown working-tree change "${change}"`);
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(new RegExp("^a fixture project whose main commit has a compilable extension$"), (ctx) => {
    ctx.fixture = buildFixture();
  });

  scoped(new RegExp("^the fixture's working tree has (.+?)$"), (ctx, change) => {
    applyChange(ctx, change);
  });

  // Scenario 02's own Given repeats one of the Outline's example rows
  // verbatim (not a placeholder) - the registry resolves the generic
  // pattern above first (first-match-wins in registration order), so this
  // never actually fires, but it stays correct on its own terms regardless.
  scoped(new RegExp("^the fixture's working tree has an uncommitted edit to a tracked source file$"), (ctx) => {
    applyChange(ctx, 'an uncommitted edit to a tracked source file');
  });

  scoped(new RegExp("^the supervisor's stale-build recompile runs$"), (ctx) => {
    ctx.recompileOutput = execFileSync('bb', [SAFE_RECOMPILE_CLI, ctx.fixture.root], { encoding: 'utf8' });
  });

  scoped(new RegExp("^the compiled output equals the build of main's committed tree$"), (ctx) => {
    const bundlePath = path.join(ctx.fixture.extDir, 'out', 'bundle.js');
    const bundled = fs.readFileSync(bundlePath, 'utf8');
    assert.equal(
      bundled,
      MAIN_GREETING,
      "compiled output must equal main's committed extension/src, never the working tree's"
    );
  });

  scoped(new RegExp("^the build's BUILD_SHA names main's commit$"), (ctx) => {
    const shaPath = path.join(ctx.fixture.extDir, 'out', 'BUILD_SHA');
    const sha = fs.readFileSync(shaPath, 'utf8').trim();
    assert.equal(sha, ctx.fixture.mainSha, 'BUILD_SHA must name the commit the build was compiled from');
  });

  scoped(new RegExp("^the uncommitted edit is still in the working tree, untouched$"), (ctx) => {
    const greetingPath = path.join(ctx.fixture.srcDir, 'greeting.js');
    const content = fs.readFileSync(greetingPath, 'utf8');
    assert.equal(content, ctx.fixture.dirtyEditContent, 'the uncommitted edit must survive the recompile untouched');
  });
}

module.exports = { registerSteps };
