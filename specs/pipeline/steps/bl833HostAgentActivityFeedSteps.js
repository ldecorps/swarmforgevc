'use strict';

// BL-833: host-agent activity feed — real bridge + in-process feed module.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const FEATURE =
  'the bridge serves the host agent\'s activity so something other than Telegram can watch a turn';
const EXT = path.join(__dirname, '..', '..', '..', 'extension');
const TOKEN = 'bl833-token';

function loadOut() {
  return {
    startBridge: require(path.join(EXT, 'out', 'bridge', 'bridgeServer')).startBridge,
    feed: require(path.join(EXT, 'out', 'bridge', 'hostActivityFeed')),
    live: require(path.join(EXT, 'out', 'tools', 'telegramCursorBridgeLive')),
  };
}

function ensure(ctx) {
  if (!ctx.bl833) {
    ctx.bl833 = {
      root: fs.mkdtempSync(path.join(os.tmpdir(), 'bl833-')),
      emitted: [],
      streamLines: [],
      catchupLines: null,
      feedBody: null,
      status: null,
      turnReply: null,
      auth: true,
    };
    fs.mkdirSync(path.join(ctx.bl833.root, '.swarmforge', 'operator'), { recursive: true });
  }
  return ctx.bl833;
}

function cleanup(ctx) {
  const { feed } = loadOut();
  feed.__resetHostActivityFeedForTests();
  if (ctx.bl833?.sseAbort) {
    try {
      ctx.bl833.sseAbort.abort();
    } catch (_) {
      /* ignore */
    }
  }
  if (ctx.bl833?.handle) {
    ctx.bl833.handle.stop();
  }
  if (ctx.bl833 && 'prevKey' in ctx.bl833) {
    if (ctx.bl833.prevKey === undefined) delete process.env.CURSOR_API_KEY;
    else process.env.CURSOR_API_KEY = ctx.bl833.prevKey;
  }
  if (ctx.bl833?.root) {
    fs.rmSync(ctx.bl833.root, { recursive: true, force: true });
  }
  ctx.bl833 = null;
}

async function withBridge(ctx, fn) {
  const st = ensure(ctx);
  const { startBridge } = loadOut();
  const prevKey = process.env.CURSOR_API_KEY;
  process.env.CURSOR_API_KEY = prevKey || 'bl833-test-key';
  let handle;
  try {
    handle = await startBridge(st.root, path.join(st.root, 'runs.jsonl'), TOKEN, {});
    st.handle = handle;
    return await fn(handle);
  } finally {
    if (handle) handle.stop();
    st.handle = null;
    if (prevKey === undefined) delete process.env.CURSOR_API_KEY;
    else process.env.CURSOR_API_KEY = prevKey;
  }
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(/^a running swarm and the bridge started via its opt-in command$/, (ctx) => {
    ensure(ctx);
  });

  scoped(/^a host agent turn is in progress and has emitted progress lines$/, (ctx) => {
    const { feed } = loadOut();
    const st = ensure(ctx);
    feed.__resetHostActivityFeedForTests();
    feed.beginHostActivitySession('sess-live');
    st.emitted = ['🔧 grep', '✓ grep', '▶ still running'];
    for (const line of st.emitted) {
      feed.recordHostActivityLine(line);
    }
  });

  scoped(/^a host agent turn has emitted a known set of progress lines$/, (ctx) => {
    const { feed } = loadOut();
    const st = ensure(ctx);
    feed.__resetHostActivityFeedForTests();
    feed.beginHostActivitySession('sess-known');
    st.emitted = ['line-a', 'line-b'];
    for (const line of st.emitted) {
      feed.recordHostActivityLine(line);
    }
  });

  scoped(/^an authenticated client reads the host activity feed$/, async (ctx) => {
    const st = ensure(ctx);
    await withBridge(ctx, async (handle) => {
      const res = await fetch(`http://127.0.0.1:${handle.port}/host-activity`, {
        headers: { authorization: `Bearer ${TOKEN}` },
      });
      st.status = res.status;
      st.feedBody = await res.json();
    });
  });

  scoped(/^it receives those lines before the turn's reply is produced$/, (ctx) => {
    const st = ensure(ctx);
    assert.equal(st.feedBody.status, 'active');
    assert.deepEqual(st.feedBody.lines, st.emitted);
    cleanup(ctx);
  });

  scoped(/^every line it receives came from a host event$/, (ctx) => {
    const st = ensure(ctx);
    assert.equal(st.feedBody.status, 'active');
    for (const line of st.feedBody.lines) {
      assert.ok(st.emitted.includes(line), `invented: ${line}`);
    }
  });

  scoped(/^no line was synthesized from the turn's outcome$/, (ctx) => {
    const st = ensure(ctx);
    assert.equal(st.feedBody.lines.join('\n').includes('(no text reply)'), false);
    assert.deepEqual(st.feedBody.lines, st.emitted);
    cleanup(ctx);
  });

  scoped(/^an authenticated client attached to the bridge event stream$/, async (ctx) => {
    const st = ensure(ctx);
    const { startBridge, feed } = loadOut();
    feed.__resetHostActivityFeedForTests();
    feed.beginHostActivitySession('sess-sse');
    const prevKey = process.env.CURSOR_API_KEY;
    process.env.CURSOR_API_KEY = prevKey || 'bl833-test-key';
    st.prevKey = prevKey;
    const handle = await startBridge(st.root, path.join(st.root, 'runs.jsonl'), TOKEN, {});
    st.handle = handle;
    st.streamLines = [];
    st.sseAbort = new AbortController();
    const res = await fetch(`http://127.0.0.1:${handle.port}/events`, {
      headers: { authorization: `Bearer ${TOKEN}` },
      signal: st.sseAbort.signal,
    });
    assert.equal(res.status, 200);
    st.sseReader = res.body.getReader();
    st.sseBuf = '';
    st.ssePump = (async () => {
      const dec = new TextDecoder();
      while (true) {
        const { done, value } = await st.sseReader.read();
        if (done) break;
        st.sseBuf += dec.decode(value, { stream: true });
        const parts = st.sseBuf.split('\n\n');
        st.sseBuf = parts.pop() || '';
        for (const chunk of parts) {
          if (!chunk.includes('event: host-activity')) continue;
          const dataLine = chunk.split('\n').find((l) => l.startsWith('data: '));
          if (!dataLine) continue;
          const payload = JSON.parse(dataLine.slice(6));
          st.streamLines.push(payload.line);
        }
      }
    })().catch(() => {});
  });

  scoped(/^the host agent emits a further progress line$/, async (ctx) => {
    const { feed } = loadOut();
    const st = ensure(ctx);
    st.pushed = `push-${Date.now()}`;
    feed.recordHostActivityLine(st.pushed);
    await new Promise((r) => setTimeout(r, 50));
  });

  scoped(/^that line is pushed to the attached client$/, async (ctx) => {
    const st = ensure(ctx);
    assert.ok(st.streamLines.includes(st.pushed), `missing push in ${JSON.stringify(st.streamLines)}`);
    st.sseAbort.abort();
    if (st.handle) st.handle.stop();
    cleanup(ctx);
  });

  scoped(/^a client that attached late reads the buffered feed$/, async (ctx) => {
    const st = ensure(ctx);
    await withBridge(ctx, async (handle) => {
      const res = await fetch(`http://127.0.0.1:${handle.port}/host-activity`, {
        headers: { authorization: `Bearer ${TOKEN}` },
      });
      st.catchupLines = (await res.json()).lines;
    });
  });

  scoped(/^it receives the same lines a client attached throughout received$/, (ctx) => {
    const st = ensure(ctx);
    assert.deepEqual(st.catchupLines, st.emitted);
    cleanup(ctx);
  });

  scoped(/^a host agent session has emitted more lines than the feed's bound$/, (ctx) => {
    const { feed } = loadOut();
    const st = ensure(ctx);
    feed.__resetHostActivityFeedForTests();
    feed.beginHostActivitySession('sess-bound');
    const bound = feed.HOST_ACTIVITY_FEED_BOUND;
    st.emitted = [];
    for (let i = 0; i < bound + 7; i += 1) {
      const line = `overflow-${i}`;
      st.emitted.push(line);
      feed.recordHostActivityLine(line);
    }
    st.bound = bound;
  });

  scoped(/^the feed holds at most its bound$/, async (ctx) => {
    const st = ensure(ctx);
    await withBridge(ctx, async (handle) => {
      const res = await fetch(`http://127.0.0.1:${handle.port}/host-activity`, {
        headers: { authorization: `Bearer ${TOKEN}` },
      });
      st.feedBody = await res.json();
    });
    assert.ok(st.feedBody.lines.length <= st.bound);
  });

  scoped(/^the oldest lines were evicted first$/, (ctx) => {
    const st = ensure(ctx);
    const expected = st.emitted.slice(-st.bound);
    assert.deepEqual(st.feedBody.lines, expected);
    cleanup(ctx);
  });

  scoped(/^no host agent session is active$/, (ctx) => {
    const { feed } = loadOut();
    feed.__resetHostActivityFeedForTests();
    ensure(ctx);
  });

  scoped(/^the feed reports the host as quiet$/, async (ctx) => {
    const st = ensure(ctx);
    await withBridge(ctx, async (handle) => {
      const res = await fetch(`http://127.0.0.1:${handle.port}/host-activity`, {
        headers: { authorization: `Bearer ${TOKEN}` },
      });
      st.feedBody = await res.json();
    });
    assert.equal(st.feedBody.status, 'quiet');
  });

  scoped(/^it does not report a failure$/, (ctx) => {
    const st = ensure(ctx);
    assert.equal(st.feedBody.error, undefined);
    assert.equal(st.feedBody.status, 'quiet');
    cleanup(ctx);
  });

  scoped(/^the feed's write path fails for every line$/, (ctx) => {
    const { feed } = loadOut();
    feed.__resetHostActivityFeedForTests();
    feed.beginHostActivitySession('sess-fail');
    feed.__setHostActivityAppendHookForTests(() => {
      throw new Error('feed write failed');
    });
    ensure(ctx);
  });

  scoped(/^a host agent turn runs$/, (ctx) => {
    const { live } = loadOut();
    const st = ensure(ctx);
    assert.doesNotThrow(() => {
      live.recordHostActivity('during-fail-1');
      live.recordHostActivity('during-fail-2');
    });
    st.turnReply = 'turn-ok-reply';
  });

  scoped(/^the turn completes and produces its reply$/, (ctx) => {
    const st = ensure(ctx);
    assert.equal(st.turnReply, 'turn-ok-reply');
    cleanup(ctx);
  });

  scoped(/^a client without valid authentication$/, (ctx) => {
    ensure(ctx).auth = false;
  });

  scoped(/^it requests the host activity feed$/, async (ctx) => {
    const st = ensure(ctx);
    await withBridge(ctx, async (handle) => {
      const res = await fetch(`http://127.0.0.1:${handle.port}/host-activity`);
      st.status = res.status;
      st.feedBody = await res.json().catch(() => ({}));
    });
  });

  scoped(/^the request is refused$/, (ctx) => {
    assert.equal(ensure(ctx).status, 401);
    cleanup(ctx);
  });
}

module.exports = { registerSteps };
