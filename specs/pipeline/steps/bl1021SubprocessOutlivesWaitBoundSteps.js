'use strict';

// BL-1021: step handlers for "no subprocess the handoff daemon spawns can
// hang its cycle past the wait bound".
//
// Scenarios 01-03 drive the REAL handoffd.bb in a throwaway fixture root,
// reproducing the live 2026-08-21 shape end to end: the dispatch-gap sweep
// spawns `bb swarm_handoff.bb`, that child exits immediately, and a process
// it backgrounded keeps the inherited stdout/stderr write ends open, so the
// pipe never reaches EOF. Pre-fix the daemon's pump threads blocked in
// read() forever AFTER the exit code had already arrived - the bound was
// over the exit code, not over the call - and the cycle froze with no
// timeout line at all.
//
// The injection point is a fake `bb` first on PATH. handoffd.bb spawns the
// bare name `bb` (six call sites, all of them swarm_handoff.bb), so the
// shim intercepts exactly the child this ticket is about and execs the real
// bb for everything else. The daemon ITSELF is launched by absolute path so
// it never runs under its own shim.
//
// Standard daemon-wiring recipe otherwise (engineering rules): wait bound
// scaled down through the SWARMFORGE_SUBPROCESS_WAIT_BOUND_MS env seam,
// daemon stdout/stderr redirected to a file, fixture roots and spawned pids
// tracked and torn down in afterEach - never kill() as an assertion.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawn, execFileSync } = require('node:child_process');
const { afterEach } = require('node:test');
const { mkSocketFixtureRoot } = require('./lib/socketFixtureRoot');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const SCRIPTS = path.join(REPO_ROOT, 'swarmforge', 'scripts');
const HANDOFFD = path.join(SCRIPTS, 'handoffd.bb');
const SWARM_HANDOFF_BB = path.join(SCRIPTS, 'swarm_handoff.bb');

const FEATURE_NAME =
  'no subprocess the handoff daemon spawns can hang its cycle past the wait bound';

// Scaled down from the live 60s default, with headroom for legitimate child
// startup - the same reason BL-967's sibling handler runs at 5s rather than
// 500ms (a real `bb` interpreter boot passes 500ms under suite load). The
// injected pipe-holder lives 3600s, so any bound at all catches it.
const WAIT_BOUND_MS = 5000;

// The sweeps handoffd runs AFTER dispatch-gap-sweep in its heavy bundle.
// An explicit KNOWN_VALUES list, not a prefix/count check: scenario 03 is
// "the cycle continues", and that is only meaningful against named sweeps
// that must actually have run. Mirrors handoffd.bb's bundle order.
const SWEEPS_AFTER_DISPATCH_GAP = [
  'unassigned-active-nudge-sweep',
  'open-slot-nudge-sweep',
  'dropped-parcel-sweep',
  'batch-claim-progress-sweep',
  'flow-watchdog-sweep',
];

const GAP_TICKET_ID = 'BL-1021';

let trackedRoots = [];
let trackedPids = [];

afterEach(() => {
  while (trackedPids.length) {
    try {
      process.kill(trackedPids.pop(), 'SIGKILL');
    } catch (_) {
      /* already gone */
    }
  }
  while (trackedRoots.length) {
    const root = trackedRoots.pop();
    // The pipe-holder is reparented the moment its parent exits, so it is
    // NOT in any tracked process tree - it is reaped by the pid it recorded
    // for itself, or it would outlive the suite by an hour.
    reapRecordedPids(root);
    fs.rmSync(root, { recursive: true, force: true });
  }
});

function reapRecordedPids(root) {
  const pidFile = path.join(root, 'holder.pids');
  if (!fs.existsSync(pidFile)) return;
  for (const line of fs.readFileSync(pidFile, 'utf8').split('\n')) {
    const pid = Number(line.trim());
    if (!Number.isInteger(pid) || pid <= 0) continue;
    try {
      process.kill(pid, 'SIGKILL');
    } catch (_) {
      /* already gone */
    }
  }
}

function realBbPath() {
  return execFileSync('bash', ['-lc', 'command -v bb'], { encoding: 'utf8' }).trim();
}

function initRoot(ctx) {
  ctx.root = mkSocketFixtureRoot('bl1021-bound-');
  trackedRoots.push(ctx.root);

  const sf = path.join(ctx.root, '.swarmforge');
  fs.mkdirSync(path.join(sf, 'handoffs', 'inbox', 'new'), { recursive: true });
  fs.mkdirSync(path.join(sf, 'daemon'), { recursive: true });
  fs.mkdirSync(path.join(ctx.root, 'backlog', 'active'), { recursive: true });

  const sock = path.join(ctx.root, 'fake.sock');
  fs.writeFileSync(sock, '');
  fs.writeFileSync(path.join(sf, 'tmux-socket'), `${sock}\n`);
  fs.writeFileSync(
    path.join(sf, 'roles.tsv'),
    `coder\tcoder\t${ctx.root}\tswarmforge-coder\tCoder\tclaude\ttask\n`
  );

  ctx.binDir = path.join(ctx.root, 'bin');
  fs.mkdirSync(ctx.binDir);
  fs.writeFileSync(path.join(ctx.binDir, 'tmux'), '#!/usr/bin/env bash\nexit 0\n', { mode: 0o755 });

  ctx.logPath = path.join(sf, 'daemon', 'handoffd.log');
  ctx.daemonOut = path.join(ctx.root, 'daemon-out.log');
  ctx.holderPids = path.join(ctx.root, 'holder.pids');
  fs.writeFileSync(ctx.holderPids, '');
  ctx.realBb = realBbPath();
}

// An active ticket with an id and an assigned_to and NO parcel anywhere is
// exactly chase_sweep_lib's dispatch-gap predicate, so the sweep auto-routes
// it - which is what spawns the child.
function writeDispatchGapTicket(ctx) {
  fs.writeFileSync(
    path.join(ctx.root, 'backlog', 'active', `${GAP_TICKET_ID}.yaml`),
    `id: ${GAP_TICKET_ID}\ntitle: "fixture dispatch gap"\nassigned_to: coder\nstatus: todo\n`
  );
}

// The fake `bb`. On the FIRST swarm_handoff.bb spawn it reproduces the
// defect shape and exits 0; every other invocation is the real bb. The
// holder writes its own pid down so afterEach can reap it - destroy-tree
// provably cannot reach it, which is the entire point of the ticket.
function writeHangingBbShim(ctx) {
  const shim = `#!/bin/bash
for arg in "$@"; do
  case "$arg" in
    *swarm_handoff.bb)
      if [ ! -e "${ctx.root}/bb-hang-consumed" ]; then
        touch "${ctx.root}/bb-hang-consumed"
        echo "auto-route child starting"
        sleep 3600 &
        echo "$!" >> "${ctx.holderPids}"
        exit 0
      fi
      ;;
  esac
done
exec "${ctx.realBb}" "$@"
`;
  fs.writeFileSync(path.join(ctx.binDir, 'bb'), shim, { mode: 0o755 });
}

function logText(ctx) {
  return fs.existsSync(ctx.logPath) ? fs.readFileSync(ctx.logPath, 'utf8') : '';
}

function cycleEndSeen(ctx, cycle) {
  return new RegExp(`heartbeat cycle=${cycle}$`, 'm').test(logText(ctx));
}

async function runDaemonUntilCycleEnd(ctx, cycle, deadlineMs) {
  const outFd = fs.openSync(ctx.daemonOut, 'a');
  const child = spawn(ctx.realBb, [HANDOFFD, ctx.root], {
    env: {
      PATH: `${ctx.binDir}:${process.env.PATH}`,
      HOME: process.env.HOME,
      SWARMFORGE_ALLOW_TMP_DAEMON: '1',
      SWARMFORGE_SUBPROCESS_WAIT_BOUND_MS: String(WAIT_BOUND_MS),
    },
    stdio: ['ignore', outFd, outFd],
  });
  trackedPids.push(child.pid);
  ctx.daemonStartMs = Date.now();
  try {
    const deadline = Date.now() + deadlineMs;
    while (Date.now() < deadline && !cycleEndSeen(ctx, cycle)) {
      await new Promise((r) => setTimeout(r, 200));
    }
    ctx.sawCycleEnd = cycleEndSeen(ctx, cycle);
  } finally {
    fs.writeFileSync(path.join(ctx.root, '.swarmforge', 'daemon', 'stop'), '');
    const gone = Date.now() + 10000;
    while (Date.now() < gone) {
      try {
        process.kill(child.pid, 0);
        await new Promise((r) => setTimeout(r, 100));
      } catch (_) {
        break;
      }
    }
    try {
      process.kill(child.pid, 'SIGKILL');
    } catch (_) {
      /* exited cleanly */
    }
    fs.closeSync(outFd);
  }
}

function dispatchGapBoundaryMs(ctx) {
  const m = logText(ctx).match(/sweep-boundary sweep=dispatch-gap-sweep ms=(\d+)/);
  return m ? Number(m[1]) : null;
}

// Blanks ;-comments and double-quoted string CONTENTS before the banned-API
// scan, mirroring the guard lib's own closure gate: swarm_handoff.bb's
// header now explains at length WHY it no longer uses clojure.java.shell,
// and prose must never satisfy - nor trip - a gate that exists to catch
// calls.
function stripCommentsAndStrings(source) {
  let out = '';
  let inString = false;
  for (let i = 0; i < source.length; i++) {
    const c = source[i];
    if (inString) {
      if (c === '\\') { i++; continue; }
      if (c === '"') { out += c; inString = false; continue; }
      if (c === '\n') { out += c; }
      continue;
    }
    if (c === '\\') { i++; continue; }
    if (c === '"') { out += c; inString = true; continue; }
    if (c === ';') {
      while (i < source.length && source[i] !== '\n') i++;
      out += '\n';
      continue;
    }
    out += c;
  }
  return out;
}

function registerSteps(registry) {
  const scoped = (pattern, handler) => registry.defineScoped(pattern, handler, FEATURE_NAME);

  // ── Background ────────────────────────────────────────────────────────
  scoped(/^the handoff daemon runs its sweep cycle under the bounded subprocess chokepoint$/, (ctx) => {
    initRoot(ctx);
    ctx.boundMs = WAIT_BOUND_MS;
    // Generous against the bound: a bounded cycle must land far inside it.
    ctx.cycleBudgetMs = 90000;
  });

  // ── Givens ────────────────────────────────────────────────────────────
  scoped(
    /^a subprocess that exits immediately but leaves a grandchild holding its stdout and stderr$/,
    (ctx) => {
      writeDispatchGapTicket(ctx);
      writeHangingBbShim(ctx);
    }
  );

  scoped(/^a subprocess that will exceed the configured wait bound$/, (ctx) => {
    writeDispatchGapTicket(ctx);
    writeHangingBbShim(ctx);
  });

  scoped(/^the dispatch-gap sweep spawns a subprocess that never closes its streams$/, (ctx) => {
    writeDispatchGapTicket(ctx);
    writeHangingBbShim(ctx);
  });

  scoped(
    /^swarm_handoff\.bb is reachable from the handoff daemon only by a process spawn$/,
    (ctx) => {
      // The premise the closure gate cannot see, asserted rather than
      // assumed - if swarm_handoff.bb ever becomes load-file reachable from
      // handoffd.bb, BL-1022's widened gate covers it and this scenario's
      // rationale changes.
      const daemonSource = fs.readFileSync(HANDOFFD, 'utf8');
      assert.ok(
        !/\(load-file[^)]*swarm_handoff\.bb/.test(daemonSource),
        'handoffd.bb load-files swarm_handoff.bb - it is no longer spawn-only'
      );
      assert.ok(
        /\["bb" \(swarm-handoff-script\)/.test(daemonSource),
        'handoffd.bb no longer spawns swarm_handoff.bb as a subprocess'
      );
      ctx.spawnedScript = SWARM_HANDOFF_BB;
    }
  );

  // ── Whens ─────────────────────────────────────────────────────────────
  scoped(/^the daemon runs that subprocess through the chokepoint$/, async (ctx) => {
    await runDaemonUntilCycleEnd(ctx, 0, ctx.cycleBudgetMs);
    assert.ok(
      ctx.sawCycleEnd,
      `cycle 0 never completed within ${ctx.cycleBudgetMs}ms - the cycle is still wedged on the ` +
        `spawned child, which is the defect itself.\nlog:\n${logText(ctx).slice(-2000)}`
    );
  });

  scoped(/^the daemon completes that cycle$/, async (ctx) => {
    await runDaemonUntilCycleEnd(ctx, 1, ctx.cycleBudgetMs);
    assert.ok(
      ctx.sawCycleEnd,
      `cycle 1 never completed within ${ctx.cycleBudgetMs}ms.\nlog:\n${logText(ctx).slice(-2000)}`
    );
  });

  scoped(/^its source is inspected$/, (ctx) => {
    ctx.inspectedSource = stripCommentsAndStrings(fs.readFileSync(ctx.spawnedScript, 'utf8'));
  });

  // ── Thens ─────────────────────────────────────────────────────────────
  scoped(/^the call returns within the configured wait bound$/, (ctx) => {
    const ms = dispatchGapBoundaryMs(ctx);
    assert.ok(
      ms !== null,
      `dispatch-gap-sweep never emitted a boundary line.\nlog:\n${logText(ctx).slice(-2000)}`
    );
    // The sweep's whole duration is the call plus its own bookkeeping; the
    // headroom covers process spawn and destroy-tree, not a second bound.
    assert.ok(
      ms < WAIT_BOUND_MS * 2,
      `dispatch-gap-sweep took ${ms}ms against a ${WAIT_BOUND_MS}ms bound - the bound did not cover the call`
    );
  });

  scoped(/^the call reports a bounded-wait timeout rather than hanging$/, (ctx) => {
    const text = logText(ctx);
    assert.match(
      text,
      /subprocess-timeout sweep=dispatch-gap-sweep bound-ms=\d+ cmd=bb\b/,
      `no bounded-wait timeout reported for the spawned child.\nlog:\n${text.slice(-2000)}`
    );
  });

  scoped(/^a timeout event naming the sweep and the command is emitted$/, (ctx) => {
    const text = logText(ctx);
    const m = text.match(/subprocess-timeout sweep=(\S+) bound-ms=(\d+) cmd=(\S+)/);
    assert.ok(m, `no subprocess-timeout event at all - the wait ended silently.\nlog:\n${text.slice(-2000)}`);
    assert.equal(m[1], 'dispatch-gap-sweep', `timeout not attributed to the owning sweep: ${m[0]}`);
    assert.equal(Number(m[2]), WAIT_BOUND_MS, `wrong bound reported: ${m[0]}`);
    assert.equal(m[3], 'bb', `timeout does not name the spawned command: ${m[0]}`);
  });

  scoped(/^the sweep that owns the call still emits its sweep boundary$/, (ctx) => {
    const lines = logText(ctx).match(/sweep-boundary sweep=dispatch-gap-sweep ms=\d+/g) || [];
    assert.equal(
      lines.length,
      1,
      `expected exactly one dispatch-gap-sweep boundary, got ${lines.length}.\nlog:\n${logText(ctx).slice(-2000)}`
    );
  });

  scoped(/^the sweeps scheduled after the dispatch-gap sweep still run$/, (ctx) => {
    const text = logText(ctx);
    for (const sweep of SWEEPS_AFTER_DISPATCH_GAP) {
      assert.match(
        text,
        new RegExp(`sweep-boundary sweep=${sweep} ms=\\d+`),
        `${sweep} never ran after the hung child - the cycle did not survive it.\nlog:\n${text.slice(-3000)}`
      );
    }
  });

  scoped(/^the next cycle starts$/, (ctx) => {
    assert.ok(
      cycleEndSeen(ctx, 1),
      `cycle 1 never completed - the daemon did not get past the hung child.\nlog:\n${logText(ctx).slice(-2000)}`
    );
  });

  scoped(/^it contains no unbounded clojure\.java\.shell subprocess call$/, (ctx) => {
    const offenders = ctx.inspectedSource
      .split('\n')
      .map((line, i) => [i + 1, line])
      .filter(([, line]) => /clojure\.java\.shell/.test(line));
    assert.deepEqual(
      offenders,
      [],
      `swarm_handoff.bb still reaches the unbounded API BL-061 banned: ${JSON.stringify(offenders)}`
    );
  });
}

module.exports = { registerSteps };
