'use strict';

// BL-929: step handlers for "The Live Screen renders the pack that is
// actually running". Drives the REAL compiled bridge modules
// (extension/out/bridge/residentPaneLive.js and residentSpyUiHtml.js)
// directly, same posture as bl881ResidentPaneLiveCaptureTtlCacheSteps.js -
// no VS Code API, no webview. The tmux layer is doubled in-process via
// extension/test/helpers/fakeTmux.js. The HTML/JS half is exercised through
// a real jsdom render fed the snapshot via a mocked fetch - same pattern
// extension/test/residentSpyUiHtml.test.js and pausedPagerUiHtml.test.js
// already established - so "the top ticket strip is not shown" is proven
// against the actual served page, not just the TS snapshot's boolean field
// (the ticket's own notes: a passing scenario here is a stronger gate than
// a required_wiring grep). Compiled output only: run `npm run compile` in
// extension/ first.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const EXT_DIR = path.join(__dirname, '..', '..', '..', 'extension');
// jsdom lives in extension/node_modules, not this file's own node_modules
// ancestry (specs/pipeline/steps/ sits outside extension/) - same reason
// installInProcessTmux/the compiled bridge modules below are all required
// by explicit EXT_DIR path rather than bare specifier.
const { JSDOM } = require(path.join(EXT_DIR, 'node_modules', 'jsdom'));
const { installInProcessTmux } = require(path.join(EXT_DIR, 'test', 'helpers', 'fakeTmux'));
const {
  captureMonoRouterLiveScreen,
  captureLiveScreenPanes,
  clearResidentPaneLiveCache,
} = require(path.join(EXT_DIR, 'out', 'bridge', 'residentPaneLive.js'));
const { getResidentSpyUiHtml } = require(path.join(EXT_DIR, 'out', 'bridge', 'residentSpyUiHtml.js'));
const { mkSocketFixtureRoot } = require('./lib/socketFixtureRoot');

const FEATURE_NAME = 'The Live Screen renders the pack that is actually running';

const FULL_PACK_ROLES = ['coordinator', 'specifier', 'coder', 'cleaner', 'architect', 'hardender', 'documenter', 'QA'];

function seedProjectRoot() {
  return mkSocketFixtureRoot('bl929-acceptance-');
}

function writeSessions(targetPath, roles) {
  const stateDir = path.join(targetPath, '.swarmforge');
  fs.mkdirSync(stateDir, { recursive: true });
  fs.writeFileSync(path.join(stateDir, 'tmux-socket'), '/tmp/fake.sock');
  const lines = roles
    .map((role, i) => `${i + 1}\t${role}\tswarmforge-${role}\t${role === 'QA' ? 'QA' : role[0].toUpperCase() + role.slice(1)}\tclaude\n`)
    .join('');
  fs.writeFileSync(path.join(stateDir, 'sessions.tsv'), lines);
}

function writeMarker(targetPath, role) {
  fs.writeFileSync(path.join(targetPath, '.swarmforge', 'mono-router-active-role'), role);
}

// No `SwarmForge <Role>` banner in the pane text - each tile's identity
// must come from its own roster displayName, never from what the shared
// fake tmux happens to echo back for every role alike.
const NO_BANNER_PANE_TEXT = '$ some command\n> plain output, no role banner';

function installFullPackFakeTmux() {
  return installInProcessTmux([
    { subcommand: 'show-window-options', exitCode: 0, stdout: '0\n' },
    { subcommand: 'list-windows', exitCode: 0, stdout: '0\n' },
    { subcommand: 'has-session', exitCode: 0 },
    { subcommand: 'capture-pane', exitCode: 0, stdout: NO_BANNER_PANE_TEXT },
  ]);
}

// Same held-ticket fixture shape as extension/test/residentPaneLive.test.js's
// "includes held ticket metadata" case. roles.tsv/backlog/handoff entries
// are appended (not overwritten), so this can seed more than one role's
// ticket in the same target root without clobbering an earlier one.
function seedHeldTicket(targetPath, role, ticketId, title) {
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
}

function extractInlineScript(html) {
  const match = html.match(/<script>([\s\S]*?)<\/script>/);
  if (!match) {
    throw new Error('no inline <script> found in getResidentSpyUiHtml() output');
  }
  return match[1];
}

function flush() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

// Renders the REAL served HTML/JS in jsdom, fed the REAL snapshot
// captureMonoRouterLiveScreen produced (via a mocked fetch) - the same
// pipeline the Mini App and Bubble Live (same shared renderer, invariant 3)
// actually run. The served page registers several real setInterval polls
// (refresh/tickAge/claim-age ticker); a jsdom window left open after this
// function returns keeps those timers alive and the generated test file's
// own `node --test` process never exits. So this reads out everything the
// Then steps need into a plain object and closes the window (which jsdom
// documents as clearing its own timers) before returning - callers never
// hold a live dom/window past this call.
async function renderLiveScreen(snapshot) {
  const html = getResidentSpyUiHtml();
  const dom = new JSDOM(html, {
    runScripts: 'outside-only',
    url: 'https://example.github.io/resident-spy/?bearer=test-token',
    pretendToBeVisual: true,
  });
  dom.window.fetch = () =>
    Promise.resolve({ ok: true, json: () => Promise.resolve(snapshot) });
  dom.window.eval(extractInlineScript(html));
  await flush();
  const { document } = dom.window;
  const result = {
    hasResidentPaneCol: !!document.querySelector('.pane-col[data-pane-id="resident"]'),
    ticketStripHidden: document.getElementById('ticket-strip').hidden,
    documenterPaneHeadHtml: document.querySelector('.pane-col[data-pane-id="documenter"] .pane-head')?.innerHTML ?? null,
  };
  dom.window.close();
  return result;
}

function registerSteps(registry) {
  // ── Background ───────────────────────────────────────────────────────
  registry.defineScoped(
    /^an operator viewing the Live Screen for the running swarm$/,
    (ctx) => {
      ctx.targetPath = seedProjectRoot();
      clearResidentPaneLiveCache();
      delete process.env.SWARMFORGE_CONFIG;
    },
    FEATURE_NAME
  );

  // ── shared Givens ────────────────────────────────────────────────────
  registry.defineScoped(
    /^a standing full pack with eight live role sessions$/,
    (ctx) => {
      writeSessions(ctx.targetPath, FULL_PACK_ROLES);
      ctx.fake = installFullPackFakeTmux();
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^a rotating mono-router pack with a coordinator session and one resident session$/,
    (ctx) => {
      writeSessions(ctx.targetPath, ['coordinator', 'coder']);
      ctx.fake = installFullPackFakeTmux();
      // The resident normally holds the ticket it is actively working -
      // without one, #ticket-strip has nothing to show regardless of
      // layout, so "the top strip is shown" would be untestable.
      seedHeldTicket(ctx.targetPath, 'coder', 'BL-929', 'Resident ticket fixture');
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^a mono-router active-role marker naming coder$/,
    (ctx) => {
      writeMarker(ctx.targetPath, 'coder');
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^only the documenter tile holds a ticket$/,
    (ctx) => {
      seedHeldTicket(ctx.targetPath, 'documenter', 'BL-929', 'Documenter ticket fixture');
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^the Live Screen renders$/,
    async (ctx) => {
      ctx.snapshot = captureMonoRouterLiveScreen(ctx.targetPath);
      ctx.panes = captureLiveScreenPanes(ctx.targetPath);
      try {
        ctx.rendered = await renderLiveScreen(ctx.snapshot);
      } finally {
        ctx.fake?.restore();
        // BL-929 architect bounce: every Then step below reads only the
        // plain in-memory data already captured above (ctx.snapshot,
        // ctx.panes, ctx.rendered) - none of them touch ctx.targetPath
        // again, so the fixture root is safe to remove here even if
        // renderLiveScreen threw. This runner has no scenario-level
        // after-hook to hang cleanup off instead.
        fs.rmSync(ctx.targetPath, { recursive: true, force: true });
      }
    },
    FEATURE_NAME
  );

  // ── live-screen-pack-layout-01 ──────────────────────────────────────
  registry.defineScoped(
    /^no tile is labelled Resident$/,
    (ctx) => {
      if (ctx.panes.some((p) => p.id === 'resident' || p.label === 'Resident')) {
        throw new Error(`expected no tile labelled Resident, got: ${JSON.stringify(ctx.panes.map((p) => ({ id: p.id, label: p.label })))}`);
      }
      if (ctx.rendered.hasResidentPaneCol) {
        throw new Error('expected no rendered .pane-col with data-pane-id="resident"');
      }
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^the coder tile is labelled with the coder role's own display name$/,
    (ctx) => {
      const coderPane = ctx.panes.find((p) => p.id === 'coder');
      if (!coderPane || coderPane.label !== 'Coder') {
        throw new Error(`expected the coder tile labelled "Coder", got: ${JSON.stringify(coderPane)}`);
      }
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^the top ticket strip is not shown$/,
    (ctx) => {
      if (!ctx.rendered.ticketStripHidden) {
        throw new Error('expected #ticket-strip to be hidden under this layout');
      }
    },
    FEATURE_NAME
  );

  // ── live-screen-pack-layout-02 ──────────────────────────────────────
  registry.defineScoped(
    /^the specifier tile identity names the specifier role$/,
    (ctx) => {
      const specifierPane = ctx.panes.find((p) => p.id === 'specifier');
      if (!specifierPane) {
        throw new Error('expected a specifier tile in a full pack');
      }
      if (specifierPane.pane.roleLabel !== 'Specifier') {
        throw new Error(`expected the specifier tile's own identity, got roleLabel=${JSON.stringify(specifierPane.pane.roleLabel)}`);
      }
    },
    FEATURE_NAME
  );

  // ── live-screen-pack-layout-03 ───────────────────────────────────────
  registry.defineScoped(
    /^the documenter tile shows that ticket on its own tile$/,
    (ctx) => {
      const html = ctx.rendered.documenterPaneHeadHtml;
      if (!html || !/BL-929/.test(html)) {
        throw new Error(`expected the documenter tile to render its own ticket, got: ${html ?? '(no tile)'}`);
      }
    },
    FEATURE_NAME
  );

  // ── live-screen-pack-layout-04 ────────────────────────────────────────
  registry.defineScoped(
    /^the coder tile is labelled Resident$/,
    (ctx) => {
      const coderPane = ctx.panes.find((p) => p.id === 'resident');
      if (!coderPane || coderPane.label !== 'Resident') {
        throw new Error(`expected the coder tile relabelled Resident under mono-router layout, got: ${JSON.stringify(ctx.panes.map((p) => ({ id: p.id, label: p.label })))}`);
      }
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^the top ticket strip is shown$/,
    (ctx) => {
      if (ctx.rendered.ticketStripHidden) {
        throw new Error('expected #ticket-strip to be visible under a mono-router layout');
      }
    },
    FEATURE_NAME
  );
}

module.exports = { registerSteps };
