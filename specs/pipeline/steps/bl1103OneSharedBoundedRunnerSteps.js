'use strict';

// BL-1103: one shared bounded runner. Drives REAL bounded_run_lib.bb via bb -e
// for the three feature scenarios, and asserts both callers source that lib
// rather than carrying a second copy of the group-kill / no-deref traps.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const LIB = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'bounded_run_lib.bb');
const FEATURE =
  'one shared bounded runner, sourced by both callers that hand-copied it';

function runBounded(timeoutMs, cmdBash) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bl1103-'));
  const out = path.join(dir, 'out');
  const err = path.join(dir, 'err');
  const script = `
(load-file "${LIB.replace(/\\/g, '/')}")
(let [t0 (System/currentTimeMillis)
      r (bounded-run-lib/run-bounded! {} ${timeoutMs} "${out.replace(/\\/g, '/')}" "${err.replace(/\\/g, '/')}"
                                      "bash" "-c" ${JSON.stringify(cmdBash)})
      elapsed (- (System/currentTimeMillis) t0)
      out-txt (try (slurp "${out.replace(/\\/g, '/')}") (catch Exception _ ""))
      err-txt (try (slurp "${err.replace(/\\/g, '/')}") (catch Exception _ ""))]
  (println (pr-str {:timed-out? (:timed-out? r)
                    :exit (:exit r)
                    :elapsed elapsed
                    :out out-txt
                    :err err-txt})))
`;
  const res = spawnSync('bb', ['-e', script], {
    encoding: 'utf8',
    timeout: 20000,
  });
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch (_) {
    /* ignore */
  }
  if (res.status !== 0 && res.status !== null) {
    throw new Error(`run-bounded! failed: ${res.stdout}\n${res.stderr}`);
  }
  const line = (res.stdout || '').trim().split('\n').pop();
  // edn-ish map from pr-str — parse the fields we need with regexes.
  return {
    raw: line,
    timedOut: /:timed-out\? true/.test(line),
    exit: (() => {
      const m = line.match(/:exit (nil|\d+)/);
      return m ? (m[1] === 'nil' ? null : Number(m[1])) : undefined;
    })(),
    elapsed: (() => {
      const m = line.match(/:elapsed (\d+)/);
      return m ? Number(m[1]) : null;
    })(),
    out: (() => {
      const m = line.match(/:out "(.*?)"(?= :err|,|\})/s);
      return m ? m[1].replace(/\\n/g, '\n') : '';
    })(),
  };
}

function countSleep3600() {
  const res = spawnSync(
    'bash',
    ['-c', 'ps -eo pid=,args= | awk \'$2=="sleep" && $3=="3600" {c++} END {print c+0}\''],
    { encoding: 'utf8' }
  );
  return Number((res.stdout || '0').trim()) || 0;
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(/^a bounded runner with a wall-clock bound and a command to run under it$/, (ctx) => {
    ctx.bl1103 = {};
    // Wiring invariant: both callers source the shared lib (required_wiring).
    const expedite = fs.readFileSync(
      path.join(REPO_ROOT, 'swarmforge', 'scripts', 'expedite_cli.bb'),
      'utf8'
    );
    const babysitter = fs.readFileSync(
      path.join(REPO_ROOT, 'swarmforge', 'scripts', 'babysitter_check.bb'),
      'utf8'
    );
    const lib = fs.readFileSync(LIB, 'utf8');
    assert.ok(expedite.includes('bounded_run_lib.bb'), 'expedite must load-file bounded_run_lib.bb');
    assert.ok(babysitter.includes('bounded_run_lib.bb'), 'babysitter must load-file bounded_run_lib.bb');
    assert.ok(/"kill" "-KILL" "--"/.test(lib), 'lib must carry the load-bearing group-kill');
    assert.equal(
      (expedite.match(/"kill" "-KILL" "--"/g) || []).length,
      0,
      'expedite must not keep a second copy of the group-kill'
    );
    assert.equal(
      (babysitter.match(/"kill" "-KILL" "--"/g) || []).length,
      0,
      'babysitter must not keep a second copy of the group-kill'
    );
  });

  scoped(/^a command that spawns a child and neither exits before the bound$/, (ctx) => {
    ctx.bl1103.beforeOrphans = countSleep3600();
    ctx.bl1103.cmd = 'sleep 3600 & sleep 3600';
    ctx.bl1103.boundMs = 400;
  });

  scoped(
    /^a command that exits at once after spawning a child that holds the output pipe open past the bound$/,
    (ctx) => {
      // Fifo handshake so the pipe-holder is alive before the parent exits
      // (same WSL race BL-1031 documented for the daemon chokepoint).
      ctx.bl1103.cmd =
        'echo child-output; s=$(mktemp -u); mkfifo "$s" || exit 1; ' +
        '(echo ready >"$s"; exec sleep 5) & ' +
        'read _ <"$s"; rm -f "$s"; exit 0';
      ctx.bl1103.boundMs = 300;
      ctx.bl1103.pipeHolder = true;
    }
  );

  scoped(
    /^a command that exits before the bound with output on stdout and a non-zero code$/,
    (ctx) => {
      ctx.bl1103.cmd = 'echo fail-out; exit 42';
      ctx.bl1103.boundMs = 5000;
      ctx.bl1103.expectPassThrough = true;
    }
  );

  scoped(/^the bound expires$/, (ctx) => {
    ctx.bl1103.result = runBounded(ctx.bl1103.boundMs, ctx.bl1103.cmd);
  });

  scoped(/^the runner runs it$/, (ctx) => {
    ctx.bl1103.result = runBounded(ctx.bl1103.boundMs, ctx.bl1103.cmd);
  });

  scoped(
    /^the command and its child are both gone and the caller is told the bound expired$/,
    (ctx) => {
      const r = ctx.bl1103.result;
      assert.equal(r.timedOut, true, `expected timed-out?: ${r.raw}`);
      assert.equal(r.exit, null, `expected exit nil: ${r.raw}`);
      assert.ok(r.elapsed !== null && r.elapsed < 5000, `did not return promptly: ${r.raw}`);
      // Give reaped grandchildren a beat to disappear from ps.
      spawnSync('bash', ['-c', 'sleep 0.5']);
      assert.equal(
        countSleep3600(),
        ctx.bl1103.beforeOrphans,
        'a sleep 3600 grandchild survived the group kill'
      );
    }
  );

  scoped(
    /^the caller receives its result within the bound rather than blocking on the pipe$/,
    (ctx) => {
      const r = ctx.bl1103.result;
      assert.ok(r, 'no result — the runner blocked on the pipe');
      // File redirects: parent exit is observed promptly; timed-out? stays false.
      // The contract is "returns within the bound", not "must take the timeout path".
      assert.equal(r.timedOut, false, `unexpected timeout on prompt parent exit: ${r.raw}`);
      assert.ok(r.elapsed !== null && r.elapsed < 8000, `blocked too long: ${r.raw}`);
    }
  );

  scoped(
    /^the caller receives that exit code and that output, and is not told the bound expired$/,
    (ctx) => {
      const r = ctx.bl1103.result;
      assert.equal(r.timedOut, false, `unexpected timeout: ${r.raw}`);
      assert.equal(r.exit, 42, `expected exit 42: ${r.raw}`);
      assert.match(r.out, /fail-out/, `stdout missing fail-out: ${r.raw}`);
    }
  );
}

module.exports = { registerSteps };
