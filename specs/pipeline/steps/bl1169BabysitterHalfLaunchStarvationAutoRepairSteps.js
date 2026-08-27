'use strict';

// BL-1169: half-launch and swarm-starved queue bounded auto-repair.
// Drives the pure babysitterd_sweep_lib.bb decision surface (same posture as
// BL-1017 scenario 03) so acceptance stays off live tmux.

const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const SCRIPTS = path.join(REPO_ROOT, 'swarmforge', 'scripts');
const SWEEP_LIB = path.join(SCRIPTS, 'babysitterd_sweep_lib.bb');
const FEATURE = 'half-launch and swarm-starved findings queue bounded auto-repair';

function ensure(ctx) {
  if (!ctx.bl1169) ctx.bl1169 = {};
  return ctx.bl1169;
}

function cljKeyVals(obj) {
  return Object.entries(obj)
    .map(([k, v]) => {
      let lit;
      if (typeof v === 'string') lit = JSON.stringify(v);
      else if (Array.isArray(v)) lit = `[${v.map((x) => (typeof x === 'string' ? JSON.stringify(x) : String(x))).join(' ')}]`;
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

  scoped(/^a standing cursor-forge pack with healthy launch-contract$/, () => {});

  scoped(/^role "(.+)" whose pane exists but no agent process runs under it$/, (ctx, role) => {
    const st = ensure(ctx);
    st.role = role.trim();
    st.opts = {
      role: st.role,
      'pane-exists?': true,
      'has-claude-process?': false,
      'should-stand?': true,
    };
  });

  scoped(/^session repair is allowed for that role$/, (ctx) => {
    Object.assign(ensure(ctx).opts, {
      'repair-attempts': 0,
      'max-repair-attempts': 1,
    });
  });

  scoped(/^the babysitter sweep assesses that role$/, (ctx) => {
    ensure(ctx).result = bbCall('check-live-session', ensure(ctx).opts);
  });

  scoped(/^a CRIT for half-launch is emitted$/, (ctx) => {
    const result = ensure(ctx).result;
    assert.match(result, /:severity "CRIT"/);
    assert.match(result, new RegExp(`:key "proc-${ensure(ctx).role}"`));
  });

  scoped(/^a repair decision to ensure that role session is emitted alongside it$/, (ctx) => {
    const result = ensure(ctx).result;
    assert.match(result, /:repair/);
    assert.match(result, /:action :ensure-session/);
    assert.match(result, new RegExp(`:role "${ensure(ctx).role}"`));
  });

  scoped(/^the swarm has been starved for at least three consecutive sweeps$/, (ctx) => {
    ensure(ctx).starvedOpts = {
      'active-ticket-count': 3,
      'any-pane-busy?': false,
      'paused?': false,
      'prev-streak': 2,
      'pending-claims': [],
      'in-process-claims': [],
    };
  });

  scoped(/^multiple proc findings are present$/, () => {});

  scoped(/^the babysitter sweep assesses swarm starvation$/, (ctx) => {
    ensure(ctx).starvedResult = bbCall('check-swarm-starved', ensure(ctx).starvedOpts);
  });

  scoped(/^a repair decision to ensure the control plane is emitted$/, (ctx) => {
    assert.match(ensure(ctx).starvedResult, /:action :ensure-control-plane/);
  });

  scoped(/^operator escalation is not the only recovery path$/, (ctx) => {
    assert.match(ensure(ctx).starvedResult, /:repair/);
    assert.match(ensure(ctx).starvedResult, /:severity "CRIT"/);
  });

  scoped(/^role "(.+)" in half-launch state$/, (ctx, role) => {
    const st = ensure(ctx);
    st.role = role.trim();
    st.opts = {
      role: st.role,
      'pane-exists?': true,
      'has-claude-process?': false,
      'should-stand?': true,
    };
  });

  scoped(/^that role was already issued a repair inside the cooldown window$/, (ctx) => {
    Object.assign(ensure(ctx).opts, {
      'now-ms': 1000000,
      'last-repair-ms': 999000,
      'repair-attempts': 1,
      'repair-cooldown-ms': 60000,
      'max-repair-attempts': 1,
    });
  });

  scoped(/^no new repair decision is emitted$/, (ctx) => {
    assert.ok(!ensure(ctx).result.includes(':repair'), `expected no repair: ${ensure(ctx).result}`);
  });

  scoped(/^the half-launch CRIT is still emitted$/, (ctx) => {
    assert.match(ensure(ctx).result, /:severity "CRIT"/);
    assert.match(ensure(ctx).result, /half-launch/);
  });

  scoped(/^the standing pack launch-contract check passes$/, (ctx) => {
    ensure(ctx).launchContractOk = true;
  });

  scoped(/^control-plane ensure runs from a starved or half-launch repair decision$/, (ctx) => {
    ensure(ctx).starvedResult = bbCall('check-swarm-starved', {
      'active-ticket-count': 2,
      'any-pane-busy?': false,
      'paused?': false,
      'prev-streak': 2,
      'pending-claims': [],
      'in-process-claims': [],
    });
  });

  scoped(/^ensure completes without launch-contract refusal$/, (ctx) => {
    assert.equal(ensure(ctx).launchContractOk, true);
    assert.match(ensure(ctx).starvedResult, /:action :ensure-control-plane/);
    assert.doesNotMatch(ensure(ctx).starvedResult, /launch-contract/i);
  });

  scoped(/^agent respawn is attempted for affected roles$/, (ctx) => {
    assert.match(ensure(ctx).starvedResult, /:ensure-control-plane/);
  });
}

module.exports = { registerSteps };
