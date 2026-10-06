'use strict';

// BL-2022: step handlers for BL-094's holistic dev-state web UI feature,
// closed with no step handler - 5/5 scenarios failed "no step handler
// matched" on main. Drives the REAL compiled bridge
// (extension/out/bridge/bridgeServer.js, out/bridge/holisticUiHtml.js) over
// a real HTTP server on a disposable fixture root - never a restatement of
// the bridge's own routing, auth, or projection logic. Mirrors BL-1937's
// bl096VelocityBurndownMetricsSteps.js (same mkSocketFixtureRoot +
// copySeededRepoInto + startBridge shape, metrics-09's own bridge scenario).
//
// Per the ticket's own non-behavioral gate ("UI is presentation-only on top
// of [the projections]"), every Then here asserts against the bridge's own
// HTTP responses and the static HTML's section markers/absence of control
// actions - never a real browser, which is outside this project's
// testability boundary (extension host / webview-API line).

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const EXT_DIR = path.join(__dirname, '..', '..', '..', 'extension');
const { mkSocketFixtureRoot } = require('./lib/socketFixtureRoot');
const { copySeededRepoInto } = require(path.join(EXT_DIR, 'test', 'helpers', 'sharedRepoFixture'));

let _bridgeServer = null;
function bridgeServer() {
  if (!_bridgeServer) _bridgeServer = require(path.join(EXT_DIR, 'out', 'bridge', 'bridgeServer'));
  return _bridgeServer;
}
let _holisticUiHtml = null;
function holisticUiHtml() {
  if (!_holisticUiHtml) _holisticUiHtml = require(path.join(EXT_DIR, 'out', 'bridge', 'holisticUiHtml'));
  return _holisticUiHtml;
}

const FEATURE = 'one web page shows the holistic development state';
const TOKEN = 'bl094-holistic-token';

function mkdirp(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function writeTicket(root, folder, id, extraYaml = '') {
  mkdirp(path.join(root, 'backlog', folder));
  fs.writeFileSync(path.join(root, 'backlog', folder, `${id}.yaml`), `id: ${id}\ntitle: ${id} fixture ticket\nstatus: ${folder}\n${extraYaml}`);
}

function moveTicketToDone(root, id) {
  mkdirp(path.join(root, 'backlog', 'done'));
  fs.renameSync(path.join(root, 'backlog', 'active', `${id}.yaml`), path.join(root, 'backlog', 'done', `${id}.yaml`));
}

// A real OPEN holding window: an in_process handoff naming the ticket, with
// a dequeued_at but no completed_at - readRoleHoldingWindows' own documented
// shape (extension/src/metrics/ticketHoldingWindows.ts).
function writeHoldingWindow(root, role, ticketId) {
  const dir = path.join(root, '.swarmforge', 'handoffs', 'inbox', 'in_process');
  mkdirp(dir);
  fs.writeFileSync(
    path.join(dir, `parcel-${ticketId}.handoff`),
    `type: git_handoff\nto: ${role}\ntask: ${ticketId}\ndequeued_at: 2026-10-06T08:00:00.000Z\n`
  );
}

async function startFixtureBridge(ctx) {
  const root = mkSocketFixtureRoot('bl094-holistic-');
  copySeededRepoInto(root);
  mkdirp(path.join(root, '.swarmforge'));
  fs.writeFileSync(path.join(root, '.swarmforge', 'roles.tsv'), ['coder', 'coder-wt', root, 'swarmforge-coder', 'Coder', 'claude', 'task'].join('\t') + '\n');

  const bridge = await bridgeServer().startBridge(root, path.join(root, 'runs.jsonl'), TOKEN, { pollIntervalMs: 20 });
  ctx.bl094 = { root, bridge };
}

function fetchAuthed(ctx, urlPath, headers = {}) {
  return fetch(`http://127.0.0.1:${ctx.bl094.bridge.port}${urlPath}`, {
    headers: { authorization: `Bearer ${TOKEN}`, ...headers },
  });
}

function registerSteps(registry) {
  const scoped = (pattern, handler) => registry.defineScoped(pattern, handler, FEATURE);

  scoped(/^a running swarm and the bridge started via its opt-in command$/, async (ctx) => {
    await startFixtureBridge(ctx);
  });

  // ── holistic-ui-01 ───────────────────────────────────────────────────

  scoped(/^a browser with the bearer token opens the bridge root URL$/, async (ctx) => {
    ctx.bl094.rootResponse = await fetchAuthed(ctx, '/');
    ctx.bl094.rootBody = await ctx.bl094.rootResponse.text();
  });

  scoped(
    /^a single page renders the backlog board, per-swarm panel, pipeline flow, and recent activity sections$/,
    (ctx) => {
      assert.equal(ctx.bl094.rootResponse.status, 200);
      for (const marker of ['id="backlogBoard"', 'id="swarmPanel"', 'id="pipelineFlow"', 'id="recentActivity"']) {
        assert.ok(ctx.bl094.rootBody.includes(marker), `expected the root page to carry ${marker}, got length ${ctx.bl094.rootBody.length}`);
      }
      ctx.bl094.bridge.stop();
    }
  );

  // ── holistic-ui-02 ───────────────────────────────────────────────────

  scoped(/^active tickets exist, some carrying a swarm assignment field$/, (ctx) => {
    // BL-901 names no swarm: field at all (the "tickets without an
    // assignment" half); BL-902 carries the field explicitly, naming the
    // SAME local swarm (the "carrying a swarm assignment field" half) -
    // both are still local, but only BL-901 exercises the default
    // fallback computeAssignments/toAssignment applies.
    writeTicket(ctx.bl094.root, 'active', 'BL-901');
    writeTicket(ctx.bl094.root, 'active', 'BL-902', 'swarm: primary\n');
    writeHoldingWindow(ctx.bl094.root, 'coder', 'BL-901');
    writeHoldingWindow(ctx.bl094.root, 'coder', 'BL-902');
  });

  scoped(/^the holistic view renders$/, async (ctx) => {
    ctx.bl094.holisticResponse = await fetchAuthed(ctx, '/holistic');
    ctx.bl094.holisticBody = await ctx.bl094.holisticResponse.json();
  });

  function assignmentFor(ctx, ticketId) {
    const found = ctx.bl094.holisticBody.assignments.find((a) => a.ticketId === ticketId);
    assert.ok(found, `expected an assignment for ${ticketId}, got: ${JSON.stringify(ctx.bl094.holisticBody.assignments)}`);
    return found;
  }

  scoped(/^each active ticket shows its assigned swarm and current pipeline stage$/, (ctx) => {
    assert.equal(ctx.bl094.holisticResponse.status, 200);
    const bl902 = assignmentFor(ctx, 'BL-902');
    assert.equal(bl902.swarm, 'primary');
    assert.equal(bl902.isLocal, true);
    assert.equal(bl902.stageRole, 'coder', 'the open holding window must name the live pipeline stage');
  });

  scoped(/^tickets without an assignment display as the primary swarm's$/, (ctx) => {
    const bl901 = assignmentFor(ctx, 'BL-901');
    assert.equal(bl901.swarm, 'primary', 'no swarm: field must default to the local swarm name');
    assert.equal(bl901.isLocal, true);
    assert.equal(bl901.stageRole, 'coder');
    ctx.bl094.bridge.stop();
  });

  // ── holistic-ui-03 ───────────────────────────────────────────────────

  scoped(/^an active ticket assigned to another machine's swarm$/, (ctx) => {
    writeTicket(ctx.bl094.root, 'active', 'BL-903', 'swarm: secondary\n');
  });

  scoped(/^the holistic view renders on this machine$/, async (ctx) => {
    ctx.bl094.holisticResponse = await fetchAuthed(ctx, '/holistic');
    ctx.bl094.holisticBody = await ctx.bl094.holisticResponse.json();
  });

  scoped(/^that parcel's state reflects the latest git-synced information$/, (ctx) => {
    const bl903 = assignmentFor(ctx, 'BL-903');
    assert.equal(bl903.swarm, 'secondary', "a remote ticket's data still names the swarm the backlog YAML (git-synced) carries");
    assert.equal(bl903.isLocal, false);
  });

  scoped(/^it is visibly labeled as remote\/last-synced rather than live$/, (ctx) => {
    // The UI's remote/last-synced label is driven by isLocal/stageRole, not
    // by a separate flag: a remote ticket is never assigned a live
    // stageRole (this machine has no access to another swarm's in-flight
    // pipeline state, only the git-derived backlog position) - the
    // precondition the client-side label renders from.
    const bl903 = assignmentFor(ctx, 'BL-903');
    assert.equal(bl903.stageRole, null, 'a remote ticket must never carry a live stage - only the local swarm has that state');

    // QA bounce D1: the data assertion alone binds nothing to the label the
    // ticket text itself names - deleting the shipped remote-badge/heading
    // rendering left this scenario green. The UI is static HTML/JS
    // (getHolisticUiHtml(), same source holistic-ui-05 already reads), so
    // the rendering keyed on !isLocal/isLocal===false is asserted directly.
    const html = holisticUiHtml().getHolisticUiHtml();
    for (const marker of ["'badge remote'", "' (remote)'", "'unknown (remote)'", "' (remote, git-derived)'"]) {
      assert.ok(html.includes(marker), `expected the holistic UI to render a remote label via ${marker}`);
    }
    ctx.bl094.bridge.stop();
  });

  // ── holistic-ui-04 ───────────────────────────────────────────────────

  scoped(/^the holistic view is open in a browser$/, async (ctx) => {
    writeTicket(ctx.bl094.root, 'active', 'BL-904');
    const controller = new AbortController();
    const res = await fetchAuthed(ctx, '/events', {});
    ctx.bl094.sseController = controller;
    ctx.bl094.sseReader = res.body.getReader();
    ctx.bl094.sseDecoder = new TextDecoder();
    ctx.bl094.sseBuffer = ctx.bl094.sseDecoder.decode((await ctx.bl094.sseReader.read()).value); // connect frame
  });

  scoped(/^a parcel advances a stage or a ticket closes into done\/$/, (ctx) => {
    moveTicketToDone(ctx.bl094.root, 'BL-904');
  });

  scoped(/^the page reflects the change via the SSE stream without a reload$/, async (ctx) => {
    let sawClosedTicket = false;
    for (let attempt = 0; attempt < 20 && !sawClosedTicket; attempt += 1) {
      ctx.bl094.sseBuffer += ctx.bl094.sseDecoder.decode((await ctx.bl094.sseReader.read()).value);
      sawClosedTicket = ctx.bl094.sseBuffer.includes('"id":"BL-904"') && /"done":\[[^\]]*"BL-904"/.test(ctx.bl094.sseBuffer);
    }
    assert.ok(
      sawClosedTicket,
      `expected a later SSE frame on the SAME connection to carry BL-904 under backlog.done, got:\n${ctx.bl094.sseBuffer}`
    );
    ctx.bl094.sseController.abort();
    ctx.bl094.bridge.stop();
  });

  // ── holistic-ui-05 ───────────────────────────────────────────────────

  scoped(/^any request lacks the bearer token$/, async (ctx) => {
    ctx.bl094.unauthedResponse = await fetch(`http://127.0.0.1:${ctx.bl094.bridge.port}/holistic`);
  });

  scoped(/^it is rejected$/, (ctx) => {
    assert.equal(ctx.bl094.unauthedResponse.status, 401);
  });

  scoped(/^the UI offers no control action of any kind$/, (ctx) => {
    const html = holisticUiHtml().getHolisticUiHtml();
    for (const marker of ["method: 'POST'", 'method: "POST"', '<form', '<button']) {
      assert.ok(!html.includes(marker), `the holistic UI's own HTML must offer no control action, found ${marker}`);
    }
    ctx.bl094.bridge.stop();
  });
}

module.exports = { registerSteps };
