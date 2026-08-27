'use strict';

// BL-1020: leftover mono-router-active-role is not topology on standing packs.
// Drives REAL mono_router_lib/resolve-resident-role (and the CLI wiring attach uses).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const LIB = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'mono_router_lib.bb');
const CLI = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'relaunch_resume_cli.bb');
const FEATURE = 'topology comes from the pack configuration, never from a leftover marker';

function evalResolve(opts) {
  const script = `
(require '[cheshire.core :as json])
(load-file "${LIB.replace(/\\/g, '/')}")
(println (json/generate-string (mono-router-lib/resolve-resident-role
  {:rotation-router? ${opts.router}
   :recorded-role ${opts.recorded == null ? 'nil' : JSON.stringify(opts.recorded)}
   :home-role ${JSON.stringify(opts.home)}})))
`;
  const res = spawnSync('bb', ['-e', script], { encoding: 'utf8' });
  if (res.status !== 0) {
    throw new Error(`resolve-resident-role failed: ${res.stdout}\n${res.stderr}`);
  }
  const line = (res.stdout || '').trim().split('\n').pop();
  const parsed = JSON.parse(line);
  return {
    raw: line,
    honour: Boolean(parsed['honour-marker?']),
    stale: Boolean(parsed['stale?']),
    role: parsed.role ?? null,
    recorded: parsed.recorded ?? null,
  };
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(/^a leftover mono-router-active-role marker naming "([^"]+)"$/, (ctx, role) => {
    ctx.bl1020 = { recorded: role, home: 'coder' };
  });

  scoped(/^a pack whose rotation is empty$/, (ctx) => {
    ctx.bl1020.router = false;
  });

  scoped(/^a pack whose rotation names its roles$/, (ctx) => {
    ctx.bl1020.router = true;
  });

  scoped(/^the resident role is resolved$/, (ctx) => {
    ctx.bl1020.result = evalResolve({
      router: ctx.bl1020.router,
      recorded: ctx.bl1020.recorded,
      home: ctx.bl1020.home,
    });
    // Also exercise the CLI attach uses, so a pure-lib-only fix cannot drift.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bl1020-'));
    const state = path.join(dir, '.swarmforge');
    fs.mkdirSync(state);
    fs.writeFileSync(path.join(state, 'mono-router-active-role'), `${ctx.bl1020.recorded}\n`);
    fs.writeFileSync(
      path.join(state, 'roles.tsv'),
      'coder\tCoder\t\tswarmforge-coder\tCoder\t\t\t\t\ncoordinator\tCoordinator\t\tswarmforge-coordinator\tCoordinator\t\t\t\t\n'
    );
    const identity = ctx.bl1020.router ? 'rotation\trouter\n' : '';
    fs.writeFileSync(path.join(state, 'swarm-identity'), identity);
    const cli = spawnSync('bb', [CLI, 'resolve-resident-role', dir], { encoding: 'utf8' });
    ctx.bl1020.cliOut = `${cli.stdout || ''}`;
    ctx.bl1020.cliErr = `${cli.stderr || ''}`;
    fs.rmSync(dir, { recursive: true, force: true });
  });

  scoped(/^the marker is not consulted as topology$/, (ctx) => {
    assert.equal(ctx.bl1020.result.honour, false, ctx.bl1020.result.raw);
    assert.match(ctx.bl1020.cliOut, /honour=0/, ctx.bl1020.cliOut);
  });

  scoped(/^the resolution comes from the pack configuration$/, (ctx) => {
    assert.equal(ctx.bl1020.result.role, ctx.bl1020.home, ctx.bl1020.result.raw);
    assert.notEqual(ctx.bl1020.result.role, ctx.bl1020.recorded);
  });

  scoped(/^the resolution honours the marker$/, (ctx) => {
    assert.equal(ctx.bl1020.result.honour, true, ctx.bl1020.result.raw);
    assert.equal(ctx.bl1020.result.role, ctx.bl1020.recorded, ctx.bl1020.result.raw);
    assert.equal(ctx.bl1020.result.stale, false, ctx.bl1020.result.raw);
    assert.match(ctx.bl1020.cliOut, /honour=1/, ctx.bl1020.cliOut);
    // Regression: an over-broad fix that ignores the marker everywhere fails here.
    assert.ok(
      !/STALE/.test(ctx.bl1020.cliErr),
      `router path must not report STALE: ${ctx.bl1020.cliErr}`
    );
  });

  scoped(/^the stale marker is reported as stale$/, (ctx) => {
    assert.equal(ctx.bl1020.result.stale, true, ctx.bl1020.result.raw);
    assert.match(ctx.bl1020.cliOut, /stale=1/, ctx.bl1020.cliOut);
    assert.match(ctx.bl1020.cliErr, /STALE/, ctx.bl1020.cliErr);
  });
}

module.exports = { registerSteps };
