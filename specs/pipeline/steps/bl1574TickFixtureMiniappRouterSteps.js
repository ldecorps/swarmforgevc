'use strict';

// BL-1574: step handlers for "BL-1574 The operator runtime tick fixture
// carries the miniapp recovery router". Scenarios 01/02 read the test file
// itself (the deliverable text - BL-1235 caveat: proves the text landed, not
// a consumer); scenario 03 runs the real standing shell test as a
// subprocess (its own fixture, not re-implemented here); scenario 04 diffs
// the four production files against main to prove they are untouched
// (BL-1571's handler has this same pattern).

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const FEATURE = 'BL-1574 The operator runtime tick fixture carries the miniapp recovery router';

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const SHELL_TEST = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'test', 'test_operator_runtime_tick.sh');

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

  scoped(/^the file swarmforge\/scripts\/test\/test_operator_runtime_tick\.sh is read$/, (ctx) => {
    ctx.bl1574TestSrc = readFile(SHELL_TEST);
  });

  scoped(/^its fixture copies recover_miniapp_bridge\.sh from the real scripts directory$/, (ctx) => {
    const src = ctx.bl1574TestSrc;
    assert.match(
      src,
      /cp\s+"\$SRC\/recover_miniapp_bridge\.sh"\s+"\$F\/swarmforge\/scripts\/"/,
      'test_operator_runtime_tick.sh does not copy the real recover_miniapp_bridge.sh into the fixture'
    );
  });

  scoped(
    /^its miniapp-watchdog section asserts the runtime log records bounced and never bounce-failed$/,
    (ctx) => {
      const src = ctx.bl1574TestSrc;
      const sectionMatch = src.match(
        /mini app watchdog: a down \/lets-talk endpoint triggers a bounded auto-bounce[\s\S]*?rm -rf "\$F"/
      );
      assert.ok(sectionMatch, 'miniapp-watchdog section not found in test_operator_runtime_tick.sh');
      const section = sectionMatch[0];
      assert.match(
        section,
        /grep -q "miniapp-watchdog bounced" "\$F\/\.swarmforge\/operator\/runtime\.log"/,
        'miniapp-watchdog section does not assert a completed bounce in runtime.log'
      );
      assert.match(
        section,
        /! grep -q "miniapp-watchdog bounce-failed" "\$F\/\.swarmforge\/operator\/runtime\.log"/,
        'miniapp-watchdog section does not refuse a failed bounce in runtime.log'
      );
    }
  );

  scoped(/^swarmforge\/scripts\/test\/test_operator_runtime_tick\.sh runs$/, (ctx) => {
    ctx.bl1574ShellRun = spawnSync('bash', [SHELL_TEST], {
      encoding: 'utf8',
      timeout: 180000,
    });
  });

  scoped(/^it prints ALL CHECKS PASSED and exits zero$/, (ctx) => {
    const res = ctx.bl1574ShellRun;
    const out = `${res.stdout || ''}${res.stderr || ''}`;
    assert.equal(res.status, 0, `standing shell test is still red:\n${out}`);
    assert.match(out, /ALL CHECKS PASSED/, `standing shell test did not report ALL CHECKS PASSED:\n${out}`);
  });

  scoped(
    /^swarmforge\/scripts\/(\S+) on the tree as it stands is compared with main$/,
    (ctx, script) => {
      const relPath = path.join('swarmforge', 'scripts', script);
      ctx.bl1574ScriptCompared = {
        script,
        onTree: readFile(path.join(REPO_ROOT, relPath)),
        onMain: gitShowMain(relPath),
      };
    }
  );

  scoped(/^it is unchanged$/, (ctx) => {
    const { script, onTree, onMain } = ctx.bl1574ScriptCompared;
    assert.equal(onTree, onMain, `swarmforge/scripts/${script} differs from main`);
  });
}

module.exports = { registerSteps };
