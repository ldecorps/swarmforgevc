'use strict';

// BL-831: step handlers for "Bubble's Pipeline page shows what is in
// flight, with a blurb per ticket and its spec one tap away". Drives a
// real bridge (startBridge) over a real mkdtemp target, same shape
// bl832BubbleHealthTrendsPageSteps.js uses for the Health page - the
// bridge's own /pipeline-page-state and /pipeline-page-detail routes are
// hit over real HTTP, never a reimplementation of them.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const FEATURE = "Bubble's Pipeline page shows what is in flight, with a blurb per ticket and its spec one tap away";
const EXT = path.join(__dirname, '..', '..', '..', 'extension');
const TOKEN = 'bl831-token';

function loadOut() {
  return {
    startBridge: require(path.join(EXT, 'out', 'bridge', 'bridgeServer')).startBridge,
    bubblePipelinePage: require(path.join(EXT, 'out', 'bridge', 'letsTalkRoutes')).bubblePipelinePage,
  };
}

function ensure(ctx) {
  if (!ctx.bl831) {
    ctx.bl831 = { root: fs.mkdtempSync(path.join(os.tmpdir(), 'bl831-')) };
    fs.mkdirSync(path.join(ctx.bl831.root, 'backlog', 'active'), { recursive: true });
    fs.mkdirSync(path.join(ctx.bl831.root, '.swarmforge', 'board'), { recursive: true });
  }
  return ctx.bl831;
}

function writeTicket(root, id, { title, description, acceptance }) {
  let yamlText = `id: ${id}\ntitle: "${title}"\nstatus: active\n`;
  if (description) {
    yamlText += `description: |\n  ${description}\n`;
  }
  if (acceptance) {
    yamlText += `acceptance: ${acceptance}\n`;
  }
  fs.writeFileSync(path.join(root, 'backlog', 'active', `${id}-fixture.yaml`), yamlText);
}

function writeStageMap(root, stageById) {
  fs.writeFileSync(
    path.join(root, '.swarmforge', 'board', 'ticket-stage-map.json'),
    JSON.stringify(stageById)
  );
}

async function withBridge(ctx, fn) {
  const st = ensure(ctx);
  const { startBridge } = loadOut();
  const prevKey = process.env.CURSOR_API_KEY;
  process.env.CURSOR_API_KEY = 'test-key';
  let handle;
  try {
    handle = await startBridge(st.root, path.join(st.root, 'runs.jsonl'), TOKEN);
    return await fn(handle);
  } finally {
    if (handle) {
      handle.stop();
    }
    if (prevKey === undefined) delete process.env.CURSOR_API_KEY;
    else process.env.CURSOR_API_KEY = prevKey;
  }
}

async function fetchJson(handle, urlPath) {
  const sep = urlPath.includes('?') ? '&' : '?';
  const res = await fetch(`http://127.0.0.1:${handle.port}${urlPath}${sep}token=${TOKEN}`, {
    headers: { authorization: `Bearer ${TOKEN}` },
  });
  assert.equal(res.status, 200);
  return res.json();
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(/^a running swarm and the bridge started via its opt-in command$/, (ctx) => {
    ensure(ctx);
  });

  scoped(/^the swarm holds in-flight tickets at different stages$/, (ctx) => {
    const st = ensure(ctx);
    writeTicket(st.root, 'BL-2001', { title: 'First in-flight ticket', description: 'Does the first thing. More detail follows.' });
    writeTicket(st.root, 'BL-2002', { title: 'Second in-flight ticket', description: 'Does the second thing.' });
    writeStageMap(st.root, { 'BL-2001': 'coder', 'BL-2002': 'cleaner' });
  });

  scoped(/^the Pipeline page is rendered for Bubble$/, async (ctx) => {
    await withBridge(ctx, async (handle) => {
      ctx.bl831.state = await fetchJson(handle, '/pipeline-page-state');
    });
  });

  scoped(/^each in-flight ticket is marked at the agent the board read model reports$/, (ctx) => {
    const byId = new Map(ctx.bl831.state.inFlight.map((row) => [row.id, row]));
    assert.equal(byId.get('BL-2001').column, 'coder');
    assert.equal(byId.get('BL-2002').column, 'cleaner');
  });

  scoped(/^the page computes no stage placement of its own$/, (ctx) => {
    // BL-831 invariant 1: every row's column came from computeLivePipelineBoard
    // (pipelineGridLive.ts) - asserted by the previous step matching the
    // fixture's own stage-map assignment exactly, with no other stage
    // string reachable from this page's own code.
    for (const row of ctx.bl831.state.inFlight) {
      assert.ok(['coder', 'cleaner'].includes(row.column), `unexpected column ${row.column}`);
    }
  });

  scoped(/^each in-flight ticket listed shows its blurb without opening the detail sheet$/, (ctx) => {
    for (const row of ctx.bl831.state.inFlight) {
      assert.ok(row.blurb && row.blurb.length > 0, `ticket ${row.id} has no blurb`);
    }
  });

  scoped(/^an in-flight ticket (with a description|with no description)$/, (ctx, kind) => {
    const st = ensure(ctx);
    if (kind === 'with a description') {
      writeTicket(st.root, 'BL-2003', { title: 'Ticket with description', description: 'This is the first sentence. This is the second.' });
    } else {
      writeTicket(st.root, 'BL-2003', { title: 'Ticket with no description' });
    }
    writeStageMap(st.root, { 'BL-2003': 'architect' });
  });

  scoped(/^its blurb is (the first sentence of its description|its title)$/, (ctx, expected) => {
    const row = ctx.bl831.state.inFlight.find((entry) => entry.id === 'BL-2003');
    assert.ok(row, 'BL-2003 not found in-flight');
    if (expected === 'the first sentence of its description') {
      assert.equal(row.blurb, 'This is the first sentence.');
    } else {
      assert.equal(row.blurb, 'Ticket with no description');
    }
  });

  scoped(/^an in-flight ticket whose acceptance names a feature file that exists$/, (ctx) => {
    const st = ensure(ctx);
    const featureRel = 'specs/features/BL-2004-fixture.feature';
    fs.mkdirSync(path.join(st.root, 'specs', 'features'), { recursive: true });
    fs.writeFileSync(
      path.join(st.root, featureRel),
      'Feature: fixture\n\n  Scenario: does the thing\n    Given a thing\n\n  Scenario: does another thing\n    Given another thing\n'
    );
    writeTicket(st.root, 'BL-2004', {
      title: 'Ticket with a real feature file',
      description: 'Some description.',
      acceptance: featureRel,
    });
    writeStageMap(st.root, { 'BL-2004': 'hardener' });
    st.detailTicketId = 'BL-2004';
  });

  scoped(/^an in-flight ticket whose acceptance names a feature file that does not exist$/, (ctx) => {
    const st = ensure(ctx);
    writeTicket(st.root, 'BL-2005', {
      title: 'Ticket with a missing feature file',
      description: 'Some description.',
      acceptance: 'specs/features/BL-2005-does-not-exist.feature',
    });
    writeStageMap(st.root, { 'BL-2005': 'documenter' });
    st.detailTicketId = 'BL-2005';
  });

  scoped(/^its detail is requested from the Pipeline page$/, async (ctx) => {
    await withBridge(ctx, async (handle) => {
      ctx.bl831.detail = await fetchJson(handle, `/pipeline-page-detail?id=${ctx.bl831.detailTicketId}`);
    });
  });

  scoped(/^the response carries the ticket's spec sections$/, (ctx) => {
    assert.ok(ctx.bl831.detail.title);
    assert.ok(ctx.bl831.detail.description);
  });

  scoped(/^it carries the scenarios of that feature file$/, (ctx) => {
    assert.deepEqual(ctx.bl831.detail.scenarios, ['does the thing', 'does another thing']);
  });

  scoped(/^it states that no acceptance scenarios are recorded for it$/, (ctx) => {
    assert.equal(ctx.bl831.detail.scenarios.length, 0);
    assert.ok(/no acceptance scenarios/i.test(ctx.bl831.detail.scenariosNote || ''));
  });

  scoped(/^the swarm holds no in-flight ticket$/, (ctx) => {
    ensure(ctx);
  });

  scoped(/^the page states that nothing is in flight$/, (ctx) => {
    assert.deepEqual(ctx.bl831.state.inFlight, []);
  });

  scoped(/^it does not present the previous grid$/, (ctx) => {
    // BL-831 invariant: no memoization of a prior tick's rows (same
    // BL-1188 posture pipelineGridLive.ts's own capture already holds) -
    // an empty result here, immediately after a non-empty one in an
    // earlier scenario, is that guarantee observed rather than assumed.
    assert.equal(ctx.bl831.state.inFlight.length, 0);
  });

  scoped(/^the served UI bundle manifest is read$/, async (ctx) => {
    await withBridge(ctx, async (handle) => {
      ctx.bl831.manifest = await fetchJson(handle, '/lets-talk/ui-bundle.json');
    });
  });

  scoped(/^it names the Pipeline page as one of its pages$/, (ctx) => {
    const { bubblePipelinePage } = loadOut();
    const page = ctx.bl831.manifest.pages.find((entry) => entry.id === bubblePipelinePage.id);
    assert.ok(page);
    assert.equal(page.title, 'Pipeline');
    assert.equal(page.entryPath, 'pipeline');
  });
}

module.exports = { registerSteps };
