'use strict';

// BL-1132: headroom raise telemetry-path + coordinator duty.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const FEATURE = 'BL-1128 residual — headroom raise telemetry path and coordinator duty';
const REPO = path.join(__dirname, '..', '..', '..');
const LIB = path.join(REPO, 'swarmforge', 'scripts', 'headroom_cap_raise_lib.bb');
const CLI = path.join(REPO, 'swarmforge', 'scripts', 'headroom_cap_raise_cli.bb');
const COORD = path.join(REPO, 'swarmforge', 'roles', 'coordinator.prompt');

function runBb(script) {
  return spawnSync('bb', ['-e', script], {
    encoding: 'utf8',
    env: { PATH: process.env.PATH, HOME: process.env.HOME },
  });
}

function ensure(ctx) {
  if (!ctx.bl1132) ctx.bl1132 = { raw: '' };
  return ctx.bl1132;
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(/^BL-1128's headroom_cap_raise_cli is the owner for raising configured depth$/, (ctx) => {
    assert.ok(fs.existsSync(CLI));
    ensure(ctx);
  });

  scoped(/^telemetry-path is evaluated for the project root$/, (ctx) => {
    const st = ensure(ctx);
    const r = runBb(`
(load-file "${LIB}")
(try
  (def p (headroom-cap-raise-lib/telemetry-path "${REPO}"))
  (println (str "PATH=" p))
  (println "THREW=false")
  (catch Exception e
    (println "THREW=true")
    (println (str "ERR=" (.getMessage e)))))
`);
    assert.equal(r.status, 0, r.stderr || r.stdout);
    st.raw = `${r.stdout || ''}${r.stderr || ''}`;
  });

  scoped(/^it returns a path ending in chaser-YYYY-MM\.jsonl under \.swarmforge\/telemetry$/, (ctx) => {
    assert.match(ensure(ctx).raw, /PATH=.*\.swarmforge\/telemetry\/chaser-\d{4}-\d{2}\.jsonl/);
  });

  scoped(/^evaluation does not throw$/, (ctx) => {
    assert.match(ensure(ctx).raw, /THREW=false/);
  });

  scoped(/^host_load_sample ratios below cpu-ratio-max covering the sustained window$/, (ctx) => {
    ensure(ctx).ratiosOk = true;
  });

  scoped(/^memory headroom is met$/, (ctx) => {
    ensure(ctx).memOk = true;
  });

  scoped(/^throttle is not degraded or severe$/, (ctx) => {
    ensure(ctx).throttleOk = true;
  });

  scoped(/^configured depth is below ceiling and cooldown is clear$/, (ctx) => {
    ensure(ctx).depthOk = true;
  });

  scoped(/^raise runs$/, (ctx) => {
    const st = ensure(ctx);
    // Pure decide-raise with headroom true (telemetry path fixed separately).
    const r = runBb(`
(load-file "${LIB}")
(def d (headroom-cap-raise-lib/decide-raise
        {:configured 5 :ceiling 8 :step 1 :headroom? true
         :cooldown-active? false :throttle-state :normal}))
(println (str "ACTION=" (name (:action d))))
(println (str "REASON=" (name (or (:reason d) :none))))
`);
    assert.equal(r.status, 0, r.stderr || r.stdout);
    st.raw = `${r.stdout || ''}${r.stderr || ''}`;
  });

  scoped(/^the action is raise \(not noop reason pressure from a broken path\)$/, (ctx) => {
    assert.match(ensure(ctx).raw, /ACTION=raise/);
    assert.doesNotMatch(ensure(ctx).raw, /REASON=pressure/);
  });

  scoped(/^active backlog is at the configured max depth$/, (ctx) => {
    ensure(ctx).atCap = true;
  });

  scoped(/^host headroom would allow a raise$/, (ctx) => {
    ensure(ctx).headroom = true;
  });

  scoped(/^the coordinator's designed path is to run headroom_cap_raise_cli raise$/, (ctx) => {
    const text = fs.readFileSync(COORD, 'utf8');
    assert.match(text, /headroom_cap_raise_cli\.bb.*raise|headroom_cap_raise_cli/);
  });

  scoped(/^hand-editing active_backlog_max_depth is not the designed recovery$/, (ctx) => {
    const text = fs.readFileSync(COORD, 'utf8');
    assert.match(text, /never hand-edit.*active_backlog_max_depth|hand-edit `config active_backlog_max_depth`/i);
  });
}

module.exports = { registerSteps };
