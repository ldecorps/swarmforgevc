'use strict';

// BL-1129: rotate-not-honored skips standing packs (BL-804 topology).

const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const FEATURE = 'BL-1129 babysitter rotate-not-honored skips standing packs';
const LIB = path.join(__dirname, '..', '..', '..', 'swarmforge', 'scripts', 'babysitterd_sweep_lib.bb');

function runBb(expr) {
  return spawnSync('bb', ['-e', expr], {
    encoding: 'utf8',
    env: { PATH: process.env.PATH, HOME: process.env.HOME },
  });
}

function check(extra) {
  const script = `
(load-file "${LIB}")
(def f (babysitterd-sweep-lib/check-rotate-not-honored
         {:note-name "n1" :note-target "architect"
          :note-age-min 15 :grace-min 10
          :note-mtime-ms 2000 :active-role-file-mtime-ms 1000
          :active-role "coder" :paused? false
          ${extra}}))
(println (if f (str "FINDING=" (:key f) " MSG=" (:message f)) "NONE"))
`;
  const r = runBb(script);
  assert.equal(r.status, 0, r.stderr || r.stdout);
  return `${r.stdout || ''}${r.stderr || ''}`;
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(/^the live pack topology is standing \(every roles\.tsv role has its own pane\)$/, (ctx) => {
    ctx.topology = 'standing';
  });

  scoped(/^mono-router-active-role is absent$/, (ctx) => {
    ctx.activeAbsent = true;
  });

  scoped(/^a completed coordinator note told a role to rotate_to_role\.sh another role$/, (ctx) => {
    ctx.note = true;
  });

  scoped(/^babysitter check-rotate-not-honored runs$/, (ctx) => {
    if (ctx.topology === 'standing') {
      ctx.raw = check(':rotation-router? false');
    } else {
      ctx.raw = check(':rotation-router? true');
    }
  });

  scoped(/^it emits no rotate-not-honored finding$/, (ctx) => {
    assert.match(ctx.raw, /NONE/);
  });

  scoped(/^the live pack topology rotates roles through a shared pane$/, (ctx) => {
    ctx.topology = 'rotating';
  });

  scoped(/^a completed note told the resident to rotate_to_role\.sh a target role$/, (ctx) => {
    ctx.note = true;
  });

  scoped(/^after the honor window the active role is not that target$/, (ctx) => {
    ctx.unhonored = true;
  });

  scoped(/^it emits a rotate-not-honored finding naming the expected target$/, (ctx) => {
    assert.match(ctx.raw, /FINDING=rotate-unhonored-architect/);
    assert.match(ctx.raw, /architect/);
  });
}

module.exports = { registerSteps };
