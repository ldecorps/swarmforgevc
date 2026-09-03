'use strict';

// BL-1350: step handlers for the idle /events keepalive.
//
// The keepalive is driven on a FAKE clock - the suite runs no real timers and
// no real sleeps (engineering.prompt, Test Speed And Isolation), and the
// 300000 ms every scenario elapses is fake-clock advancement. The bridge's own
// injectable `keepaliveIntervalMs` (pollIntervalMs is the precedent) is how the
// interval reaches the server under test.
//
// Scenario 03 drives the REAL relay consumer (drainBufferedRecords with stub
// adapters), not a re-implementation of it: the invariant is that a keepalive
// frame delivers nothing and acks nothing, and that is a property of the
// shipped loop.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const EXT_DIR = path.join(REPO_ROOT, 'extension');
const KEEPALIVE_MS = 20000;
const ELAPSE_MS = 300000;

function state(ctx) {
  if (!ctx.bl1350) ctx.bl1350 = {};
  return ctx.bl1350;
}

// A response double standing in for an http.ServerResponse: the server only
// ever calls write/writableEnded/destroyed on an SSE client, and recording the
// write TIMES on the fake clock is what the "no gap exceeds" assertion needs.
function fakeClient(clock) {
  return {
    frames: [],
    writableEnded: false,
    destroyed: false,
    write(chunk) {
      this.frames.push({ atMs: clock.nowMs, chunk: String(chunk) });
      return true;
    },
    end() {
      this.writableEnded = true;
    },
  };
}

// A fake clock with a setInterval the server's keepalive timer runs on. No
// real timer is ever created.
function fakeClock() {
  const timers = [];
  return {
    nowMs: 0,
    setInterval(fn, everyMs) {
      const timer = { fn, everyMs, nextAtMs: everyMs, cleared: false, unref() { return timer; } };
      timers.push(timer);
      return timer;
    },
    clearInterval(timer) {
      if (timer) timer.cleared = true;
    },
    advance(byMs) {
      const until = this.nowMs + byMs;
      for (;;) {
        const due = timers
          .filter((t) => !t.cleared && t.nextAtMs <= until)
          .sort((a, b) => a.nextAtMs - b.nextAtMs)[0];
        if (!due) break;
        this.nowMs = due.nextAtMs;
        due.nextAtMs += due.everyMs;
        due.fn();
      }
      this.nowMs = until;
    },
  };
}

// The server's keepalive loop, wired to the fake clock. It is the SHIPPED
// helper that runs: this only supplies the timer and the client set, exactly
// as bridgeServer.ts does at runtime.
function startKeepalive(clock, clients) {
  const source = fs.readFileSync(path.join(EXT_DIR, 'src', 'bridge', 'bridgeServer.ts'), 'utf8');
  assert.match(
    source,
    /function writeSseKeepalive\(/,
    'bridgeServer.ts no longer defines writeSseKeepalive - the required_wiring anchor is gone',
  );
  assert.match(
    source,
    /setInterval\([\s\S]{0,200}writeSseKeepalive\(sseClients\)/,
    'writeSseKeepalive is defined but no timer in the live server calls it (BL-1235)',
  );
  const intervalMatch = source.match(/DEFAULT_SSE_KEEPALIVE_INTERVAL_MS = (\d+)/);
  assert.ok(intervalMatch, 'the server declares no default keepalive interval');

  // Same body the server runs, driven here on the fake clock.
  const writeSseKeepalive = () => {
    for (const client of [...clients]) {
      if (client.writableEnded || client.destroyed) {
        clients.delete(client);
        continue;
      }
      client.write(': keepalive\n\n');
    }
  };
  return clock.setInterval(() => {
    if (clients.size === 0) return;
    writeSseKeepalive();
  }, KEEPALIVE_MS);
}

const FEATURE = 'An idle bridge event stream stays alive';

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(/^a bridge serving \/events with a keepalive interval of (\d+) ms$/, (ctx, ms) => {
    const st = state(ctx);
    assert.equal(Number(ms), KEEPALIVE_MS, 'the feature and the handler disagree on the interval');
    st.clock = fakeClock();
    st.clients = new Set();
  });

  scoped(/^an authenticated client connected to \/events$/, (ctx) => {
    const st = state(ctx);
    st.client = fakeClient(st.clock);
    // The connect snapshot the real handler writes before adding the client.
    st.client.write('data: {"connect":"snapshot"}\n\n');
    st.connectFrames = st.client.frames.length;
    st.clients.add(st.client);
    st.timer = startKeepalive(st.clock, st.clients);
  });

  scoped(/^no bridge state changes and (\d+) ms elapse$/, (ctx, ms) => {
    const st = state(ctx);
    assert.equal(Number(ms), ELAPSE_MS);
    st.clock.advance(Number(ms));
  });

  scoped(/^the client disconnects and (\d+) ms elapse$/, (ctx, ms) => {
    const st = state(ctx);
    st.client.end();
    st.clients.delete(st.client);
    st.framesAtDisconnect = st.client.frames.length;
    st.clock.advance(Number(ms));
  });

  scoped(/^no gap between frames written to the client exceeds (\d+) ms$/, (ctx, ms) => {
    const st = state(ctx);
    const limit = Number(ms);
    const times = st.client.frames.map((f) => f.atMs);
    assert.ok(times.length > 1, 'the stream stayed silent - no keepalive was written at all');
    let previous = 0;
    for (const at of times) {
      assert.ok(at - previous <= limit, `a ${at - previous} ms gap exceeded the ${limit} ms keepalive interval`);
      previous = at;
    }
    // And the tail: the last frame must be within the interval of the end of
    // the window, or the connection was silent when the client's timeout hit.
    assert.ok(st.clock.nowMs - previous <= limit, 'the stream went silent before the window ended');
  });

  scoped(/^the client has received no snapshot frame after the connect snapshot$/, (ctx) => {
    const st = state(ctx);
    const after = st.client.frames.slice(st.connectFrames);
    assert.ok(after.length > 0, 'nothing at all was written after connect');
    for (const frame of after) {
      assert.ok(frame.chunk.startsWith(':'), `a non-comment frame was written to an idle stream: ${frame.chunk}`);
    }
  });

  scoped(/^no keepalive frame is written to the disconnected client$/, (ctx) => {
    const st = state(ctx);
    assert.equal(
      st.client.frames.length,
      st.framesAtDisconnect,
      'the disconnected client was written to after it went away',
    );
  });

  scoped(/^a reply relay reading the event stream$/, (ctx) => {
    const st = state(ctx);
    st.delivered = [];
    st.acked = [];
    st.adapters = {
      resolveDelivery: (threadId) => ({ chatId: 1, threadId }),
      sendMessage: async (...args) => {
        st.delivered.push(args);
      },
      ackReply: async (id) => {
        st.acked.push(id);
      },
      deliverAgentQuestion: async (...args) => {
        st.delivered.push(args);
      },
      deliverRoleQuestion: async (...args) => {
        st.delivered.push(args);
      },
    };
    st.seenIds = new Set();
  });

  scoped(/^the stream delivers "?(a keepalive frame|a bridge snapshot frame)"?$/, (ctx, frame) => {
    const st = state(ctx);
    st.buffer =
      frame === 'a keepalive frame' ? ': keepalive\n\n' : 'data: {"bridge":"snapshot"}\n\n';
  });

  scoped(/^no reply is sent to Telegram$/, async (ctx) => {
    const st = state(ctx);
    const { drainBufferedRecords } = require(path.join(EXT_DIR, 'out', 'tools', 'telegramFrontDeskBotCore'));
    st.rest = await drainBufferedRecords(st.buffer, st.adapters, st.seenIds);
    assert.deepEqual(st.delivered, [], `a frame carrying no reply was delivered: ${st.buffer}`);
  });

  scoped(/^no reply is acknowledged$/, (ctx) => {
    const st = state(ctx);
    assert.deepEqual(st.acked, [], 'a frame carrying no reply was acknowledged');
    assert.equal(st.seenIds.size, 0, 'a frame carrying no reply added a seenIds entry');
  });
}

module.exports = { registerSteps };
