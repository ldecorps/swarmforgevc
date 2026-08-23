'use strict';

// BL-1063 property test (coder-authored, two DECLARED invariants).
//
//   Invariant 1: "Every assertion about a backgrounded child's side effect
//   waits for that side effect under a bounded deadline, and returns as soon
//   as it appears; no assertion reads a path the child may not have written
//   yet."
//
//   Invariant 2: "An assertion tests the invariant it names, not one host's
//   way of satisfying it: where a lib documents a fallback, the test accepts
//   every branch the lib may legitimately take, and never asserts a branch the
//   lib is required NOT to take."
//
// Invariant 1 is quantified over the two things that actually vary in the
// wild - HOW LATE the child writes, and HOW LONG the deadline is - with a
// fake clock, so the properties cover appearance times no real run would ever
// hit while costing no wall-clock at all. Its three clauses need three
// properties, because each is satisfiable while another is violated:
//
//   P1  bounded        - never waits past the deadline, at any lateness
//   P2  returns early  - a child that writes at T is seen at ~T, not at the
//                        deadline. This is what rules out a fixed sleep, which
//                        satisfies P1 perfectly.
//   P3  never partial  - a file that exists but is half-written is not
//                        accepted. Waiting on existence alone swaps the race
//                        for a subtler one, and satisfies P1 and P2.
//
// P4 is the armed-ness backstop and is not optional: P1, P2 and P3 are ALL
// satisfied by a wait that returns "not ready" immediately and forever, which
// is a wait that does not wait. It has to actually succeed when the child does
// write.
//
// Invariant 2 is a claim about what the ASSERTION demands, so P5 quantifies
// over the host shapes the assertion must be indifferent to: whether the
// caller's PATH resolves node. Both must satisfy invariant 1 and neither may
// require the fallback branch. The old assertion failed exactly this - it
// demanded the nvm tree on every host, which on a host with a system node is
// the branch operator_path_lib.sh is REQUIRED not to take.
//
// Non-vacuity PROVEN at authoring time (2026-08-23), each break restored:
//   - let the wait overshoot its deadline 3x ............. P1, P3
//   - sleep the whole deadline before the first check .... P2
//   - accept mere existence, ignoring the ready predicate  P3
//   - always report not-ready ............................ P2, P4
//   - restore the old "must come from the nvm tree" assert  P5
//
// Removing the deadline check ENTIRELY was tried first and is worth recording
// as a non-result: it does not fail the properties, it HANGS them, because the
// poll clamp then goes negative and the fake clock runs backwards. A hang is
// not a caught property - a lane that hangs reports a bare framework timeout
// naming nothing - so the break was reshaped into a finite overshoot, which is
// the same defect in a form the property can actually name.

const assert = require('node:assert/strict');
const fc = require('fast-check');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { mkTmpDir } = require('./helpers/tmpDir');
const { waitForFileSync, describeWaitTimeout } = require('./helpers/waitForFileSync');

const REPO_ROOT = path.join(__dirname, '..', '..');
const LIB = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'operator_path_lib.sh');

// A fake clock and a fake sleep: the child's lateness is simulated exactly,
// so a "the child wrote after 9 seconds" case costs nothing.
function fakeTime() {
  const state = { clock: 0, sleeps: [] };
  return {
    state,
    now: () => state.clock,
    sleep: (ms) => {
      state.sleeps.push(ms);
      state.clock += ms;
    },
  };
}

// A marker that appears once the fake clock passes `appearsAtMs`, and is
// half-written for `partialForMs` after that - the real shape, since the child
// writes through a shell redirect and the file exists before its contents do.
function scheduledMarker(dir, { appearsAtMs, partialForMs = 0 }, clock) {
  const file = path.join(dir, 'marker.log');
  return {
    file,
    tick() {
      const t = clock.now();
      if (t < appearsAtMs) return;
      const complete = t >= appearsAtMs + partialForMs;
      fs.writeFileSync(file, complete ? '/bin/bb\n/bin/node\n' : '/bin/bb\n');
    },
  };
}

// waitForFileSync with the marker's own scheduler driven by the same fake
// clock, so lateness is honoured rather than approximated.
//
// The tick runs when the clock ADVANCES - at the end of each sleep - and once
// before the first read. That ordering matters: waitForFileSync reads the file
// first and asks the time second, so a scheduler that wrote inside now() would
// always be one iteration behind, and every measurement here would be inflated
// by up to two polls. That is a defect in this scaffold, not in the helper, and
// it is worth naming because it made P2 fail against a correct implementation.
function waitWithSchedule(marker, clock, options) {
  marker.tick();
  return waitForFileSync(marker.file, {
    ...options,
    now: clock.now,
    sleep: (ms) => {
      clock.sleep(ms);
      marker.tick();
    },
  });
}

const READY = (text) => text.trim().split('\n').filter(Boolean).length === 2;

const scheduleArb = fc.record({
  appearsAtMs: fc.integer({ min: 0, max: 12000 }),
  partialForMs: fc.integer({ min: 0, max: 300 }),
  timeoutMs: fc.integer({ min: 200, max: 10000 }),
  pollMs: fc.constantFrom(10, 25, 50, 100),
});

test('P1 (invariant 1): the wait never runs past its declared deadline, however late the child', () => {
  fc.assert(
    fc.property(scheduleArb, ({ appearsAtMs, partialForMs, timeoutMs, pollMs }) => {
      const dir = mkTmpDir('bl1063-p1-');
      const clock = fakeTime();
      const marker = scheduledMarker(dir, { appearsAtMs, partialForMs }, clock);
      const result = waitWithSchedule(marker, clock, { timeoutMs, pollMs, ready: READY });
      assert.ok(
        result.waitedMs <= timeoutMs,
        `waited ${result.waitedMs}ms against a ${timeoutMs}ms deadline (child at ${appearsAtMs}ms)`
      );
    }),
    { numRuns: 200 }
  );
});

test('P2 (invariant 1): a child that writes within the deadline is seen at once, not at the deadline', () => {
  fc.assert(
    fc.property(scheduleArb, ({ appearsAtMs, partialForMs, timeoutMs, pollMs }) => {
      const readyAt = appearsAtMs + partialForMs;
      // Only meaningful when the child is genuinely in time.
      fc.pre(readyAt + pollMs < timeoutMs);
      const dir = mkTmpDir('bl1063-p2-');
      const clock = fakeTime();
      const marker = scheduledMarker(dir, { appearsAtMs, partialForMs }, clock);
      const result = waitWithSchedule(marker, clock, { timeoutMs, pollMs, ready: READY });
      assert.equal(result.ok, true, `the child wrote at ${readyAt}ms, inside a ${timeoutMs}ms deadline`);
      // Within one poll of when it became ready - a fixed sleep, or any wait
      // that ran to the deadline, blows this immediately.
      assert.ok(
        result.waitedMs <= readyAt + pollMs,
        `expected to return by ${readyAt + pollMs}ms, returned at ${result.waitedMs}ms (deadline ${timeoutMs}ms)`
      );
    }),
    { numRuns: 200 }
  );
});

test('P3 (invariant 1): a marker that exists but is incomplete is never accepted as ready', () => {
  fc.assert(
    fc.property(
      fc.integer({ min: 0, max: 2000 }),
      fc.integer({ min: 50, max: 2000 }),
      (appearsAtMs, partialForMs) => {
        const dir = mkTmpDir('bl1063-p3-');
        const clock = fakeTime();
        const marker = scheduledMarker(dir, { appearsAtMs, partialForMs }, clock);
        // A deadline that lands while the file exists but is still partial.
        const timeoutMs = appearsAtMs + Math.max(1, Math.floor(partialForMs / 2));
        const result = waitWithSchedule(marker, clock, { timeoutMs, pollMs: 10, ready: READY });
        assert.equal(
          result.ok,
          false,
          `a half-written marker must not be accepted (existed from ${appearsAtMs}ms, complete at ${appearsAtMs + partialForMs}ms, deadline ${timeoutMs}ms)`
        );
        // ...and the caller can tell it apart from "never appeared at all".
        if (result.contents !== null) {
          assert.ok(!READY(result.contents), 'an incomplete read must not satisfy the ready predicate');
        }
      }
    ),
    { numRuns: 200 }
  );
});

test('P4 (armed-ness): the wait actually succeeds when the child writes in time', () => {
  // Without this, "always not ready" satisfies P1, P2 (vacuously) and P3.
  fc.assert(
    fc.property(fc.integer({ min: 0, max: 500 }), (appearsAtMs) => {
      const dir = mkTmpDir('bl1063-p4-');
      const clock = fakeTime();
      const marker = scheduledMarker(dir, { appearsAtMs, partialForMs: 0 }, clock);
      const result = waitWithSchedule(marker, clock, { timeoutMs: 5000, pollMs: 25, ready: READY });
      assert.equal(result.ok, true, `a child writing at ${appearsAtMs}ms must be seen`);
      assert.ok(READY(result.contents), 'and its complete contents returned');
    }),
    { numRuns: 60 }
  );
});

test('P4 (armed-ness): the timeout message names the marker and the deadline', () => {
  // A bounded wait that failed anonymously would leave the reader sweeping.
  const message = describeWaitTimeout('/tmp/some/marker.log', 1234, 'label');
  assert.ok(message.includes('/tmp/some/marker.log'));
  assert.ok(message.includes('1234'));
});

// ── Invariant 2 ──────────────────────────────────────────────────────────
// Real: the actual operator_path_lib.sh, under both host shapes.

let nodelessCache = null;
function nodelessPath() {
  if (nodelessCache) return nodelessCache;
  const dir = mkTmpDir('bl1063-nodeless-');
  const seen = new Set();
  for (const src of ['/usr/bin', '/bin']) {
    let entries = [];
    try {
      entries = fs.readdirSync(src);
    } catch {
      continue;
    }
    for (const name of entries) {
      if (name === 'node' || name === 'nodejs' || seen.has(name)) continue;
      seen.add(name);
      try {
        fs.symlinkSync(path.join(src, name), path.join(dir, name));
      } catch {
        /* duplicate or unreadable */
      }
    }
  }
  nodelessCache = dir;
  return dir;
}

// BL-1063 (architect bounce D1): the mirror farm. P5 used to write
// `/usr/bin:/bin` for the "caller resolves" row and assert its premise, which
// caught a host without a system node but did not PREVENT it - the property
// still failed there, binding the opposite host fact into the very test that
// exists to stop that. The caller's node is now a stub we place.
let callerNodeCache = null;
function callerNodePath() {
  if (callerNodeCache) return callerNodeCache;
  const dir = mkTmpDir('bl1063-callernode-');
  const stub = path.join(dir, 'node');
  fs.writeFileSync(stub, '#!/bin/sh\nexit 0\n');
  fs.chmodSync(stub, 0o755);
  callerNodeCache = { callerPath: `${dir}:${nodelessPath()}`, stub };
  return callerNodeCache;
}

function fakeNvmHome() {
  const home = mkTmpDir('bl1063-home-');
  for (const v of ['v9.11.2', 'v22.1.0']) {
    const binDir = path.join(home, '.nvm', 'versions', 'node', v, 'bin');
    fs.mkdirSync(binDir, { recursive: true });
    fs.writeFileSync(path.join(binDir, 'node'), '#!/bin/sh\nexit 0\n');
    fs.chmodSync(path.join(binDir, 'node'), 0o755);
  }
  return home;
}

test('P5 (invariant 2): node resolves under every host shape, and the fallback is never demanded', () => {
  fc.assert(
    fc.property(fc.boolean(), (callerResolvesNode) => {
      const home = fakeNvmHome();
      const nvmTree = path.join(home, '.nvm', 'versions', 'node');
      const caller = callerResolvesNode ? callerNodePath() : null;
      const callerPath = caller ? caller.callerPath : nodelessPath();

      // Both rows are now CONSTRUCTED rather than assumed, so this is a
      // self-check on the farms rather than a premise that could fail on
      // someone else's machine.
      const probe = spawnSync('sh', ['-c', 'command -v node'], { encoding: 'utf8', env: { PATH: callerPath } });
      assert.equal(
        probe.status === 0,
        callerResolvesNode,
        `the ${callerResolvesNode ? 'caller-resolves' : 'node-less'} farm is not built correctly`
      );

      const result = spawnSync('sh', ['-c', `. "${LIB}"; swarmforge_prepend_operator_bins; command -v node`], {
        encoding: 'utf8',
        timeout: 10000,
        env: { PATH: callerPath, HOME: home },
      });
      assert.equal(result.status, 0, `node must resolve after prepending (callerResolvesNode=${callerResolvesNode})`);
      const resolved = result.stdout.trim();

      // The invariant as NAMED: node resolves. Not where from.
      assert.ok(fs.existsSync(resolved), `node must resolve to a real path, got: ${resolved}`);

      if (callerResolvesNode) {
        // The branch the lib is REQUIRED not to take. Demanding it here is
        // precisely the defect this ticket removes.
        assert.ok(
          !resolved.startsWith(nvmTree),
          `the nvm fallback must never shadow a node the caller already resolves, got: ${resolved}`
        );
        assert.equal(resolved, caller.stub, "the caller's own node must be what survives");
        // Made permanent (architect bounce D1): the caller's node is this
        // test's own stub, never one the host happens to carry.
        assert.ok(
          !resolved.startsWith('/usr/'),
          `the caller's node must be constructed, not found on the host: ${resolved}`
        );
      } else {
        // And the fallback is genuinely reachable - otherwise "we no longer
        // assert it" would just mean the branch is dead.
        assert.ok(
          resolved.startsWith(nvmTree),
          `with node unresolvable on the caller PATH, the fallback must supply it, got: ${resolved}`
        );
      }
    }),
    { numRuns: 12 }
  );
});
