'use strict';

// BL-1526: the daemon's spawn-resolution walk (master_checkout_drift_lib.bb)
// must see every spawn edge in its reachable closure, including the four
// sites bound to locals it did not previously read: handoffd.bb's `launcher`
// and `script`, chase_sweep_lib.bb's `cli` (all three now inline their path
// literal directly in the spawn vector, the "literal wrapped in path
// plumbing" shape the resolver already reads) and expedite_cli.bb's `runner`
// (the EXPEDITE_STAGE_RUNNER test seam, genuinely dynamic - no literal
// anywhere - and declared as such via `daemon-spawn-declared-dynamic-targets`).
//
// Scenarios 01/02 drive the REAL walk over the REAL tree, matching the
// sibling BL-1022/BL-1525 handlers' convention. Scenario 03 drives the walk
// over an in-memory fixture, since it needs a target this repo does not
// actually carry. Scenario 04 drives the real expedite_cli.bb stage runner
// end to end with a stub installed through EXPEDITE_STAGE_RUNNER, then
// re-runs the walk over expedite_cli.bb alone.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const FEATURE = 'BL-1526 Every daemon spawn target resolves statically';

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const SCRIPTS = path.join(REPO_ROOT, 'swarmforge', 'scripts');
const WALK_LIB = path.join(SCRIPTS, 'master_checkout_drift_lib.bb');
const GATE_RUNNER = path.join(SCRIPTS, 'test', 'daemon_cycle_guard_lib_test_runner.bb');
const EXPEDITE_CLI = path.join(SCRIPTS, 'expedite_cli.bb');

function ensureState(ctx) {
  if (!ctx.bl1526) ctx.bl1526 = {};
  return ctx.bl1526;
}

function clojureFileMap(files) {
  return `{${Object.entries(files)
    .map(([name, src]) => `"${name}" ${JSON.stringify(src)}`)
    .join(' ')}}`;
}

function bb(expr, opts = {}) {
  return execFileSync('bb', ['-e', expr], { encoding: 'utf8', cwd: REPO_ROOT, ...opts }).trim();
}

function realReach() {
  return JSON.parse(
    bb(`(require '[babashka.fs :as fs] '[cheshire.core :as json])
(load-file ${JSON.stringify(WALK_LIB)})
(let [scripts-dir ${JSON.stringify(SCRIPTS)}
      read-file (fn [bare]
                  (let [p (fs/path scripts-dir bare)]
                    (when (fs/exists? p) (slurp (str p)))))
      r (master-checkout-drift-lib/resolve-daemon-reachability
          {:entrypoints #{"handoffd.bb"} :read-file read-file})]
  (println (json/generate-string
    {:closure (vec (sort (:closure r)))
     :reached-by (into {} (for [[k v] (:reached-by r)] [k (mapv pr-str v)]))
     :unresolved (:unresolved r)
     :non-bb (vec (sort (:non-bb r)))})))`)
  );
}

function walkOverFile(bareFilename) {
  const p = path.join(SCRIPTS, bareFilename);
  const src = fs.readFileSync(p, 'utf8');
  return JSON.parse(
    bb(`(require '[cheshire.core :as json])
(load-file ${JSON.stringify(WALK_LIB)})
(let [r (master-checkout-drift-lib/resolve-daemon-reachability
          {:entrypoints #{${JSON.stringify(bareFilename)}} :read-file ${clojureFileMap({ [bareFilename]: src })}})]
  (println (json/generate-string {:unresolved (:unresolved r)})))`)
  );
}

function walkFixture(files, entrypoint) {
  return JSON.parse(
    bb(`(require '[cheshire.core :as json])
(load-file ${JSON.stringify(WALK_LIB)})
(let [r (master-checkout-drift-lib/resolve-daemon-reachability
          {:entrypoints #{${JSON.stringify(entrypoint)}} :read-file ${clojureFileMap(files)}})]
  (println (json/generate-string {:unresolved (:unresolved r)})))`)
  );
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(/^the daemon reachability walk runs from handoffd\.bb over the real swarmforge\/scripts tree$/, (ctx) => {
    ensureState(ctx).reach = realReach();
  });

  scoped(/^its unresolved list is empty$/, (ctx) => {
    const st = ensureState(ctx);
    assert.deepEqual(st.reach.unresolved, [], `expected no unresolved spawn targets: ${JSON.stringify(st.reach.unresolved)}`);
  });

  scoped(
    /^the daemon cycle guard test runner's output has no FAIL line naming "(.+)"$/,
    (ctx, needle) => {
      const st = ensureState(ctx);
      const result = require('node:child_process').spawnSync('bb', [GATE_RUNNER], {
        encoding: 'utf8',
        cwd: REPO_ROOT,
        timeout: 120000,
      });
      st.gate = result;
      const re = new RegExp(`FAIL ${needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`);
      assert.doesNotMatch(result.stdout, re, `spawn-target assertion still failing:\n${result.stdout}`);
    }
  );

  scoped(/^its non-bb spawn record names start_handoff_daemon\.sh and close_ticket\.sh$/, (ctx) => {
    const st = ensureState(ctx);
    for (const name of ['start_handoff_daemon.sh', 'close_ticket.sh']) {
      assert.ok(st.reach['non-bb'].includes(name), `non-bb record missing ${name}: ${JSON.stringify(st.reach['non-bb'])}`);
    }
  });

  scoped(
    /^the closure holds commit_integrity_cli\.bb by a spawn edge from chase_sweep_lib\.bb and expedite_cli\.bb by a spawn edge from handoffd\.bb$/,
    (ctx) => {
      const st = ensureState(ctx);
      const check = (file, from) => {
        const edges = st.reach['reached-by'][file] || [];
        assert.ok(
          edges.some((e) => e.includes(':spawn') && e.includes(from)),
          `${file} not reached by a spawn edge from ${from}: ${JSON.stringify(edges)}`
        );
      };
      check('commit_integrity_cli.bb', 'chase_sweep_lib.bb');
      check('expedite_cli.bb', 'handoffd.bb');
    }
  );

  scoped(
    /^a scratch entrypoint whose only spawn is \["bb" mystery "arg"\] with mystery bound nowhere in the file$/,
    (ctx) => {
      const st = ensureState(ctx);
      st.fixtureEntry = 'scratch-entry.bb';
      st.fixtureFiles = { 'scratch-entry.bb': '(sh! ["bb" mystery "arg"])' };
    }
  );

  scoped(/^the daemon reachability walk runs from that scratch entrypoint$/, (ctx) => {
    const st = ensureState(ctx);
    st.reach = walkFixture(st.fixtureFiles, st.fixtureEntry);
  });

  scoped(/^its unresolved list names that entrypoint and the target "(.+)"$/, (ctx, target) => {
    const st = ensureState(ctx);
    assert.ok(
      st.reach.unresolved.some((u) => u.from === st.fixtureEntry && u.target === target),
      `unresolved list does not name ${st.fixtureEntry}/${target}: ${JSON.stringify(st.reach.unresolved)}`
    );
  });

  scoped(/^a stub stage runner that records its argv and exits 0$/, (ctx) => {
    // Reuse the SAME fixture BL-567/BL-1376's own CLI tests drive against
    // (expedite_fixture.sh), rather than a parallel one that could drift:
    // its stage-runner.sh already records every role it was invoked for
    // into .swarmforge/expedite-fixture/ran.log and exits 0 with a pass
    // verdict. expedite_cli.bb is a script whose bottom calls (-main), so it
    // must be driven as a real subprocess, never load-file'd for its
    // internals.
    const st = ensureState(ctx);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bl1526-expedite-'));
    const fixtureRoot = path.join(dir, 'fixture');
    execFileSync('bash', [path.join(SCRIPTS, 'test', 'expedite_fixture.sh'), fixtureRoot, '--active', 'BL-0000'], {
      encoding: 'utf8',
    });
    st.fixtureRoot = fixtureRoot;
    st.stub = path.join(fixtureRoot, 'stage-runner.sh');
    st.ranLog = path.join(fixtureRoot, '.swarmforge', 'expedite-fixture', 'ran.log');
  });

  scoped(/^one expedite stage is driven with the stub installed through the seam the ticket documents$/, (ctx) => {
    const st = ensureState(ctx);
    st.runResult = require('node:child_process').spawnSync('bb', [EXPEDITE_CLI, st.fixtureRoot, 'BL-0000', '--no-restart'], {
      encoding: 'utf8',
      cwd: REPO_ROOT,
      env: {
        ...process.env,
        EXPEDITE_STAGE_RUNNER: st.stub,
        EXPEDITE_STOP_CMD: './stop-swarm.sh',
        EXPEDITE_START_CMD: './start-swarm.sh',
      },
      timeout: 60000,
    });
  });

  scoped(/^the stub was invoked for that stage$/, (ctx) => {
    const st = ensureState(ctx);
    assert.ok(fs.existsSync(st.ranLog), `stub never recorded a run at ${st.ranLog}: ${st.runResult.stdout}\n${st.runResult.stderr}`);
    const ran = fs.readFileSync(st.ranLog, 'utf8').trim();
    assert.ok(ran.length > 0, `stub ran.log is empty - no stage was driven through the seam`);
  });

  scoped(/^the daemon reachability walk over expedite_cli\.bb reports no unresolved target$/, (ctx) => {
    const st = ensureState(ctx);
    try {
      const result = walkOverFile('expedite_cli.bb');
      assert.deepEqual(result.unresolved, [], `expedite_cli.bb still has an unresolved spawn target: ${JSON.stringify(result.unresolved)}`);
    } finally {
      if (st.fixtureRoot) fs.rmSync(path.dirname(st.fixtureRoot), { recursive: true, force: true });
    }
  });
}

module.exports = { registerSteps };
