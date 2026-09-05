'use strict';

// BL-833: property — feed never invents lines; bound holds; quiet is quiet.
//
// BL-1434: registered with vitest. This file used to be a bare node script
// (no test()/it()/describe(), a process.exit(1) on failure) - the
// properties config collected it, found no suite, and reported it red
// without ever running these forty trials under the suite at all.

const assert = require('node:assert/strict');
const {
  HOST_ACTIVITY_FEED_BOUND,
  beginHostActivitySession,
  endHostActivitySession,
  recordHostActivityLine,
  readHostActivityFeed,
  __resetHostActivityFeedForTests,
  __setHostActivityAppendHookForTests,
} = require('../out/bridge/hostActivityFeed');

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// BL-1434 acceptance scenario 03 ("the converted property still fails when
// the feed invents a line"): gated behind an explicit env var so the
// ordinary run (scenario 02, "passes alone") is never affected by it. The
// injected hook appends the real recorded line PLUS one that was never
// recorded, through the same __setHostActivityAppendHookForTests seam the
// module already exposes for exactly this class of test - never a second,
// hand-rolled feed module. __resetHostActivityFeedForTests() clears any
// hook, so it is (re-)installed after every reset, inside the loop below.
function installInjectedHookIfRequested() {
  if (process.env.BL1434_INJECT_INVENTED_LINE === '1') {
    __setHostActivityAppendHookForTests((_sessionId, line, lines) => {
      lines.push(line);
      lines.push(`INVENTED-${line}`);
      if (lines.length > HOST_ACTIVITY_FEED_BOUND) {
        lines.splice(0, lines.length - HOST_ACTIVITY_FEED_BOUND);
      }
    });
  }
}

test('hostActivityFeed property: the feed never invents a line, the bound holds, a quiet session reads quiet (40 trials)', () => {
  const rnd = mulberry32(833);
  for (let trial = 0; trial < 40; trial += 1) {
    __resetHostActivityFeedForTests();
    installInjectedHookIfRequested();
    const emitted = [];
    beginHostActivitySession(`s-${trial}`);
    const n = 1 + Math.floor(rnd() * (HOST_ACTIVITY_FEED_BOUND + 20));
    for (let i = 0; i < n; i += 1) {
      const line = `L${trial}-${i}-${Math.floor(rnd() * 1000)}`;
      emitted.push(line);
      recordHostActivityLine(line);
    }
    const feed = readHostActivityFeed();
    assert.equal(feed.status, 'active', `trial ${trial}: expected active`);
    assert.ok(feed.lines.length <= HOST_ACTIVITY_FEED_BOUND, `trial ${trial}: bound exceeded (${feed.lines.length})`);
    for (const line of feed.lines) {
      assert.ok(emitted.includes(line), `trial ${trial}: invented line ${line}`);
    }
    if (process.env.BL1434_INJECT_INVENTED_LINE !== '1') {
      const expected = emitted.slice(-HOST_ACTIVITY_FEED_BOUND);
      assert.deepEqual(feed.lines, expected, `trial ${trial}: lines drifted from emitted suffix`);
    }
    endHostActivitySession();
    assert.equal(readHostActivityFeed().status, 'quiet', `trial ${trial}: not quiet after end`);
  }
});
