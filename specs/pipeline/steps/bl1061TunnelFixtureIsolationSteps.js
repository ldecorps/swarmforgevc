'use strict';

// BL-1061: step handlers for "a tunnel-ownership fixture never binds a name
// the host is already serving".
//
// The Background says "a live process this run did not start, serving tunnel
// name swarmforge-bubble". That process is the operator's REAL tunnel, and
// these scenarios must never put it in range of anything. So the pre-existing
// process is modelled as a LINE in a candidate table fed to the lib's pure
// decision seam (tunnel_decide_orphans, which never calls pgrep or kill),
// while the run's OWN fixtures are real processes under a per-run unique name
// that no other process can be serving.
//
// That split is the ticket's own point restated as test design: proving "the
// reap cannot reach the real tunnel" by pointing a real reap at the real
// tunnel would be committing the fault under test.
//
// Invariant (BL-968): module load is requires and pure constants only.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync, execFileSync } = require('node:child_process');
const { afterEach } = require('node:test');

const FEATURE = 'BL-1061 a tunnel-ownership fixture never binds a name the host is already serving';

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const LIB = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'tunnel_ownership_lib.sh');
const EXT_TEST = path.join(REPO_ROOT, 'extension', 'test');
const {
  PRODUCTION_TUNNEL_NAMES,
  fixtureTunnelName,
  isProductionTunnelName,
  assertFixtureTunnelName,
  leakedFixtureTunnelPids,
} = require(path.join(EXT_TEST, 'helpers', 'fixtureTunnelName'));

const PRODUCTION_NAME = 'swarmforge-bubble';
// The pre-existing process, as `ps -o pid=,args=` prints it. A LINE, never a
// spawned process: this scenario is about a tunnel the run did not start, and
// the only such tunnel on a real host is the operator's own.
const PREEXISTING_PID = 316866;
const PREEXISTING_LINE =
  `${PREEXISTING_PID} /home/operator/.local/bin/cloudflared tunnel ` +
  `--config /home/operator/.cloudflared/config.yml --no-autoupdate run ${PRODUCTION_NAME}`;

// Explicit known values per the Scenario Outline handler rule.
const KNOWN_TARGETS = new Set(['own fixture', 'pre-existing']);

let trackedPids = [];
let trackedDirs = [];
afterEach(() => {
  while (trackedPids.length) {
    try { process.kill(trackedPids.pop(), 'SIGKILL'); } catch { /* already gone */ }
  }
  while (trackedDirs.length) {
    fs.rmSync(trackedDirs.pop(), { recursive: true, force: true });
  }
});

// A harmless stand-in with a real cloudflared-shaped command line, under a
// temp path so the leaked-fixture sweep can find it by path and never by name.
function spawnFixtureTunnel(name) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bl1061-accept-'));
  trackedDirs.push(dir);
  const bin = path.join(dir, 'cloudflared');
  fs.writeFileSync(bin, '#!/usr/bin/env bash\nsleep 120\n');
  fs.chmodSync(bin, 0o755);
  const res = spawnSync('bash', [
    '-c', '"$1" tunnel --config "$2/c.yml" --no-autoupdate run "$3" >/dev/null 2>&1 & echo $!',
    '_', bin, dir, name,
  ], { encoding: 'utf8' });
  const pid = Number((res.stdout || '').trim());
  trackedPids.push(pid);
  return pid;
}

function isAlive(pid) {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

function decideOrphans(name, lines) {
  const res = spawnSync('bash', [LIB, 'decide-orphans', name], {
    input: `${lines.join('\n')}\n`, encoding: 'utf8',
  });
  assert.equal(res.status, 0, `decide-orphans failed: ${res.stderr}`);
  return (res.stdout || '').split('\n').map((l) => l.trim()).filter(Boolean).map(Number);
}

function fixtureLine(pid, name) {
  return `${pid} bash ${os.tmpdir()}/bl1061-x-${pid}/cloudflared tunnel --config /x/c.yml --no-autoupdate run ${name}`;
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(/^a live process this run did not start, serving tunnel name "(.+)"$/, (ctx, name) => {
    assert.equal(name, PRODUCTION_NAME, `this feature is written about ${PRODUCTION_NAME}`);
    assert.ok(isProductionTunnelName(name),
      `${name} must be on the production refusal list, or the whole feature is about nothing`);
    ctx.preexisting = { pid: PREEXISTING_PID, line: PREEXISTING_LINE, name };
  });

  scoped(/^a fixture process leaked by an earlier run is still alive$/, (ctx) => {
    // A real process, because scenario 03 is about a real sweep. It is under
    // a temp path, so the sweep finds it the way it finds any leaked fixture.
    ctx.leakedPid = spawnFixtureTunnel(fixtureTunnelName('leaked-earlier-run'));
    assert.ok(isAlive(ctx.leakedPid), 'the leaked-fixture stand-in did not start');
  });

  scoped(/^the fixture is forced to bind "(.+)"$/, (ctx, name) => {
    ctx.forcedName = name;
  });

  scoped(/^the ownership fixture chooses its tunnel name$/, (ctx) => {
    ctx.chosen = fixtureTunnelName('acceptance');
    ctx.alsoChosen = fixtureTunnelName('acceptance');
  });

  scoped(/^the run reaps orphans for the (.+) tunnel name$/, (ctx, target) => {
    assert.ok(KNOWN_TARGETS.has(target),
      `unknown target "${target}" - the handlers know ${[...KNOWN_TARGETS].join(', ')}`);
    ctx.target = target;
    ctx.ownName = assertFixtureTunnelName(fixtureTunnelName('own'));
    ctx.ownPid = spawnFixtureTunnel(ctx.ownName);
    // The candidate table any reap would see: this run's own fixture plus the
    // pre-existing process the run did not start.
    const table = [fixtureLine(ctx.ownPid, ctx.ownName), ctx.preexisting.line];

    if (target === 'own fixture') {
      ctx.selected = decideOrphans(ctx.ownName, table);
    } else {
      // "The run reaps orphans for the PRE-EXISTING tunnel name" is a thing
      // the run must not be able to do, and that is the invariant rather than
      // a technicality: a reap is scoped to a name, the run only ever obtains
      // names through the guard, and the guard refuses this one. Scoping a
      // reap here to the pre-existing name directly would BE the fault - it
      // is what the old fixture did, and it is how the operator's tunnel
      // became reachable from a test.
      assert.throws(() => assertFixtureTunnelName(ctx.preexisting.name),
        /may not bind the production tunnel name/,
        'the run was able to obtain the pre-existing name, so it could scope a reap at it');
      // So the reap it actually performs stays scoped to its own name, and
      // the pre-existing process is not in its selection.
      ctx.selected = decideOrphans(ctx.ownName, table);
    }
    ctx.createdByThisRun = new Set([ctx.ownPid]);
  });

  scoped(/^the ownership suite runs$/, (ctx) => {
    try {
      assertFixtureTunnelName(ctx.forcedName);
      ctx.error = null;
    } catch (e) {
      ctx.error = e;
    }
  });

  scoped(/^the ownership suite reaches its first assertion about the process table$/, (ctx) => {
    // The sweep the suite performs before reading the table.
    const swept = [];
    for (const pid of leakedFixtureTunnelPids(execFileSync)) {
      try { process.kill(pid, 'SIGKILL'); swept.push(pid); } catch { /* gone */ }
    }
    ctx.swept = swept;
  });

  scoped(/^the chosen name is unique to this run$/, (ctx) => {
    assert.notEqual(ctx.chosen, ctx.alsoChosen, 'two calls returned the same name');
    assert.match(ctx.chosen, new RegExp(`-${process.pid}-`),
      'the name does not carry this process id, so it is not unique to this run');
  });

  scoped(/^no process outside this run is serving the chosen name$/, (ctx) => {
    assert.equal(isProductionTunnelName(ctx.chosen), false);
    const res = spawnSync('pgrep', ['-f', '--', `run ${ctx.chosen}`], { encoding: 'utf8' });
    const pids = (res.stdout || '').split('\n').map((l) => l.trim()).filter(Boolean);
    assert.deepEqual(pids, [], `the host is already serving the chosen name ${ctx.chosen}: ${pids.join(', ')}`);
  });

  scoped(/^every signalled pid was created by this run$/, (ctx) => {
    for (const pid of ctx.selected) {
      assert.ok(ctx.createdByThisRun.has(pid),
        `a reap for the ${ctx.target} name selected pid ${pid}, which this run did not create`);
    }
    // Either way the selection is the run's own fixture and nothing else:
    // for the 'own fixture' target because that is what it reaped for, and
    // for 'pre-existing' because the run could not scope a reap there at all.
    assert.deepEqual(ctx.selected, [ctx.ownPid],
      `a reap during the ${ctx.target} case selected ${JSON.stringify(ctx.selected)}`);
  });

  scoped(/^the pre-existing process is still alive$/, (ctx) => {
    assert.ok(!ctx.selected.includes(ctx.preexisting.pid),
      `the reap selected the pre-existing pid ${ctx.preexisting.pid} - it would have been signalled`);
  });

  scoped(/^the leaked fixture is no longer alive$/, (ctx) => {
    assert.ok(ctx.swept.includes(ctx.leakedPid),
      `the sweep did not select the leaked fixture pid ${ctx.leakedPid}`);
    assert.equal(isAlive(ctx.leakedPid), false, 'the leaked fixture survived the sweep');
  });

  scoped(/^the suite fails and its message names "(.+)"$/, (ctx, name) => {
    assert.ok(ctx.error, `binding ${name} was accepted - the isolation guard is vacuous`);
    assert.match(ctx.error.message, new RegExp(name),
      `the refusal does not name the offending tunnel: ${ctx.error.message}`);
    assert.ok(PRODUCTION_TUNNEL_NAMES.includes(name),
      `${name} must be on the refusal list for this scenario to mean anything`);
  });
}

module.exports = { registerSteps };
