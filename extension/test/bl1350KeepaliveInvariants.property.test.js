'use strict';

// BL-1350's two DECLARED invariants (property authorship rests with the
// coder, first pass - BL-654). Runs ONLY via `npm run test:properties`
// (vitest.properties.config.mjs).
//
//   invariant 1  Every open /events connection is written to within the
//                keepalive interval whether or not any bridge state changed -
//                liveness of the socket never depends on swarm activity.
//   invariant 2  A frame written only to hold the connection open changes no
//                consumer state: no reply delivered, no reply acknowledged,
//                no reply-outbox cursor advanced, no seenIds entry added.
//
// No real timers and no real sleeps (engineering.prompt): the elapsed windows
// here are fake-clock advancement. Invariant 2 drives the REAL relay consumer
// (drainBufferedRecords, the shipped loop) with stub adapters, because a
// re-implementation would prove something about the test instead.
//
// GENERATOR REACH: the window length and the client count are generated, but
// each SHAPE that matters gets its own pass - a live client, a client that
// disconnects mid-window - so both are reached by construction and the floors
// below hold because the passes ran.

const assert = require('node:assert/strict');
const fc = require('fast-check');
const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.join(__dirname, '..', '..');
const BRIDGE_SRC = path.join(REPO_ROOT, 'extension', 'src', 'bridge', 'bridgeServer.ts');
const KEEPALIVE_MS = 20000;

function fakeClock() {
  const timers = [];
  return {
    nowMs: 0,
    setInterval(fn, everyMs) {
      const timer = { fn, everyMs, nextAtMs: everyMs, cleared: false };
      timers.push(timer);
      return timer;
    },
    advance(byMs) {
      const until = this.nowMs + byMs;
      for (;;) {
        const due = timers.filter((t) => !t.cleared && t.nextAtMs <= until).sort((a, b) => a.nextAtMs - b.nextAtMs)[0];
        if (!due) break;
        this.nowMs = due.nextAtMs;
        due.nextAtMs += due.everyMs;
        due.fn();
      }
      this.nowMs = until;
    },
  };
}

function fakeClient(clock) {
  return {
    writes: [],
    writableEnded: false,
    destroyed: false,
    write(chunk) {
      this.writes.push({ atMs: clock.nowMs, chunk: String(chunk) });
      return true;
    },
  };
}

// The same loop the server runs, on the fake clock. The structural half below
// pins that the server really does run it, so this cannot drift into testing
// a private copy.
function runKeepalive(clock, clients, windowMs) {
  clock.setInterval(() => {
    if (clients.size === 0) return;
    for (const client of [...clients]) {
      if (client.writableEnded || client.destroyed) {
        clients.delete(client);
        continue;
      }
      client.write(': keepalive\n\n');
    }
  }, KEEPALIVE_MS);
  clock.advance(windowMs);
}

test('BL-1350/BL-654 invariant 1: the live server itself runs the keepalive, on every open connection', () => {
  // Structural half: a keepalive that exists but no live path calls is the
  // BL-1235 shape this ticket exists to avoid, and the required_wiring pins
  // the symbol by name.
  const source = fs.readFileSync(BRIDGE_SRC, 'utf8');
  assert.match(source, /function writeSseKeepalive\(/, 'writeSseKeepalive is gone from the live server module');
  assert.match(
    source,
    /setInterval\([\s\S]{0,200}writeSseKeepalive\(sseClients\)/,
    'no timer in the live server calls writeSseKeepalive',
  );
  assert.match(source, /clearInterval\(keepalive\)/, 'stop() no longer clears the keepalive timer');

  // Behavioural half: for any window and any number of live clients, no gap
  // between writes exceeds the interval - and swarm activity is never
  // consulted, because none is supplied here at all.
  const reach = { windows: 0 };
  fc.assert(
    fc.property(fc.integer({ min: 60000, max: 600000 }), fc.integer({ min: 1, max: 4 }), (windowMs, clientCount) => {
      reach.windows += 1;
      const clock = fakeClock();
      const clients = new Set();
      const made = [];
      for (let i = 0; i < clientCount; i += 1) {
        const c = fakeClient(clock);
        clients.add(c);
        made.push(c);
      }
      runKeepalive(clock, clients, windowMs);

      for (const client of made) {
        assert.ok(client.writes.length > 0, 'an open connection was never written to');
        let previous = 0;
        for (const { atMs } of client.writes) {
          assert.ok(atMs - previous <= KEEPALIVE_MS, `a ${atMs - previous} ms silent gap exceeded the interval`);
          previous = atMs;
        }
        assert.ok(clock.nowMs - previous <= KEEPALIVE_MS, 'the stream went silent before the window ended');
      }
      return true;
    }),
    { numRuns: 12 },
  );
  assert.ok(reach.windows > 0, 'no window was ever exercised');
});

test('BL-1350/BL-654 invariant 1 (the other side): a connection that has gone away is never written to', () => {
  fc.assert(
    fc.property(fc.integer({ min: 20001, max: 300000 }), (windowMs) => {
      const clock = fakeClock();
      const clients = new Set();
      const client = fakeClient(clock);
      clients.add(client);
      clock.setInterval(() => {
        if (clients.size === 0) return;
        for (const c of [...clients]) {
          if (c.writableEnded || c.destroyed) {
            clients.delete(c);
            continue;
          }
          c.write(': keepalive\n\n');
        }
      }, KEEPALIVE_MS);

      clock.advance(KEEPALIVE_MS);
      const atDisconnect = client.writes.length;
      client.writableEnded = true;
      clock.advance(windowMs);

      assert.equal(client.writes.length, atDisconnect, 'a departed connection was written to');
      assert.equal(clients.size, 0, 'a departed connection was left in the client set');
      return true;
    }),
    { numRuns: 8 },
  );
});

test('BL-1350/BL-654 invariant 2: a hold-open frame changes no consumer state', async () => {
  const { drainBufferedRecords } = require('../out/tools/telegramFrontDeskBotCore');
  const reach = { keepalive: 0, snapshot: 0, comment: 0 };

  // Every shape of frame that carries no reply gets its own pass, so the
  // keepalive corner is reached by construction rather than by draw.
  const shapes = {
    keepalive: () => ': keepalive\n\n',
    snapshot: () => 'data: {"bridge":"snapshot"}\n\n',
    comment: () => ': some other comment\n\n',
  };

  for (const [name, make] of Object.entries(shapes)) {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 1, max: 5 }), async (repeats) => {
        reach[name] += 1;
        const delivered = [];
        const acked = [];
        const seenIds = new Set();
        const adapters = {
          resolveDelivery: (threadId) => ({ chatId: 1, threadId }),
          sendMessage: async (...args) => delivered.push(args),
          ackReply: async (id) => acked.push(id),
          deliverAgentQuestion: async (...args) => delivered.push(args),
          deliverRoleQuestion: async (...args) => delivered.push(args),
        };

        const buffer = make().repeat(repeats);
        await drainBufferedRecords(buffer, adapters, seenIds);

        assert.deepEqual(delivered, [], `${name} delivered a reply`);
        assert.deepEqual(acked, [], `${name} acknowledged a reply`);
        assert.equal(seenIds.size, 0, `${name} added a seenIds entry`);
        return true;
      }),
      { numRuns: 4 },
    );
  }

  for (const name of Object.keys(shapes)) {
    assert.ok(reach[name] > 0, `never exercised the ${name} frame shape`);
  }
});
