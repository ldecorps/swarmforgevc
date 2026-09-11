'use strict';

// BL-1524: process_table_lib.bb, model_factory_store.bb,
// outage_failover_store.bb and handoff_lib.bb's rotation bootstrap now route
// through daemon-cycle-guard-lib instead of calling babashka.process
// directly. Scenarios 01-02 drive the real gate / real ban scan / real
// closure walk (same libs BL-1022/BL-1031 used). Scenario 03 drives the two
// converted call sites end to end (a fake launch-seam script, a fake tmux on
// PATH) and proves both the bound and the kill. Scenario 04 proves the ban's
// default exempt set is exactly the chokepoint file, not a blunted gate.

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
const MODEL_FACTORY_STORE = path.join(SCRIPTS, 'model_factory_store.bb');
const OUTAGE_FAILOVER_STORE = path.join(SCRIPTS, 'outage_failover_store.bb');

const FEATURE = "BL-1524 The daemon's load closure routes its four stray subprocess calls through the chokepoint";

function ensureState(ctx) {
  if (!ctx.bl1524) ctx.bl1524 = {};
  return ctx.bl1524;
}

function bb(expr, env = {}) {
  return spawnSync('bb', ['-e', expr], {
    encoding: 'utf8',
    cwd: REPO_ROOT,
    env: { ...process.env, ...env },
    timeout: 30000,
  });
}

function realClosure() {
  const out = execFileSync(
    'bb',
    [
      '-e',
      `(require '[cheshire.core :as json])
(require '[babashka.fs :as fs])
(load-file ${JSON.stringify(WALK_LIB)})
(let [scripts-dir ${JSON.stringify(SCRIPTS)}
      read-file (fn [bare]
                  (let [p (fs/path scripts-dir bare)]
                    (when (fs/exists? p) (slurp (str p)))))
      r (master-checkout-drift-lib/resolve-daemon-reachability
          {:entrypoints #{"handoffd.bb"} :read-file read-file})]
  (println (json/generate-string {:closure (vec (sort (:closure r)))})))`,
    ],
    { encoding: 'utf8', cwd: REPO_ROOT }
  );
  return JSON.parse(out.trim()).closure;
}

function offendersOverFiles(files, exemptExpr) {
  const out = execFileSync(
    'bb',
    [
      '-e',
      `(require '[cheshire.core :as json])
(load-file ${JSON.stringify(BAN_LIB)})
(let [srcs ${clojureFileMap(files)}
      read-file (fn [name] (get srcs name))]
  (println (json/generate-string
    (daemon-api-ban-lib/offenders (vec (keys srcs)) read-file${exemptExpr ? ' ' + exemptExpr : ''}))))`,
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

// True (process is alive) or false, tolerating a pid that never existed.
function pidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

// A throw between setup() and the terminal "no process ... is still alive"
// step (which owns cleanup in its own `finally`) would otherwise leak
// st.dir/st.pathDir - the intervening assertion step below can throw on a
// genuine regression (wrong exit, elapsed over budget), and that throw
// must not skip cleanup.
function cleanupFixtureDirs(st) {
  if (st.dir) fs.rmSync(st.dir, { recursive: true, force: true });
  if (st.pathDir) fs.rmSync(st.pathDir, { recursive: true, force: true });
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

const SITES = {
  "model-factory-store's invoke-launch-seam!": {
    setup(st) {
      const d = fs.mkdtempSync(path.join(os.tmpdir(), 'bl1524-seam-'));
      st.dir = d;
      st.pidfile = path.join(d, 'child.pid');
      const seam = path.join(d, 'seam.sh');
      fs.writeFileSync(seam, `#!/bin/sh\necho $$ > ${JSON.stringify(st.pidfile)}\nsleep 600\n`);
      fs.chmodSync(seam, 0o755);
      st.seam = seam;
    },
    invoke(st) {
      const expr = [
        `(load-file ${JSON.stringify(MODEL_FACTORY_STORE)})`,
        '(def t0 (System/currentTimeMillis))',
        `(def r (model-factory-store/invoke-launch-seam! ${JSON.stringify(st.seam)} {} ${JSON.stringify(st.dir)}))`,
        '(println (str "EXIT=" r " ELAPSED=" (- (System/currentTimeMillis) t0)))',
      ].join('\n');
      return bb(expr, { SWARMFORGE_SUBPROCESS_WAIT_BOUND_MS: '300' });
    },
  },
  "outage-failover-store's respawn-seat!": {
    setup(st) {
      const d = fs.mkdtempSync(path.join(os.tmpdir(), 'bl1524-respawn-'));
      st.dir = d;
      fs.mkdirSync(path.join(d, '.swarmforge', 'launch'), { recursive: true });
      fs.writeFileSync(path.join(d, '.swarmforge', 'launch', 'coder.sh'), '#!/bin/sh\ntrue\n');

      const pathDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bl1524-tmux-path-'));
      st.pathDir = pathDir;
      st.pidfile = path.join(d, 'child.pid');
      const tmuxStub = path.join(pathDir, 'tmux');
      fs.writeFileSync(tmuxStub, `#!/bin/sh\necho $$ > ${JSON.stringify(st.pidfile)}\nsleep 600\n`);
      fs.chmodSync(tmuxStub, 0o755);
    },
    invoke(st) {
      const expr = [
        `(load-file ${JSON.stringify(OUTAGE_FAILOVER_STORE)})`,
        '(def t0 (System/currentTimeMillis))',
        `(def r (outage-failover-store/respawn-seat! ${JSON.stringify(st.dir)} "coder" "fake-socket"))`,
        '(println (str "EXIT=" (:exit r) " ELAPSED=" (- (System/currentTimeMillis) t0)))',
      ].join('\n');
      return bb(expr, {
        SWARMFORGE_SUBPROCESS_WAIT_BOUND_MS: '300',
        PATH: `${st.pathDir}${path.delimiter}${process.env.PATH}`,
      });
    },
  },
};

function registerSteps(registry) {
  registry.defineScoped(/^the daemon cycle guard test runner runs on the real swarmforge\/scripts tree$/, (ctx) => {
    ensureState(ctx).gate = spawnSync('bb', [GATE_RUNNER], {
      encoding: 'utf8',
      cwd: REPO_ROOT,
      timeout: 120000,
    });
  }, FEATURE);

  registry.defineScoped(
    /^its output has no FAIL line naming the load-closure assertion "invariant 1 structural half"$/,
    (ctx) => {
      const st = ensureState(ctx);
      // The runner's other two assertions (bl1022 unresolved spawn targets,
      // bl1031 spawn debt) are BL-1525's/BL-1526's and may still fail - this
      // scenario asserts only that THIS line is gone.
      assert.doesNotMatch(
        st.gate.stdout,
        /FAIL invariant 1 structural half/,
        `load-closure assertion still failing:\n${st.gate.stdout}`
      );
    },
    FEATURE
  );

  registry.defineScoped(/^its closure census line reports more than 60 files$/, (ctx) => {
    const st = ensureState(ctx);
    const m = /BL-1022 closure: (\d+) files/.exec(st.gate.stdout);
    assert.ok(m, `closure census line not found:\n${st.gate.stdout}`);
    assert.ok(Number(m[1]) > 60, `closure only reports ${m[1]} files`);
  }, FEATURE);

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

  registry.defineScoped(/^(.+) is still in handoffd\.bb's load-file closure$/, (ctx, file) => {
    const st = ensureState(ctx);
    if (!st.closure) st.closure = realClosure();
    assert.ok(st.closure.includes(file), `${file} missing from closure: ${JSON.stringify(st.closure)}`);
  }, FEATURE);

  registry.defineScoped(/^the subprocess wait bound is 300 milliseconds$/, (ctx) => {
    ensureState(ctx).boundMs = 300;
  }, FEATURE);

  registry.defineScoped(/^a fake (.+) that sleeps for 600 seconds$/, (ctx, childName) => {
    const st = ensureState(ctx);
    st.childName = childName;
  }, FEATURE);

  registry.defineScoped(/^(.+) is invoked against that fake$/, (ctx, siteName) => {
    const st = ensureState(ctx);
    const site = SITES[siteName];
    if (!site) throw new Error(`BL-1524: unknown site "${siteName}"`);
    site.setup(st);
    st.callResult = site.invoke(st);
  }, FEATURE);

  registry.defineScoped(/^the call returns within 5 seconds with a non-zero exit$/, (ctx) => {
    const st = ensureState(ctx);
    try {
      assert.equal(st.callResult.status, 0, `bb itself failed:\n${st.callResult.stderr}\n${st.callResult.stdout}`);
      const m = /EXIT=(-?\d+) ELAPSED=(\d+)/.exec(st.callResult.stdout);
      assert.ok(m, st.callResult.stdout);
      st.exit = Number(m[1]);
      st.elapsed = Number(m[2]);
      assert.ok(st.elapsed < 5000, `elapsed ${st.elapsed}ms`);
      assert.notEqual(st.exit, 0, 'expected a non-zero (bound-hit) exit');
    } catch (e) {
      cleanupFixtureDirs(st);
      throw e;
    }
  }, FEATURE);

  registry.defineScoped(/^no process of the fake (.+) is still alive$/, (ctx) => {
    const st = ensureState(ctx);
    try {
      const pid = waitForPidfile(st.pidfile, 3000);
      assert.ok(pid, `fake child never wrote its pidfile at ${st.pidfile}`);
      assert.equal(pidAlive(pid), false, `fake child pid ${pid} is still alive - the bound hit did not kill its tree`);
    } finally {
      cleanupFixtureDirs(st);
    }
  }, FEATURE);

  registry.defineScoped(/^the subprocess-API ban scan's default exempt set is read$/, (ctx) => {
    const st = ensureState(ctx);
    const files = {
      'daemon_cycle_guard_lib.bb': '(ns daemon-cycle-guard-lib (:require [babashka.process :as process]))\n(defn go [] (process/sh "true"))',
      'other_stray.bb': '(ns other-stray (:require [babashka.process :as process]))\n(defn go [] (process/sh "true"))',
    };
    // The 2-arity call - no exempt arg - so this exercises the DEFAULT set.
    st.exemptScan = offendersOverFiles(files);
  }, FEATURE);

  registry.defineScoped(/^it names only daemon_cycle_guard_lib\.bb$/, (ctx) => {
    const st = ensureState(ctx);
    const joined = st.exemptScan.join('\n');
    assert.doesNotMatch(
      joined,
      /daemon_cycle_guard_lib\.bb/,
      `the default exempt set did not cover daemon_cycle_guard_lib.bb: ${joined}`
    );
  }, FEATURE);

  registry.defineScoped(
    /^a scratch closure holding one file with a direct process\/sh call outside the chokepoint is still reported$/,
    (ctx) => {
      const st = ensureState(ctx);
      const joined = st.exemptScan.join('\n');
      assert.match(joined, /other_stray\.bb/, `other_stray.bb's banned call was not reported: ${joined}`);
    },
    FEATURE
  );
}

module.exports = { registerSteps };
