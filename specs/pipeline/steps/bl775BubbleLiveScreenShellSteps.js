'use strict';

// BL-775: step handlers for "Bubble's Live page shows the coordinator and
// resident panes without a second renderer"
// (specs/features/BL-775-bubble-live-screen-shell.feature).
//
// Drives the REAL compiled bridge modules directly - fake tmux in-process
// for pane capture (extension/test/helpers/fakeTmux.js), and the REAL
// served page rendered under jsdom, fed the REAL captured snapshot via a
// mocked fetch. Same posture as bl929LiveScreenPackLayoutSteps.js and
// bl609ResidentSpyFontSizeControlSteps.js. Compiled output only: run
// `npm run compile` in extension/ first.

const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

const EXT_DIR = path.join(__dirname, '..', '..', '..', 'extension');
// BL-1658: the path only - the actual require(JSDOM_MODULE) happens inside
// each function that builds a DOM (bl1046/bl1160/bl1153's own pattern), so
// a mere require() of this file never pays for loading jsdom.
const JSDOM_MODULE = path.join(EXT_DIR, 'node_modules', 'jsdom');
const { installInProcessTmux } = require(path.join(EXT_DIR, 'test', 'helpers', 'fakeTmux'));
const {
  captureMonoRouterLiveScreen,
  captureLiveScreenPanes,
  clearResidentPaneLiveCache,
} = require(path.join(EXT_DIR, 'out', 'bridge', 'residentPaneLive.js'));
const { getResidentSpyUiHtml } = require(path.join(EXT_DIR, 'out', 'bridge', 'residentSpyUiHtml.js'));
const { getBubbleLiveUiHtml } = require(path.join(EXT_DIR, 'out', 'bridge', 'bubbleLiveUiHtml.js'));
const { getLetsTalkUiBundleManifest } = require(path.join(EXT_DIR, 'out', 'bridge', 'letsTalkUiBundle.js'));
const { mergeBubbleLiveIntoUiBundleManifest } = require(path.join(EXT_DIR, 'out', 'bridge', 'letsTalkRoutes.js'));

const FEATURE_NAME = "Bubble's Live page shows the coordinator and resident panes without a second renderer";

// The bridge's own swarm-mutating write routes (bridgeServer.ts's
// `writeRoutes` array) - invariant 2 forbids the page from referencing any
// of these. Preference PUT routes (font size, ticket-strip-collapsed) are
// deliberately excluded: they mutate a per-surface UI preference, not
// swarm state.
const MUTATING_SWARM_PATHS = [
  '/gate-answer',
  '/telegram-inbound',
  '/reply-ack',
  '/paused-pager/expedite',
  '/paused-pager/approve',
  '/catch-up/mark-read',
  '/epic-reorder/move',
  '/epic-reorder/make-top',
  '/epic-reorder/topic-make-top',
];

function writeSessions(targetPath, roles) {
  const stateDir = path.join(targetPath, '.swarmforge');
  fs.mkdirSync(stateDir, { recursive: true });
  fs.writeFileSync(path.join(stateDir, 'tmux-socket'), '/tmp/fake.sock');
  const lines = roles
    .map((role, i) => `${i + 1}\t${role}\tswarmforge-${role}\t${role === 'coordinator' ? 'Coordinator' : 'Coder'}\tclaude\n`)
    .join('');
  fs.writeFileSync(path.join(stateDir, 'sessions.tsv'), lines);
}

// Same held-ticket fixture shape as extension/test/residentPaneLive.test.js
// and bl929LiveScreenPackLayoutSteps.js.
function seedHeldTicket(targetPath, role, ticketId, title, model) {
  const worktree = path.join(targetPath, `${role}-wt`);
  const stateDir = path.join(targetPath, '.swarmforge');
  fs.mkdirSync(path.join(worktree, '.swarmforge', 'handoffs', 'inbox', 'in_process'), { recursive: true });
  fs.mkdirSync(path.join(targetPath, 'backlog', 'active'), { recursive: true });
  fs.appendFileSync(
    path.join(stateDir, 'roles.tsv'),
    `${role}\t${role}-wt\t${worktree}\tswarmforge-${role}\t${role[0].toUpperCase() + role.slice(1)}\tclaude\n`
  );
  fs.writeFileSync(
    path.join(worktree, '.swarmforge', 'handoffs', 'inbox', 'in_process', '00_test.handoff'),
    `task: ${ticketId}-fixture-ticket\ndequeued_at: 2026-08-18T00:00:00Z\n\nbody\n`
  );
  fs.writeFileSync(
    path.join(targetPath, 'backlog', 'active', `${ticketId}-fixture-ticket.yaml`),
    `id: ${ticketId}\ntitle: "${title}"\n`
  );
  if (model) {
    const launchDir = path.join(stateDir, 'launch');
    fs.mkdirSync(launchDir, { recursive: true });
    fs.writeFileSync(path.join(launchDir, `${role}.claude-settings.json`), JSON.stringify({ model }));
  }
}

function installFullPackFakeTmux(rules) {
  return installInProcessTmux(
    rules || [
      { subcommand: 'show-window-options', exitCode: 0, stdout: '0\n' },
      { subcommand: 'list-windows', exitCode: 0, stdout: '0\n' },
      { subcommand: 'has-session', exitCode: 0 },
      { subcommand: 'capture-pane', exitCode: 0, stdout: '$ some command\n> plain output, no role banner' },
    ]
  );
}

function extractInlineScript(html) {
  const match = html.match(/<script>([\s\S]*?)<\/script>/);
  if (!match) {
    throw new Error('no inline <script> found in the served page');
  }
  return match[1];
}

function flush() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

// Render-read-close discipline matching bl929LiveScreenPackLayoutSteps.js -
// a jsdom window left open keeps the page's real setInterval polls alive
// and hangs the acceptance runner's own process.
async function renderBubbleLive(snapshot) {
  const { JSDOM } = require(JSDOM_MODULE);
  const html = getBubbleLiveUiHtml();
  const dom = new JSDOM(html, {
    runScripts: 'outside-only',
    url: 'https://example.github.io/live/?bearer=test-token',
    pretendToBeVisual: true,
  });
  try {
    dom.window.fetch = () => Promise.resolve({ ok: true, json: () => Promise.resolve(snapshot) });
    dom.window.eval(extractInlineScript(html));
    await flush();
    const { document } = dom.window;
    const paneTexts = {};
    for (const col of document.querySelectorAll('.pane-col')) {
      const id = col.getAttribute('data-pane-id');
      const pre = col.querySelector('pre');
      paneTexts[id] = pre ? pre.textContent : null;
    }
    return {
      html,
      paneColIds: Array.from(document.querySelectorAll('.pane-col')).map((el) => el.getAttribute('data-pane-id')),
      ticketStripHidden: document.getElementById('ticket-strip').hidden,
      ticketStripId: document.getElementById('ticket-strip-id').textContent,
      ticketStripTitle: document.getElementById('ticket-strip-title').textContent,
      ticketStripMeta: document.getElementById('ticket-strip-meta').textContent,
      offlineHidden: document.getElementById('pane-offline').hidden,
      offlineText: document.getElementById('pane-offline').textContent,
      paneTexts,
    };
  } finally {
    dom.window.close();
  }
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE_NAME);

  // ── Givens ──────────────────────────────────────────────────────────
  scoped(/^the swarm has a coordinator pane and a resident pane$/, (ctx) => {
    clearResidentPaneLiveCache();
    delete process.env.SWARMFORGE_CONFIG;
    writeSessions(ctx.targetPath, ['coordinator', 'coder']);
    ctx.fake = installFullPackFakeTmux();
  });

  scoped(/^the resident holds a claimed ticket$/, (ctx) => {
    clearResidentPaneLiveCache();
    delete process.env.SWARMFORGE_CONFIG;
    writeSessions(ctx.targetPath, ['coordinator', 'coder']);
    ctx.fake = installFullPackFakeTmux();
    seedHeldTicket(ctx.targetPath, 'coder', 'BL-775', 'Live page ticket fixture', 'claude-sonnet-5');
  });

  scoped(/^a pane capture fails with a reason the bridge can report$/, (ctx) => {
    clearResidentPaneLiveCache();
    delete process.env.SWARMFORGE_CONFIG;
    writeSessions(ctx.targetPath, ['coordinator', 'coder']);
    ctx.fake = installFullPackFakeTmux([
      { subcommand: 'show-window-options', exitCode: 0, stdout: '0\n' },
      { subcommand: 'list-windows', exitCode: 0, stdout: '0\n' },
      { subcommand: 'has-session', exitCode: 0 },
      { subcommand: 'capture-pane', exitCode: 1, stderr: "can't find pane: swarmforge-coder:0" },
    ]);
  });

  scoped(/^no swarm pane is currently live$/, (ctx) => {
    clearResidentPaneLiveCache();
    delete process.env.SWARMFORGE_CONFIG;
    // ctx.targetPath (from the Background) has no sessions.tsv/tmux-socket
    // at all - a genuinely idle target, no fake tmux to install.
  });

  // ── Whens ───────────────────────────────────────────────────────────
  scoped(/^the Live page is rendered for Bubble$/, async (ctx) => {
    const snapshot = captureMonoRouterLiveScreen(ctx.targetPath);
    ctx.panes = captureLiveScreenPanes(ctx.targetPath);
    try {
      ctx.rendered = await renderBubbleLive(snapshot);
    } finally {
      ctx.fake?.restore();
    }
  });

  scoped(/^the Live Screen is rendered for the Mini App route$/, (ctx) => {
    ctx.miniAppHtml = getResidentSpyUiHtml();
  });

  scoped(/^the served UI bundle manifest is read$/, (ctx) => {
    ctx.manifest = mergeBubbleLiveIntoUiBundleManifest(getLetsTalkUiBundleManifest(ctx.targetPath, process.env));
  });

  // ── Thens ───────────────────────────────────────────────────────────
  scoped(/^it presents the coordinator and the resident in the canonical role order$/, (ctx) => {
    const capturedOrder = ctx.panes.map((p) => p.id);
    assert.deepEqual(capturedOrder, ['coordinator', 'resident'], `expected coordinator-then-resident order, got: ${capturedOrder}`);
    assert.deepEqual(ctx.rendered.paneColIds, capturedOrder, 'the rendered DOM order must match the captured pane order');
  });

  scoped(/^both are produced by the same Live Screen renderer$/, (ctx) => {
    assert.equal(ctx.rendered.html, ctx.miniAppHtml);
  });

  scoped(/^no second copy of the Live Screen markup exists to drift from it$/, () => {
    const bubbleLiveSource = fs.readFileSync(path.join(EXT_DIR, 'src', 'bridge', 'bubbleLiveUiHtml.ts'), 'utf8');
    assert.doesNotMatch(
      bubbleLiveSource,
      /<!DOCTYPE html>/i,
      'the Bubble page module must not carry its own copy of the Live Screen document'
    );
  });

  scoped(/^the strip shows (.+) for that pane$/, (ctx, field) => {
    assert.equal(ctx.rendered.ticketStripHidden, false, 'expected the ticket strip to be visible');
    if (field === 'the ticket id') {
      assert.equal(ctx.rendered.ticketStripId, 'BL-775');
    } else if (field === 'the ticket title') {
      assert.equal(ctx.rendered.ticketStripTitle, 'Live page ticket fixture');
    } else if (field === 'the role label') {
      assert.match(ctx.rendered.ticketStripMeta, /Coder/);
    } else if (field === 'the model label') {
      assert.match(ctx.rendered.ticketStripMeta, /Sonnet/);
    } else if (field === 'the claim-entered age') {
      assert.match(ctx.rendered.ticketStripMeta, /entered .* ago/);
    } else {
      throw new Error(`unrecognized field: ${field}`);
    }
  });

  scoped(/^that reason is shown for the pane$/, (ctx) => {
    const failedPaneText = ctx.rendered.paneTexts.resident;
    assert.ok(failedPaneText, 'expected a rendered pane for the failed role');
    assert.match(failedPaneText, /can't find pane/);
    ctx.bl775FailureReasonText = failedPaneText;
  });

  scoped(/^a bare status code is not the whole message$/, (ctx) => {
    assert.doesNotMatch(ctx.bl775FailureReasonText, /^\d+$/, 'a bare numeric status code is not an acceptable reason');
  });

  scoped(/^the page states that the swarm is idle$/, (ctx) => {
    assert.equal(ctx.rendered.offlineHidden, false, 'expected the idle banner to be visible');
    assert.match(ctx.rendered.offlineText, /idle/i);
  });

  scoped(/^it does not present a perpetual loading state$/, (ctx) => {
    assert.doesNotMatch(ctx.rendered.html, /loading/i);
  });

  scoped(/^it exposes no control affordance$/, (ctx) => {
    for (const p of MUTATING_SWARM_PATHS) {
      assert.doesNotMatch(ctx.rendered.html, new RegExp(p.replace(/[/-]/g, '\\$&')));
    }
  });

  scoped(/^it references no bridge endpoint that mutates swarm state$/, (ctx) => {
    for (const p of MUTATING_SWARM_PATHS) {
      assert.doesNotMatch(ctx.rendered.html, new RegExp(p.replace(/[/-]/g, '\\$&')));
    }
  });

  scoped(/^it names the Live page as one of its pages$/, (ctx) => {
    assert.ok(
      ctx.manifest.pages.some((p) => p.id === 'live'),
      `expected a 'live' page in the manifest, got: ${JSON.stringify(ctx.manifest.pages)}`
    );
  });
}

module.exports = { registerSteps };
