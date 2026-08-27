'use strict';

// BL-1102: step handlers for spawn-failure-returns. Drives the REAL
// daemon_cycle_guard_lib.bb/sh! via bb -e and a thin harness — never a live
// handoffd process (scenario 04 proves two sequential sh! calls survive a
// spawn miss the way poll-once!/tmux! would once the chokepoint returns).
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { execFileSync } = require('node:child_process');

const SCRIPTS = path.join(__dirname, '..', '..', '..', 'swarmforge', 'scripts');
const LIB = path.join(SCRIPTS, 'daemon_cycle_guard_lib.bb');
const HARNESS = path.join(SCRIPTS, 'test', 'bl1102_spawn_failure_harness.bb');

function bb(expr) {
  return execFileSync('bb', ['-e', `(load-file "${LIB}")\n${expr}`], {
    encoding: 'utf8',
  }).trim();
}

function registerSteps(registry) {
  registry.define(/^a caller that shells a command through the daemon's bounded shell-out$/, (ctx) => {
    ctx.shellVia = 'daemon-cycle-guard-lib/sh!';
  });

  registry.define(
    /^the command is (a binary absent from every PATH entry|a path that does not exist|a path that exists but is not executable)$/,
    (ctx, kind) => {
      ctx.commandKind = kind;
      if (kind === 'a binary absent from every PATH entry') {
        ctx.cmd = ['definitely-not-on-path-bl1102-xyzzy'];
      } else if (kind === 'a path that does not exist') {
        const d = fs.mkdtempSync(path.join(os.tmpdir(), 'bl1102-miss-'));
        ctx.cmd = [path.join(d, 'no-such-file')];
        ctx.cleanup = d;
      } else {
        const d = fs.mkdtempSync(path.join(os.tmpdir(), 'bl1102-nx-'));
        const f = path.join(d, 'not-exec');
        fs.writeFileSync(f, '#!/bin/sh\necho hi\n', { mode: 0o644 });
        ctx.cmd = [f];
        ctx.cleanup = d;
      }
    }
  );

  registry.define(/^the caller shells it$/, (ctx) => {
    if (ctx.passthroughCmd) {
      ctx.resultEdn = bb(
        `(let [r (daemon-cycle-guard-lib/sh! ["bash" "-c" "echo hello; echo warn 1>&2"])] (println (pr-str {:exit (:exit r) :out (clojure.string/trim (:out r)) :err (clojure.string/trim (:err r)) :spawn-failed? (boolean (:spawn-failed? r))})))`
      );
      return;
    }
    const cmdEdn = ctx.cmd.map((c) => JSON.stringify(c)).join(' ');
    ctx.resultEdn = bb(
      `(let [r (daemon-cycle-guard-lib/sh! [${cmdEdn}])] (println (pr-str {:exit (:exit r) :spawn-failed? (boolean (:spawn-failed? r)) :out (:out r) :err (:err r)})))`
    );
  });

  registry.define(/^the caller receives a result reporting a spawn failure and nothing is thrown$/, (ctx) => {
    if (!/:spawn-failed\? true/.test(ctx.resultEdn || '')) {
      throw new Error(`expected spawn-failed? true, got: ${ctx.resultEdn}`);
    }
    if (ctx.cleanup) {
      fs.rmSync(ctx.cleanup, { recursive: true, force: true });
    }
  });

  registry.define(/^one command that cannot be spawned and one that runs and exits non-zero$/, (ctx) => {
    ctx.pair = true;
  });

  registry.define(/^the caller shells each of them$/, (ctx) => {
    ctx.spawned = bb(
      `(let [r (daemon-cycle-guard-lib/sh! "definitely-not-on-path-bl1102-xyzzy")] (println (pr-str {:exit (:exit r) :spawn-failed? (boolean (:spawn-failed? r))})))`
    );
    ctx.failed = bb(
      `(let [r (daemon-cycle-guard-lib/sh! "false")] (println (pr-str {:exit (:exit r) :spawn-failed? (boolean (:spawn-failed? r))})))`
    );
  });

  registry.define(/^the two results differ in a field the caller can branch on$/, (ctx) => {
    if (!/:spawn-failed\? true/.test(ctx.spawned || '')) {
      throw new Error(`spawn result missing marker: ${ctx.spawned}`);
    }
    if (/:spawn-failed\? true/.test(ctx.failed || '')) {
      throw new Error(`ran-failed must not set spawn-failed?: ${ctx.failed}`);
    }
    if (!/:exit 1/.test(ctx.failed || '')) {
      throw new Error(`expected exit 1 from false: ${ctx.failed}`);
    }
  });

  registry.define(/^a command that runs and writes to both stdout and stderr$/, (ctx) => {
    ctx.passthroughCmd = true;
  });

  registry.define(/^the result carries the same exit code, stdout and stderr as before$/, (ctx) => {
    const r = ctx.resultEdn || '';
    if (!/:exit 0/.test(r) || !/:out "hello"/.test(r) || !/:err "warn"/.test(r)) {
      throw new Error(`passthrough mismatch: ${r}`);
    }
    if (/:spawn-failed\? true/.test(r)) {
      throw new Error(`successful spawn must not set spawn-failed?: ${r}`);
    }
  });

  registry.define(
    /^the daemon is running and the binary its delivery tick shells is absent from PATH$/,
    (ctx) => {
      ctx.deliveryScenario = true;
    }
  );

  registry.define(/^a delivery tick runs$/, (ctx) => {
    ctx.deliveryOut = execFileSync('bb', [HARNESS], { encoding: 'utf8' });
  });

  registry.define(
    /^the tick records the spawn failure and the daemon completes a further tick$/,
    (ctx) => {
      if (!/SPAWN_FAIL/.test(ctx.deliveryOut || '')) {
        throw new Error(`expected SPAWN_FAIL marker, got: ${ctx.deliveryOut}`);
      }
      if (!/FURTHER_TICK_OK/.test(ctx.deliveryOut || '')) {
        throw new Error(`expected further tick after spawn fail, got: ${ctx.deliveryOut}`);
      }
      if (/THROWN|stopped/.test(ctx.deliveryOut || '')) {
        throw new Error(`spawn must not throw or look like stopped: ${ctx.deliveryOut}`);
      }
    }
  );
}

module.exports = { registerSteps };
