'use strict';

// BL-1571: step handlers for "BL-1571 The miniapp watchdog recovers through
// recover_miniapp_bridge". Scenario 01 greps the real operator_runtime.bb
// file for the routing; scenario 02 runs the real standing shell test as a
// subprocess (its own fixture, not re-implemented here); scenario 03 diffs
// the four bridge shell scripts against main to prove they are untouched.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const FEATURE = 'BL-1571 The miniapp watchdog recovers through recover_miniapp_bridge';

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const OPERATOR_RUNTIME = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'operator_runtime.bb');
const SHELL_TEST = path.join(
  REPO_ROOT,
  'swarmforge',
  'scripts',
  'test',
  'test_bl1159_bridge_child_survives_without_crash_giveup_loop.sh'
);

function readFile(absPath) {
  return fs.readFileSync(absPath, 'utf8');
}

function gitShowMain(relPath) {
  const res = spawnSync('git', ['show', `main:${relPath}`], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
  });
  assert.equal(res.status, 0, `git show main:${relPath} failed:\n${res.stderr || ''}`);
  return res.stdout;
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(/^the file swarmforge\/scripts\/operator_runtime\.bb is read$/, (ctx) => {
    ctx.bl1571RuntimeSrc = readFile(OPERATOR_RUNTIME);
  });

  scoped(/^its miniapp recovery invokes recover_miniapp_bridge\.sh$/, (ctx) => {
    const src = ctx.bl1571RuntimeSrc;
    const fnMatch = src.match(/\(defn miniapp-bounce-bridge! \[\][\s\S]*?\)\)/);
    assert.ok(fnMatch, 'miniapp-bounce-bridge! def not found in operator_runtime.bb');
    assert.match(
      fnMatch[0],
      /recover-miniapp-bridge-script/,
      'miniapp-bounce-bridge! does not invoke recover-miniapp-bridge-script'
    );
  });

  scoped(/^its miniapp recovery does not invoke bounce_bridge_headless\.sh$/, (ctx) => {
    const src = ctx.bl1571RuntimeSrc;
    const fnMatch = src.match(/\(defn miniapp-bounce-bridge! \[\][\s\S]*?\)\)/);
    assert.ok(fnMatch, 'miniapp-bounce-bridge! def not found in operator_runtime.bb');
    assert.doesNotMatch(
      fnMatch[0],
      /bounce-bridge-headless-script/,
      'miniapp-bounce-bridge! still invokes bounce-bridge-headless-script'
    );
  });

  scoped(
    /^swarmforge\/scripts\/test\/test_bl1159_bridge_child_survives_without_crash_giveup_loop\.sh runs$/,
    (ctx) => {
      ctx.bl1571ShellRun = spawnSync('bash', [SHELL_TEST], {
        encoding: 'utf8',
        timeout: 60000,
      });
    }
  );

  scoped(/^it prints ALL CHECKS PASSED and exits zero$/, (ctx) => {
    const res = ctx.bl1571ShellRun;
    const out = `${res.stdout || ''}${res.stderr || ''}`;
    assert.equal(res.status, 0, `standing shell test is still red:\n${out}`);
    assert.match(out, /ALL CHECKS PASSED/, `standing shell test did not report ALL CHECKS PASSED:\n${out}`);
  });

  scoped(
    /^swarmforge\/scripts\/(\S+) on the tree as it stands is compared with main$/,
    (ctx, script) => {
      const relPath = path.join('swarmforge', 'scripts', script);
      ctx.bl1571ScriptCompared = {
        script,
        onTree: readFile(path.join(REPO_ROOT, relPath)),
        onMain: gitShowMain(relPath),
      };
    }
  );

  scoped(/^it is unchanged$/, (ctx) => {
    const { script, onTree, onMain } = ctx.bl1571ScriptCompared;
    assert.equal(onTree, onMain, `swarmforge/scripts/${script} differs from main`);
  });
}

module.exports = { registerSteps };
