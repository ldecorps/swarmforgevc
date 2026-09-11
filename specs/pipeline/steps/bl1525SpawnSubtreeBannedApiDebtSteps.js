'use strict';

// BL-1525: the three plain waits (ticket_close_guard_lib.bb's two git calls,
// unregistered_test_gate_lib.bb's git helper, expedite_cli.bb's own sh
// helper) route through daemon-cycle-guard-lib/sh!, and bounded_run_lib.bb's
// run-bounded! (human ruling A) becomes a thin wrapper over the same
// chokepoint instead of naming babashka.process itself - retiring the
// runner's bl1031 assertion to green again. Scenario 01 drives the real gate
// and the real reachability walk; 02 drives the real ban scan over each
// converted file alone; 03 proves the gate still fails a genuinely new
// offender in the spawn-reachable subtree; 04 proves the converted git call
// actually returns at its bound rather than hanging.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync, execFileSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const SCRIPTS = path.join(REPO_ROOT, 'swarmforge', 'scripts');
const GATE_RUNNER = path.join(SCRIPTS, 'test', 'daemon_cycle_guard_lib_test_runner.bb');
const WALK_LIB = path.join(SCRIPTS, 'master_checkout_drift_lib.bb');
const BAN_LIB = path.join(SCRIPTS, 'test', 'daemon_api_ban_lib.bb');
const TICKET_CLOSE_GUARD = path.join(SCRIPTS, 'ticket_close_guard_lib.bb');

const FEATURE = 'BL-1525 The spawn-reachable subtree carries no banned-API debt again';

function ensureState(ctx) {
  if (!ctx.bl1525) ctx.bl1525 = {};
  return ctx.bl1525;
}

function bb(expr, env = {}) {
  return spawnSync('bb', ['-e', expr], {
    encoding: 'utf8',
    cwd: REPO_ROOT,
    env: { ...process.env, ...env },
    timeout: 30000,
  });
}

function realReach() {
  const out = execFileSync(
    'bb',
    [
      '-e',
      `(require '[cheshire.core :as json])
(load-file ${JSON.stringify(WALK_LIB)})
(let [scripts-dir ${JSON.stringify(SCRIPTS)}
      read-file (fn [bare]
                  (let [p (babashka.fs/path scripts-dir bare)]
                    (when (babashka.fs/exists? p) (slurp (str p)))))
      r (master-checkout-drift-lib/resolve-daemon-reachability
          {:entrypoints #{"handoffd.bb"} :read-file read-file})]
  (println (json/generate-string
    {:reached-by (into {} (map (fn [[k v]] [k (mapv (fn [e] (if (vector? e) [(name (first e)) (second e)] (name e))) v)]) (:reached-by r)))})))`,
    ],
    { encoding: 'utf8', cwd: REPO_ROOT }
  );
  return JSON.parse(out.trim())['reached-by'];
}

function offendersOverFiles(files) {
  const out = execFileSync(
    'bb',
    [
      '-e',
      `(require '[cheshire.core :as json])
(load-file ${JSON.stringify(BAN_LIB)})
(let [srcs ${clojureFileMap(files)}
      read-file (fn [name] (get srcs name))]
  (println (json/generate-string
    (daemon-api-ban-lib/offenders (vec (keys srcs)) read-file))))`,
    ],
    { encoding: 'utf8', cwd: REPO_ROOT }
  );
  return JSON.parse(out.trim());
}

function clojureFileMap(files) {
  return `{${Object.entries(files)
    .map(([name, src]) => `"${name}" ${JSON.stringify(src)}`)
    .join(' ')}}`;
}

function spawnOnlyOffendersOverFixture(files) {
  const out = execFileSync(
    'bb',
    [
      '-e',
      `(require '[cheshire.core :as json])
(load-file ${JSON.stringify(WALK_LIB)})
(load-file ${JSON.stringify(BAN_LIB)})
(let [srcs ${clojureFileMap(files)}
      read-file (fn [name] (get srcs name))
      reach (master-checkout-drift-lib/resolve-daemon-reachability
              {:entrypoints #{"entry.bb"} :read-file read-file})
      load-closure (master-checkout-drift-lib/resolve-daemon-executed-paths
                     {:entrypoints #{"entry.bb"} :read-file read-file})
      spawn-only (remove load-closure (:closure reach))]
  (println (json/generate-string (daemon-api-ban-lib/offenders spawn-only read-file))))`,
    ],
    { encoding: 'utf8', cwd: REPO_ROOT }
  );
  return JSON.parse(out.trim());
}

function pidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function waitForPidfile(pidfile, deadlineMs) {
  const deadline = Date.now() + deadlineMs;
  while (Date.now() < deadline) {
    if (fs.existsSync(pidfile)) {
      const txt = fs.readFileSync(pidfile, 'utf8').trim();
      if (txt) return Number(txt);
    }
    execFileSync('sleep', ['0.05']);
  }
  return null;
}

function cleanupFixtureDirs(st) {
  if (st.dir) fs.rmSync(st.dir, { recursive: true, force: true });
  if (st.pathDir) fs.rmSync(st.pathDir, { recursive: true, force: true });
}

function registerSteps(registry) {
  registry.defineScoped(/^the daemon cycle guard test runner runs on the real swarmforge\/scripts tree$/, (ctx) => {
    ensureState(ctx).gate = spawnSync('bb', [GATE_RUNNER], {
      encoding: 'utf8',
      cwd: REPO_ROOT,
      timeout: 120000,
    });
  }, FEATURE);

  registry.defineScoped(/^its output has no FAIL line naming the spawn-subtree assertion "(.+)"$/, (ctx, needle) => {
    const st = ensureState(ctx);
    const re = new RegExp(`FAIL ${needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`);
    assert.doesNotMatch(st.gate.stdout, re, `spawn-subtree assertion still failing:\n${st.gate.stdout}`);
  }, FEATURE);

  registry.defineScoped(
    /^the daemon's reachability closure still holds expedite_cli\.bb reached by a spawn edge from handoffd\.bb$/,
    (ctx) => {
      const st = ensureState(ctx);
      if (!st.reachedBy) st.reachedBy = realReach();
      const edges = st.reachedBy['expedite_cli.bb'] || [];
      assert.ok(
        edges.some((e) => Array.isArray(e) && e[0] === 'spawn' && e[1] === 'handoffd.bb'),
        `expedite_cli.bb not reached by a spawn edge from handoffd.bb: ${JSON.stringify(edges)}`
      );
    },
    FEATURE
  );

  registry.defineScoped(
    /^the closure still holds ticket_close_guard_lib\.bb and unregistered_test_gate_lib\.bb reached by a load edge from swarm_handoff\.bb$/,
    (ctx) => {
      const st = ensureState(ctx);
      if (!st.reachedBy) st.reachedBy = realReach();
      for (const f of ['ticket_close_guard_lib.bb', 'unregistered_test_gate_lib.bb']) {
        const edges = st.reachedBy[f] || [];
        assert.ok(
          edges.some((e) => Array.isArray(e) && e[0] === 'load' && e[1] === 'swarm_handoff.bb'),
          `${f} not reached by a load edge from swarm_handoff.bb: ${JSON.stringify(edges)}`
        );
      }
    },
    FEATURE
  );

  registry.defineScoped(/^the subprocess-API ban scan runs over (.+) alone$/, (ctx, file) => {
    const st = ensureState(ctx);
    const content = fs.readFileSync(path.join(SCRIPTS, file), 'utf8');
    st.file = file;
    st.scanResult = offendersOverFiles({ [file]: content });
  }, FEATURE);

  registry.defineScoped(/^it reports zero offenders$/, (ctx) => {
    const st = ensureState(ctx);
    assert.deepEqual(st.scanResult, [], `${st.file} still has offenders: ${JSON.stringify(st.scanResult)}`);
  }, FEATURE);

  registry.defineScoped(
    /^a scratch closure whose entrypoint spawns one bb script that calls process\/sh directly$/,
    (ctx) => {
      const st = ensureState(ctx);
      st.files = {
        'entry.bb': '(daemon-cycle-guard-lib/sh! ["bb" "spawned.bb"])',
        'spawned.bb':
          '(ns spawned (:require [babashka.process :as process]))\n(defn go [] (process/sh "true"))',
      };
    },
    FEATURE
  );

  registry.defineScoped(/^the spawn-subtree ban scan runs over that scratch closure$/, (ctx) => {
    const st = ensureState(ctx);
    st.spawnOffenders = spawnOnlyOffendersOverFixture(st.files);
  }, FEATURE);

  registry.defineScoped(/^that script is reported as an offender$/, (ctx) => {
    const st = ensureState(ctx);
    const joined = st.spawnOffenders.join('\n');
    assert.match(joined, /spawned\.bb/, `spawned.bb not reported: ${joined}`);
  }, FEATURE);

  registry.defineScoped(/^the subprocess wait bound is 300 milliseconds$/, (ctx) => {
    ensureState(ctx).boundMs = 300;
  }, FEATURE);

  registry.defineScoped(/^a fake git on PATH that sleeps for 600 seconds$/, (ctx) => {
    const st = ensureState(ctx);
    const pathDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bl1525-git-path-'));
    st.pathDir = pathDir;
    st.pidfile = path.join(pathDir, 'git.pid');
    const gitStub = path.join(pathDir, 'git');
    fs.writeFileSync(gitStub, `#!/bin/sh\necho $$ > ${JSON.stringify(st.pidfile)}\nsleep 600\n`);
    fs.chmodSync(gitStub, 0o755);
  }, FEATURE);

  registry.defineScoped(
    /^ticket-close-guard-lib's git-backed close check is invoked in a scratch repository$/,
    (ctx) => {
      const st = ensureState(ctx);
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bl1525-repo-'));
      st.dir = dir;
      const expr = [
        `(load-file ${JSON.stringify(TICKET_CLOSE_GUARD)})`,
        '(def t0 (System/currentTimeMillis))',
        `(def r (ticket-close-guard-lib/ancestor-of-main? ${JSON.stringify(dir)} "deadbeef"))`,
        '(println (str "RESULT=" (pr-str r) " ELAPSED=" (- (System/currentTimeMillis) t0)))',
      ].join('\n');
      st.callResult = bb(expr, {
        SWARMFORGE_SUBPROCESS_WAIT_BOUND_MS: String(st.boundMs),
        PATH: `${st.pathDir}${path.delimiter}${process.env.PATH}`,
      });
    },
    FEATURE
  );

  registry.defineScoped(
    /^the call returns within 5 seconds and reports the check as not satisfied$/,
    (ctx) => {
      const st = ensureState(ctx);
      try {
        assert.equal(st.callResult.status, 0, `bb itself failed:\n${st.callResult.stderr}\n${st.callResult.stdout}`);
        const m = /RESULT=(\S+) ELAPSED=(\d+)/.exec(st.callResult.stdout);
        assert.ok(m, st.callResult.stdout);
        st.elapsed = Number(m[2]);
        assert.ok(st.elapsed < 5000, `elapsed ${st.elapsed}ms`);
        assert.equal(m[1], 'nil', `expected the ancestry question to come back undeterminable (nil), got ${m[1]}`);
      } catch (e) {
        cleanupFixtureDirs(st);
        throw e;
      }
    },
    FEATURE
  );

  registry.defineScoped(/^no process of the fake git is still alive$/, (ctx) => {
    const st = ensureState(ctx);
    try {
      const pid = waitForPidfile(st.pidfile, 3000);
      assert.ok(pid, `fake git never wrote its pidfile at ${st.pidfile}`);
      assert.equal(pidAlive(pid), false, `fake git pid ${pid} is still alive - the bound hit did not kill it`);
    } finally {
      cleanupFixtureDirs(st);
    }
  }, FEATURE);
}

module.exports = { registerSteps };
