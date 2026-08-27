'use strict';

// BL-1187: babysitterd main-sync-deadlock operator hint acceptance.

const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const SCRIPTS = path.join(REPO_ROOT, 'swarmforge', 'scripts');
const SWEEP_LIB = path.join(SCRIPTS, 'babysitterd_sweep_lib.bb');
const FEATURE = 'babysitterd recognizes main-sync deadlock and hints the operator';

function ensure(ctx) {
  if (!ctx.bl1187) ctx.bl1187 = {};
  return ctx.bl1187;
}

function cljKeyVals(obj) {
  return Object.entries(obj)
    .map(([k, v]) => {
      let lit;
      if (typeof v === 'string') lit = JSON.stringify(v);
      else if (Array.isArray(v)) lit = `[${v.map((x) => (typeof x === 'string' ? JSON.stringify(x) : String(x))).join(' ')}]`;
      else if (typeof v === 'boolean') lit = v ? 'true' : 'false';
      else lit = String(v);
      return `:${k} ${lit}`;
    })
    .join(' ');
}

function bbCall(fnName, opts) {
  const code =
    `(load-file "${SWEEP_LIB}") (require '[babysitterd-sweep-lib :as sw]) ` +
    `(println (pr-str (sw/${fnName} {${cljKeyVals(opts)}})))`;
  const result = spawnSync('bb', ['-e', code], { encoding: 'utf8', cwd: REPO_ROOT });
  assert.equal(result.status, 0, `bb eval failed: ${result.stderr || result.stdout}`);
  return result.stdout.trim();
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(
    /^main-sync-deadlock is active with reason (.+) and ahead (\d+) behind (\d+)$/,
    (ctx, reason, ahead, behind) => {
      const st = ensure(ctx);
      st.opts = {
        'deadlock-active?': true,
        reason: reason.trim(),
        ahead: Number(ahead),
        behind: Number(behind),
        'overlapping-paths': [],
      };
    },
  );

  scoped(/^overlapping dirty paths include "(.+)"$/, (ctx, p) => {
    ensure(ctx).opts['overlapping-paths'] = [p.trim()];
  });

  scoped(/^main-sync-deadlock is inactive$/, (ctx) => {
    ensure(ctx).opts = { 'deadlock-active?': false };
  });

  scoped(/^the babysitter sweep assesses main-sync deadlock$/, (ctx) => {
    ensure(ctx).result = bbCall('check-main-sync-deadlock', ensure(ctx).opts);
  });

  scoped(/^a CRIT main-sync-deadlock finding is emitted$/, (ctx) => {
    const result = ensure(ctx).result;
    assert.notEqual(result, 'nil', 'expected a finding');
    assert.match(result, /:severity "CRIT"/);
    assert.match(result, /:key "main-sync-deadlock"/);
  });

  scoped(/^the finding message names the overlapping path$/, (ctx) => {
    const paths = ensure(ctx).opts['overlapping-paths'];
    assert.ok(paths && paths.length, 'expected overlapping paths in fixture');
    assert.match(ensure(ctx).result, new RegExp(paths[0].replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  });

  scoped(/^the finding message says not to use pilot$/, (ctx) => {
    assert.match(ensure(ctx).result, /Not \/pilot/i);
  });

  scoped(/^the finding is escalation-eligible$/, (ctx) => {
    const code =
      `(load-file "${SWEEP_LIB}") (require '[babysitterd-sweep-lib :as sw]) ` +
      `(println (pr-str (sw/escalation-eligible? (sw/check-main-sync-deadlock {${cljKeyVals(ensure(ctx).opts)}}))))`;
    const result = spawnSync('bb', ['-e', code], { encoding: 'utf8', cwd: REPO_ROOT });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.equal(result.stdout.trim(), 'true');
  });

  scoped(/^the finding is not nudge-eligible$/, (ctx) => {
    const code =
      `(load-file "${SWEEP_LIB}") (require '[babysitterd-sweep-lib :as sw]) ` +
      `(println (pr-str (sw/nudge-eligible? (sw/check-main-sync-deadlock {${cljKeyVals(ensure(ctx).opts)}}))))`;
    const result = spawnSync('bb', ['-e', code], { encoding: 'utf8', cwd: REPO_ROOT });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.equal(result.stdout.trim(), 'false');
  });

  scoped(/^no main-sync-deadlock finding is emitted$/, (ctx) => {
    assert.equal(ensure(ctx).result, 'nil');
  });
}

module.exports = { registerSteps };
