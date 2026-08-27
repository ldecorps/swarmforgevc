'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const FEATURE =
  "Bubble's Host page is a window onto the host agent working, and never a spinner";
const EXT = path.join(__dirname, '..', '..', '..', 'extension');
const TOKEN = 'bl834-token';

function loadOut() {
  return {
    startBridge: require(path.join(EXT, 'out', 'bridge', 'bridgeServer')).startBridge,
    feed: require(path.join(EXT, 'out', 'bridge', 'hostActivityFeed')),
    bubbleHostCore: require(path.join(EXT, 'out', 'bridge', 'bubbleHostCore')),
    bubbleHostUiHtml: require(path.join(EXT, 'out', 'bridge', 'bubbleHostUiHtml')),
    letsTalkRoutes: require(path.join(EXT, 'out', 'bridge', 'letsTalkRoutes')),
  };
}

function ensure(ctx) {
  if (!ctx.bl834) {
    ctx.bl834 = {
      root: fs.mkdtempSync(path.join(os.tmpdir(), 'bl834-')),
      emitted: [],
      unreachableReason: null,
      html: null,
      render: null,
      manifestBody: null,
    };
  }
  return ctx.bl834;
}

function cleanup(ctx) {
  const { feed } = loadOut();
  feed.__resetHostActivityFeedForTests();
  if (ctx.bl834?.handle) {
    ctx.bl834.handle.stop();
  }
  if (ctx.bl834?.root) {
    fs.rmSync(ctx.bl834.root, { recursive: true, force: true });
  }
  ctx.bl834 = null;
}

async function withBridge(ctx, fn) {
  const st = ensure(ctx);
  const { startBridge } = loadOut();
  const prevKey = process.env.CURSOR_API_KEY;
  process.env.CURSOR_API_KEY = 'test-key';
  let handle;
  try {
    handle = await startBridge(st.root, path.join(st.root, 'runs.jsonl'), TOKEN, {});
    st.handle = handle;
    return await fn(handle);
  } finally {
    if (handle) {
      handle.stop();
      st.handle = null;
    }
    if (prevKey === undefined) delete process.env.CURSOR_API_KEY;
    else process.env.CURSOR_API_KEY = prevKey;
  }
}

function renderHostPage(ctx) {
  const { bubbleHostCore, bubbleHostUiHtml, feed } = loadOut();
  const st = ensure(ctx);
  st.html = bubbleHostUiHtml.getBubbleHostUiHtml();
  const feedState = feed.readHostActivityFeed();
  st.render = bubbleHostCore.simulateHostPageRender(feedState, st.unreachableReason ?? undefined);
  st.feedState = feedState;
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

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

  scoped(/^a host agent turn already emitted lines before the page was opened$/, (ctx) => {
    const { feed } = loadOut();
    const st = ensure(ctx);
    feed.__resetHostActivityFeedForTests();
    feed.beginHostActivitySession('sess-buffered');
    st.emitted = ['seed-a', 'seed-b', 'seed-c'];
    for (const line of st.emitted) {
      feed.recordHostActivityLine(line);
    }
  });

  scoped(/^a host agent session is active$/, (ctx) => {
    const { feed } = loadOut();
    feed.__resetHostActivityFeedForTests();
    feed.beginHostActivitySession('sess-active');
    feed.recordHostActivityLine('working now');
    ensure(ctx).emitted = ['working now'];
  });

  scoped(/^no host agent session is active$/, (ctx) => {
    const { feed } = loadOut();
    feed.__resetHostActivityFeedForTests();
    ensure(ctx);
  });

  scoped(/^the activity feed cannot be read$/, (ctx) => {
    ensure(ctx).unreachableReason = 'bridge authentication failed — reopen from the paired Bubble pager';
  });

  scoped(/^the activity feed cannot be read and the bridge supplies a reason$/, (ctx) => {
    ensure(ctx).unreachableReason = 'bridge authentication failed — reopen from the paired Bubble pager';
  });

  scoped(/^a host agent turn has emitted a known set of progress lines$/, (ctx) => {
    const { feed } = loadOut();
    const st = ensure(ctx);
    feed.__resetHostActivityFeedForTests();
    feed.beginHostActivitySession('sess-known');
    st.emitted = ['alpha', 'beta'];
    for (const line of st.emitted) {
      feed.recordHostActivityLine(line);
    }
  });

  scoped(/^the Host page is rendered for Bubble$/, (ctx) => {
    renderHostPage(ctx);
  });

  scoped(/^the served UI bundle manifest is read$/, async (ctx) => {
    await withBridge(ctx, async (handle) => {
      const response = await fetch(`http://127.0.0.1:${handle.port}/lets-talk/ui-bundle.json`, {
        headers: { authorization: `Bearer ${TOKEN}` },
      });
      ctx.bl834.manifestStatus = response.status;
      ctx.bl834.manifestBody = await response.json();
    });
  });

  scoped(/^it shows those lines before the turn's reply is produced$/, (ctx) => {
    const st = ensure(ctx);
    assert.equal(st.render.viewState, 'working');
    assert.deepEqual(st.render.lines, st.emitted);
    cleanup(ctx);
  });

  scoped(/^it shows the lines already buffered for the session$/, (ctx) => {
    const st = ensure(ctx);
    assert.deepEqual(st.render.lines, st.emitted);
  });

  scoped(/^it attaches to the live push channel for the rest of the turn$/, (ctx) => {
    const st = ensure(ctx);
    assert.ok(loadOut().bubbleHostCore.bubbleHostShellReferencesLivePush(st.html));
    cleanup(ctx);
  });

  scoped(/^it renders the (working|quiet|unreachable) state$/, (ctx, state) => {
    const st = ensure(ctx);
    assert.equal(st.render.viewState, state);
    if (state === 'quiet') {
      assert.match(st.render.statusMessage, /quiet/i);
    }
    if (state === 'unreachable') {
      assert.match(st.render.statusMessage, /could not read the host activity feed/i);
    }
  });

  scoped(/^it does not render a perpetual loading state$/, (ctx) => {
    const st = ensure(ctx);
    if (!st.html) {
      renderHostPage(ctx);
    }
    const { bubbleHostCore } = loadOut();
    assert.equal(bubbleHostCore.bubbleHostShellHasPerpetualLoading(st.html), false);
    assert.ok(!/\bspinner\b/i.test(st.render.statusMessage));
    cleanup(ctx);
  });

  scoped(/^that reason is shown$/, (ctx) => {
    const st = ensure(ctx);
    assert.match(st.render.unreachableReason, /authentication failed/i);
  });

  scoped(/^a bare status code is not the whole message$/, (ctx) => {
    const st = ensure(ctx);
    assert.equal(
      loadOut().bubbleHostCore.hostUnreachableMessageIsBareStatusCode(st.render.unreachableReason),
      false
    );
    cleanup(ctx);
  });

  scoped(/^every line it shows is a line the feed holds$/, (ctx) => {
    const st = ensure(ctx);
    const { bubbleHostCore } = loadOut();
    assert.ok(
      bubbleHostCore.hostPageRenderedLinesAreSubsetOfFeed(st.render.lines, st.feedState.lines ?? st.emitted)
    );
    cleanup(ctx);
  });

  scoped(/^it exposes no affordance that stops, steers or interrupts the host agent$/, (ctx) => {
    const st = ensure(ctx);
    assert.equal(loadOut().bubbleHostCore.bubbleHostShellExposesSteering(st.html), false);
  });

  scoped(/^it references no bridge endpoint that mutates the host agent's session$/, (ctx) => {
    const st = ensure(ctx);
    assert.equal(
      loadOut().bubbleHostCore.bubbleHostShellReferencesHostMutationEndpoint(st.html),
      false
    );
    cleanup(ctx);
  });

  scoped(/^it names the Host page as one of its pages$/, (ctx) => {
    const { letsTalkRoutes } = loadOut();
    const pages = ctx.bl834.manifestBody.pages;
    const hostPage = pages.find((page) => page.id === letsTalkRoutes.bubbleHostPage.id);
    assert.ok(hostPage, `expected host page in manifest: ${JSON.stringify(pages)}`);
    assert.equal(hostPage.title, 'Host');
    assert.equal(hostPage.entryPath, 'host');
    cleanup(ctx);
  });
}

module.exports = { registerSteps };
