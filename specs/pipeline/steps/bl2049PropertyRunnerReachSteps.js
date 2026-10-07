'use strict';

// Scaffolded by scaffold_step_handler.js from specs/features/BL-2049-a-change-runs-exactly-the-property-runners-it-reaches.feature (BL-1979).
// Fill in each stub below - this header records where it began.
//
// Drives the REAL property_runner_reach.bb (scenario 01) and the REAL
// run_property_runners.sh --changed-from, which shells to
// property_runner_reach.bb itself (scenario 02), against a real mkdtemp
// fixture (trackedTmpRoot, BL-1390: proven by rev-parse --git-common-dir
// before any mutating git command).

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { trackedTmpRoot } = require('./lib/fixtureReaper');

const FEATURE = 'BL-2049 A change runs exactly the property runners it reaches';

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const REACH_CLI = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'property_runner_reach.bb');
const FRONT_END = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'test', 'run_property_runners.sh');

const KNOWN_REACHED = new Set(['x', 'y', 'z', 'none']);
const KNOWN_OUTCOMES = new Set(['passes', 'fails']);
const KNOWN_EXITS = new Set(['0', '1']);

function git(cwd, args, env) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, ...env } }).trim();
}

function ensureState(ctx) {
  if (!ctx.bl2049) {
    const root = trackedTmpRoot('sfvc-bl2049-');
    ctx.bl2049 = { root, scriptsDir: path.join(root, 'swarmforge', 'scripts') };
  }
  return ctx.bl2049;
}

function runnerSource(name, { loadsA = false, namesCsh = false } = {}) {
  const lines = ["(require '[babashka.fs :as fs])"];
  if (loadsA) {
    lines.push('(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "a.bb")))');
  }
  if (namesCsh) {
    lines.push('; this fixture runner spawns ../c.sh for its own setup');
  }
  lines.push(`(spit (System/getenv "BL2049_LOG") (str ${JSON.stringify(name)} "\\n") :append true)`);
  lines.push(`(System/exit (Integer/parseInt (or (System/getenv ${JSON.stringify(`BL2049_EXIT_${name.toUpperCase()}`)}) "0")))`);
  return lines.join('\n') + '\n';
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(new RegExp('^a fixture scripts directory where lib a\\.bb load-files lib b\\.bb and script c\\.sh exists$'), (ctx) => {
    const st = ensureState(ctx);
    fs.mkdirSync(st.scriptsDir, { recursive: true });
    fs.writeFileSync(
      path.join(st.scriptsDir, 'a.bb'),
      '(require \'[babashka.fs :as fs])\n(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "b.bb")))\n'
    );
    fs.writeFileSync(path.join(st.scriptsDir, 'b.bb'), '; fixture lib b\n');
    fs.writeFileSync(path.join(st.scriptsDir, 'c.sh'), '#!/usr/bin/env bash\necho c\n', { mode: 0o755 });
  });

  scoped(
    new RegExp(
      "^its test directory holds runner x that load-files a\\.bb, runner y whose text names c\\.sh, and runner z that load-files and names neither$"
    ),
    (ctx) => {
      const st = ensureState(ctx);
      const testDir = path.join(st.scriptsDir, 'test');
      fs.mkdirSync(testDir, { recursive: true });
      fs.writeFileSync(path.join(testDir, 'x_property_runner.bb'), runnerSource('x', { loadsA: true }));
      fs.writeFileSync(path.join(testDir, 'y_property_runner.bb'), runnerSource('y', { namesCsh: true }));
      fs.writeFileSync(path.join(testDir, 'z_property_runner.bb'), runnerSource('z'));
    }
  );

  scoped(new RegExp('^the reach selector is given the changed path (.+)$'), (ctx, changed) => {
    const st = ensureState(ctx);
    const out = execFileSync('bb', [REACH_CLI, st.scriptsDir, changed], { encoding: 'utf8' });
    st.reachedLines = out.split('\n').filter(Boolean);
  });

  scoped(new RegExp('^it reports exactly the runners (.+)$'), (ctx, reached) => {
    assert.ok(KNOWN_REACHED.has(reached), `unknown reached value: ${reached}`);
    const st = ensureState(ctx);
    const expected = reached === 'none' ? [] : [`${reached}_property_runner.bb`];
    assert.deepEqual(st.reachedLines.sort(), expected.sort(), `expected reach ${JSON.stringify(expected)}, got ${JSON.stringify(st.reachedLines)}`);
  });

  scoped(new RegExp('^the fixture is a git repository in which (.+) changed since its base commit and runner x (.+)$'), (ctx, changed, outcome) => {
    assert.ok(KNOWN_OUTCOMES.has(outcome), `unknown outcome value: ${outcome}`);
    const st = ensureState(ctx);
    git(st.root, ['init', '-q', '-b', 'main']);
    const common = path.resolve(st.root, git(st.root, ['rev-parse', '--git-common-dir']));
    assert.equal(common, path.join(st.root, '.git'), `fixture is not its own repository: ${common}`);
    git(st.root, ['config', 'user.email', 't@t']);
    git(st.root, ['config', 'user.name', 't']);
    git(st.root, ['config', 'commit.gpgsign', 'false']);
    git(st.root, ['add', '-A']);
    git(st.root, ['commit', '-q', '-m', 'base']);
    st.baseSha = git(st.root, ['rev-parse', 'HEAD']);

    // Appends a change in a form valid for the file's own type - b.bb is
    // actually load-filed when runner x really runs (scenario 02), so
    // overwriting it with arbitrary text would crash x on a bare symbol
    // before it ever reaches its own (spit ...) line, never proving
    // anything about reach at all.
    const changedPath = path.join(st.root, changed);
    fs.mkdirSync(path.dirname(changedPath), { recursive: true });
    const marker = `; changed ${Date.now()}\n`;
    if (fs.existsSync(changedPath)) {
      fs.appendFileSync(changedPath, marker);
    } else {
      fs.writeFileSync(changedPath, marker);
    }
    git(st.root, ['add', '-A']);
    git(st.root, ['commit', '-q', '-m', 'change one file']);

    st.exitX = outcome === 'passes' ? 0 : 1;
  });

  scoped(new RegExp('^the property-runner front-end runs with that base commit$'), (ctx) => {
    const st = ensureState(ctx);
    st.logPath = path.join(st.root, 'bl2049.log');
    fs.writeFileSync(st.logPath, '');
    try {
      execFileSync('bash', [FRONT_END, '--changed-from', st.baseSha, path.join(st.scriptsDir, 'test')], {
        encoding: 'utf8',
        env: { ...process.env, BL2049_LOG: st.logPath, BL2049_EXIT_X: String(st.exitX) },
      });
      st.frontEndExit = 0;
    } catch (err) {
      st.frontEndExit = err.status ?? 1;
    }
  });

  scoped(new RegExp('^it runs exactly the runners (.+)$'), (ctx, reached) => {
    assert.ok(KNOWN_REACHED.has(reached), `unknown reached value: ${reached}`);
    const st = ensureState(ctx);
    const expected = reached === 'none' ? [] : [reached];
    const ran = fs
      .readFileSync(st.logPath, 'utf8')
      .split('\n')
      .filter(Boolean);
    assert.deepEqual(ran.sort(), expected.sort(), `expected exactly ${JSON.stringify(expected)} to run, got ${JSON.stringify(ran)}`);
  });

  scoped(new RegExp('^it exits (.+)$'), (ctx, exitCode) => {
    assert.ok(KNOWN_EXITS.has(exitCode), `unknown exit value: ${exitCode}`);
    const st = ensureState(ctx);
    assert.equal(st.frontEndExit, Number(exitCode));
  });
}

module.exports = { registerSteps };
