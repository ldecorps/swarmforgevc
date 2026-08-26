'use strict';

// BL-833: property — feed never invents lines; bound holds; quiet is quiet.

const assert = require('node:assert/strict');
const {
  HOST_ACTIVITY_FEED_BOUND,
  beginHostActivitySession,
  endHostActivitySession,
  recordHostActivityLine,
  readHostActivityFeed,
  __resetHostActivityFeedForTests,
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

const rnd = mulberry32(833);
let failures = 0;

function fail(msg) {
  failures += 1;
  console.error(`FAIL: ${msg}`);
}

for (let trial = 0; trial < 40; trial += 1) {
  __resetHostActivityFeedForTests();
  const emitted = [];
  beginHostActivitySession(`s-${trial}`);
  const n = 1 + Math.floor(rnd() * (HOST_ACTIVITY_FEED_BOUND + 20));
  for (let i = 0; i < n; i += 1) {
    const line = `L${trial}-${i}-${Math.floor(rnd() * 1000)}`;
    emitted.push(line);
    recordHostActivityLine(line);
  }
  const feed = readHostActivityFeed();
  if (feed.status !== 'active') {
    fail(`trial ${trial}: expected active`);
    continue;
  }
  const expected = emitted.slice(-HOST_ACTIVITY_FEED_BOUND);
  if (feed.lines.length > HOST_ACTIVITY_FEED_BOUND) {
    fail(`trial ${trial}: bound exceeded (${feed.lines.length})`);
  }
  if (JSON.stringify(feed.lines) !== JSON.stringify(expected)) {
    fail(`trial ${trial}: lines drifted from emitted suffix`);
  }
  for (const line of feed.lines) {
    if (!emitted.includes(line)) {
      fail(`trial ${trial}: invented line ${line}`);
    }
  }
  endHostActivitySession();
  if (readHostActivityFeed().status !== 'quiet') {
    fail(`trial ${trial}: not quiet after end`);
  }
}

if (failures > 0) {
  console.error(`hostActivityFeed.property: ${failures} FAILURE(S)`);
  process.exit(1);
}
console.log('hostActivityFeed.property: ALL PROPERTIES HOLD');
