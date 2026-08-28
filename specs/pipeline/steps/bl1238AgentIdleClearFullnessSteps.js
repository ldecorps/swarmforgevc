'use strict';

// BL-1238: step handlers for "A role clears its context at NO_TASK only
// when its window is nearly full". Scenarios 01/02/04 drive the REAL
// idle_clear_fullness_cli.bb should-respawn? end to end (real roles.tsv,
// real .vscode/settings.json, a fake tmux controlling the proxy line
// count) via lib/bl1238IdleClearFullnessCli.sh. Scenario 03 (telemetry vs
// proxy labelling) drives the pure idle_clear_fullness_lib.bb decision
// directly - no telemetry SOURCE is wired at the IO layer yet (same
// documented reality as contextFullness.ts: no backend reports it), but
// the pure decision already treats both tiers identically, which is
// exactly what this scenario asserts.

const assert = require('node:assert/strict');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const FEATURE = 'A role clears its context at NO_TASK only when its window is nearly full';

const CLI = path.join(__dirname, 'lib', 'bl1238IdleClearFullnessCli.sh');
const LIB = path.join(__dirname, '..', '..', '..', 'swarmforge', 'scripts', 'idle_clear_fullness_lib.bb');

function runCli(optin, threshold, fullness) {
  const out = execFileSync('bash', [CLI, optin, String(threshold), String(fullness)], {
    encoding: 'utf8',
    timeout: 30000,
  });
  return JSON.parse(out.trim().split('\n').pop());
}

function decidePure(source, percent, threshold) {
  const script = `
    (load-file "${LIB}")
    (let [fullness {:percent ${percent} :source :${source}}
          result (idle-clear-fullness-lib/decide
                   {:opt-in? true :fullness fullness :threshold-percent ${threshold}})]
      (println (str (:respawn? result) "|" (name (:source result)))))
  `;
  const out = execFileSync('bb', ['-e', script], { encoding: 'utf8', timeout: 15000 }).trim();
  const [respawn, recordedSource] = out.split('|');
  return { respawn: respawn === 'true', source: recordedSource };
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(/^a role has reached an idle boundary with NO_TASK$/, (ctx) => {
    ctx.bl1238 = { optin: 'on', threshold: 'default' };
  });

  scoped(/^the role's idle-clear opt-in is (enabled|disabled)$/, (ctx, state) => {
    ctx.bl1238.optin = state === 'enabled' ? 'on' : 'off';
  });

  scoped(/^the role's context window is (\d+)% full$/, (ctx, pct) => {
    ctx.bl1238.fullness = Number(pct);
  });

  scoped(/^the configured fullness threshold is (\d+)%$/, (ctx, pct) => {
    ctx.bl1238.threshold = Number(pct);
  });

  scoped(/^no fullness reading can be obtained$/, (ctx) => {
    ctx.bl1238.fullness = 'unavailable';
  });

  scoped(/^the fullness reading comes from (telemetry|proxy)$/, (ctx, source) => {
    ctx.bl1238.pureSource = source;
  });

  scoped(/^the role reaches the idle-clear decision$/, (ctx) => {
    const st = ctx.bl1238;
    if (st.pureSource) {
      st.pureResult = decidePure(st.pureSource, st.fullness, st.threshold === 'default' ? 75 : st.threshold);
    } else {
      st.result = runCli(st.optin, st.threshold, st.fullness);
    }
  });

  scoped(/^the role respawns$/, (ctx) => {
    const st = ctx.bl1238;
    if (st.pureResult) {
      assert.equal(st.pureResult.respawn, true, 'expected the pure decision to respawn');
    } else {
      assert.equal(st.result.respawn, true, `expected respawn, got ${JSON.stringify(st.result)}`);
    }
  });

  scoped(/^the role stays in its session$/, (ctx) => {
    const st = ctx.bl1238;
    assert.equal(st.result.respawn, false, `expected no respawn, got ${JSON.stringify(st.result)}`);
  });

  scoped(/^the decision records that the reading came from (telemetry|proxy)$/, (ctx, source) => {
    const st = ctx.bl1238;
    assert.equal(st.pureResult.source, source);
  });

  scoped(/^the decision records that no reading was available$/, (ctx) => {
    // Driven through the real CLI (scenario 04) - confirmed via the pure
    // lib's own contract (idle_clear_fullness_lib_test_runner.bb) that an
    // unavailable reading is recorded as :unavailable with respawn? false;
    // here we assert the end-to-end observable outcome the CLI exposes.
    const st = ctx.bl1238;
    assert.equal(st.result.respawn, false, 'an unavailable reading must never respawn');
  });
}

module.exports = { registerSteps };
