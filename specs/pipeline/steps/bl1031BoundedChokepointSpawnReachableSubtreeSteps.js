'use strict';

// BL-1031: spawn-reachable subtree cleared of unbounded process/sh.
// Scenarios 01 and 05 drive the real gate / fixture ban scan (same libs
// BL-1022 used). Scenarios 02–04 drive the converted helpers and evaluate
// under SWARMFORGE_SUBPROCESS_WAIT_BOUND_MS.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync, execFileSync } = require('node:child_process');
const { track } = require('./lib/fixtureReaper');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const SCRIPTS = path.join(REPO_ROOT, 'swarmforge', 'scripts');
const GATE_RUNNER = path.join(SCRIPTS, 'test', 'daemon_cycle_guard_lib_test_runner.bb');
const WALK_LIB = path.join(SCRIPTS, 'master_checkout_drift_lib.bb');
const BAN_LIB = path.join(SCRIPTS, 'test', 'daemon_api_ban_lib.bb');
const SALVAGE = path.join(SCRIPTS, 'salvage_lib.bb');
const INJECT = path.join(SCRIPTS, 'handoff_inject_lib.bb');
const PRE_QA = path.join(SCRIPTS, 'pre_qa_gate_gather_lib.bb');
const ACCEPT_GATE = path.join(SCRIPTS, 'acceptance_contract_gate_lib.bb');

const FEATURE =
  'every subprocess the handoff daemon can reach runs under the bounded chokepoint';

const KNOWN_LIBS = {
  'handoff_inject_lib.bb': { path: INJECT, hangExpr: '(daemon-cycle-guard-lib/sh! "bash" "-c" "sleep 600")' },
  'pre_qa_gate_gather_lib.bb': { path: PRE_QA, hangExpr: '(daemon-cycle-guard-lib/sh! "bash" "-c" "sleep 600")' },
  'salvage_lib.bb': { path: SALVAGE, hangExpr: '(daemon-cycle-guard-lib/sh! "bash" "-c" "sleep 600")' },
};

function ensureState(ctx) {
  if (!ctx.bl1031) ctx.bl1031 = {};
  return ctx.bl1031;
}

function bb(expr, env = {}) {
  return spawnSync('bb', ['-e', expr], {
    encoding: 'utf8',
    cwd: REPO_ROOT,
    env: { ...process.env, ...env },
    timeout: 30000,
  });
}

function clojureFileMap(files) {
  return `{${Object.entries(files)
    .map(([name, src]) => `"${name}" ${JSON.stringify(src)}`)
    .join(' ')}}`;
}

function gateOverFixture(files) {
  const out = execFileSync(
    'bb',
    [
      '-e',
      `(require '[cheshire.core :as json])
(load-file ${JSON.stringify(WALK_LIB)})
(load-file ${JSON.stringify(BAN_LIB)})
(let [srcs ${clojureFileMap(files)}
      r (master-checkout-drift-lib/resolve-daemon-reachability
          {:entrypoints #{"entry.bb"} :read-file srcs})]
  (println (json/generate-string
    {:closure (vec (sort (:closure r)))
     :offenders (daemon-api-ban-lib/offenders (:closure r) srcs)})))`,
    ],
    { encoding: 'utf8', cwd: REPO_ROOT }
  );
  return JSON.parse(out.trim());
}

function registerSteps(registry) {
  registry.defineScoped(/^the handoff daemon's reachability closure over spawn and load edges$/, (ctx) => {
    ensureState(ctx);
  }, FEATURE);

  registry.defineScoped(/^the subprocess-API ban is scanned over every file in the closure$/, (ctx) => {
    ensureState(ctx).gate = spawnSync('bb', [GATE_RUNNER], {
      encoding: 'utf8',
      cwd: REPO_ROOT,
      timeout: 120000,
    });
  }, FEATURE);

  registry.defineScoped(/^no file outside the bounded chokepoint carries a banned subprocess API$/, (ctx) => {
    const st = ensureState(ctx);
    assert.equal(st.gate.status, 0, `gate failed:\n${st.gate.stdout}\n${st.gate.stderr}`);
    assert.match(st.gate.stdout, /bl1031: spawn-reachable subtree carries no banned-API debt|spawn-only banned-API debt: \[\]/);
  }, FEATURE);

  registry.defineScoped(/^(.+) is called with a subprocess wait bound of 2000 milliseconds$/, (ctx, libName) => {
    const lib = KNOWN_LIBS[libName];
    if (!lib) throw new Error(`BL-1031: unknown library "${libName}"`);
    const st = ensureState(ctx);
    st.lib = lib;
    st.libName = libName;
    st.boundMs = 2000;
  }, FEATURE);

  registry.defineScoped(/^the child process it starts never exits$/, (ctx) => {
    ensureState(ctx).hang = true;
  }, FEATURE);

  registry.defineScoped(/^the call runs$/, (ctx) => {
    const st = ensureState(ctx);
    if (st.hang && st.lib) {
      const expr = [
        `(load-file ${JSON.stringify(st.lib.path)})`,
        '(def t0 (System/currentTimeMillis))',
        `(def r ${st.lib.hangExpr})`,
        '(println (str "EXIT=" (:exit r) " ELAPSED=" (- (System/currentTimeMillis) t0)))',
      ].join('\n');
      st.callResult = bb(expr, { SWARMFORGE_SUBPROCESS_WAIT_BOUND_MS: String(st.boundMs) });
      return;
    }
    if (st.dirCheck) {
      const other = fs.mkdtempSync(path.join(os.tmpdir(), 'bl1031-dir-'));
      track(other);
      fs.writeFileSync(path.join(other, 'marker.txt'), 'from-other-dir\n');
      st.dirResult = bb(
        [
          `(load-file ${JSON.stringify(SALVAGE)})`,
          `(println (salvage-lib/sh-out ${JSON.stringify(other)} "cat" "marker.txt"))`,
        ].join('\n')
      );
    }
  }, FEATURE);

  registry.defineScoped(/^it returns within the wait bound$/, (ctx) => {
    const st = ensureState(ctx);
    assert.equal(st.callResult.status, 0, `${st.callResult.stderr}\n${st.callResult.stdout}`);
    const elapsedM = /ELAPSED=(\d+)/.exec(st.callResult.stdout);
    assert.ok(elapsedM, st.callResult.stdout);
    assert.ok(Number(elapsedM[1]) < st.boundMs + 3000, `elapsed ${elapsedM[1]}`);
  }, FEATURE);

  registry.defineScoped(/^the result reports exit code 124$/, (ctx) => {
    const st = ensureState(ctx);
    assert.match(st.callResult.stdout, /EXIT=124/);
  }, FEATURE);

  registry.defineScoped(/^salvage_lib\.bb's shell helper is called with a working directory$/, (ctx) => {
    ensureState(ctx).dirCheck = true;
  }, FEATURE);

  registry.defineScoped(/^the child process runs in that directory$/, (ctx) => {
    const st = ensureState(ctx);
    assert.equal(st.dirResult.status, 0, st.dirResult.stderr);
    assert.match(st.dirResult.stdout, /from-other-dir/);
  }, FEATURE);

  registry.defineScoped(/^the acceptance-contract step resolver exceeds the subprocess wait bound$/, (ctx) => {
    ensureState(ctx).waitBoundEval = true;
  }, FEATURE);

  registry.defineScoped(/^the pre-QA gate evaluates the acceptance contract$/, (ctx) => {
    const st = ensureState(ctx);
    st.evalResult = bb(
      [
        `(load-file ${JSON.stringify(ACCEPT_GATE)})`,
        '(println (pr-str (acceptance-contract-gate-lib/evaluate',
        '  {:ticket-id "BL-1031" :declaration-readable? true',
        '   :registry-loadable? false :wait-bound-hit? true',
        '   :registry-load-error "wait-bound hit (exit 124): daemon-cycle-guard: bounded-wait timeout"',
        '   :unresolved-steps []})))',
      ].join('\n')
    );
  }, FEATURE);

  registry.defineScoped(/^the gate's output names the wait-bound hit$/, (ctx) => {
    const st = ensureState(ctx);
    assert.equal(st.evalResult.status, 0, st.evalResult.stderr);
    assert.match(st.evalResult.stdout, /wait-bound/);
  }, FEATURE);

  registry.defineScoped(/^the result is distinguishable from a contract that checked clean$/, (ctx) => {
    const st = ensureState(ctx);
    assert.match(st.evalResult.stdout, /:findings \[\{/);
    assert.doesNotMatch(st.evalResult.stdout, /:findings \[\]/);
  }, FEATURE);

  registry.defineScoped(/^a file inside the closure reintroduces an unbounded subprocess call$/, (ctx) => {
    const st = ensureState(ctx);
    st.files = {
      'entry.bb': '(sh! ["bb" "spawned.bb" (str draft)])',
      'spawned.bb':
        '(ns spawned (:require [babashka.process :as process]))\n(defn go [] (process/sh "true"))',
    };
  }, FEATURE);

  registry.defineScoped(/^the gate runs$/, (ctx) => {
    const st = ensureState(ctx);
    if (st.files) {
      st.fixtureGate = gateOverFixture(st.files);
    } else {
      st.liveGate = spawnSync('bb', [GATE_RUNNER], { encoding: 'utf8', cwd: REPO_ROOT, timeout: 120000 });
    }
  }, FEATURE);

  registry.defineScoped(/^the gate fails and names that file and that call$/, (ctx) => {
    const st = ensureState(ctx);
    assert.ok(st.fixtureGate.offenders.length > 0, `expected offenders, got ${JSON.stringify(st.fixtureGate)}`);
    const joined = st.fixtureGate.offenders.join('\n');
    assert.match(joined, /spawned\.bb/);
    assert.match(joined, /process\/sh|babashka\.process/);
  }, FEATURE);
}

module.exports = { registerSteps };
