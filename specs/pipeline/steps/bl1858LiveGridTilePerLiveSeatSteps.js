'use strict';

// BL-1858: step handlers for "Bubble's live grid shows a tile for every live
// seat". Drives the REAL compiled bridge modules (captureLiveScreenPanes,
// captureMonoRouterLiveScreen, getResidentSpyUiHtml) the way
// bl929LiveScreenPackLayoutSteps.js does: tmux doubled in-process by
// extension/test/helpers/fakeTmux.js, the served page rendered in jsdom fed
// the real snapshot through a mocked fetch. Compiled output only: run
// `npm run compile` in extension/ first.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const EXT_DIR = path.join(__dirname, '..', '..', '..', 'extension');
const JSDOM_MODULE = path.join(EXT_DIR, 'node_modules', 'jsdom');
const { installInProcessTmux } = require(path.join(EXT_DIR, 'test', 'helpers', 'fakeTmux'));
const {
  captureLiveScreenPanes,
  captureMonoRouterLiveScreen,
  clearResidentPaneLiveCache,
} = require(path.join(EXT_DIR, 'out', 'bridge', 'residentPaneLive.js'));
const { getResidentSpyUiHtml } = require(path.join(EXT_DIR, 'out', 'bridge', 'residentSpyUiHtml.js'));
const { mkSocketFixtureRoot } = require('./lib/socketFixtureRoot');

const FEATURE = "Bubble's live grid shows a tile for every live seat";

// roles.tsv order and display names, as the Background lists them.
const ROSTER = [
  ['specifier', 'Specifier'],
  ['coder', 'Coder'],
  ['coder@2', 'Coder@2'],
  ['cleaner', 'Cleaner'],
  ['architect', 'Architect'],
  ['hardender', 'Hardender'],
  ['documenter', 'Documenter'],
  ['QA', 'QA'],
  ['art-director', 'Art Director'],
  ['coordinator', 'Coordinator'],
];
const KNOWN_SEATS = new Set([...ROSTER.map(([seat]) => seat), 'coder@iq3']);
const KNOWN_LABELS = new Map(ROSTER);
const KNOWN_MODELS = new Map([
  ['qwen2.5-coder-14b-q5km:latest', 'Qwen2.5 Coder 14B'],
  ['qwen3-coder:30b', 'Qwen3 Coder 30B'],
]);

function knownSeat(seat) {
  assert.ok(KNOWN_SEATS.has(seat), `unrecognized seat: ${seat}`);
  return seat;
}

function seatDir(root, seat) {
  return path.join(root, 'wt', seat.replace('@', '-at-'));
}

function writeFixture(root, sessionsSeats) {
  const stateDir = path.join(root, '.swarmforge');
  fs.mkdirSync(path.join(stateDir, 'launch'), { recursive: true });
  fs.writeFileSync(path.join(stateDir, 'tmux-socket'), '/tmp/fake.sock');
  const rolesLines = ROSTER.map(([seat, label]) => {
    fs.mkdirSync(path.join(seatDir(root, seat), '.swarmforge', 'handoffs', 'inbox', 'in_process'), { recursive: true });
    return `${seat}\t${seat}\t${seatDir(root, seat)}\tswarmforge-${seat}\t${label}\tclaude\n`;
  });
  fs.writeFileSync(path.join(stateDir, 'roles.tsv'), rolesLines.join(''));
  const sessionsLines = ROSTER.filter(([seat]) => sessionsSeats.includes(seat)).map(
    ([seat, label], i) => `${i + 1}\t${seat}\tswarmforge-${seat}\t${label}\tclaude\n`
  );
  fs.writeFileSync(path.join(stateDir, 'sessions.tsv'), sessionsLines.join(''));
}

function holdTicket(root, seat, ticketId) {
  fs.mkdirSync(path.join(root, 'backlog', 'active'), { recursive: true });
  fs.writeFileSync(
    path.join(seatDir(root, seat), '.swarmforge', 'handoffs', 'inbox', 'in_process', '00_test.handoff'),
    `task: ${ticketId}-fixture-ticket\ndequeued_at: 2026-10-01T00:00:00Z\n\nbody\n`
  );
  fs.writeFileSync(path.join(root, 'backlog', 'active', `${ticketId}-fixture-ticket.yaml`), `id: ${ticketId}\ntitle: "fixture ${ticketId}"\n`);
}

function extractInlineScript(html) {
  const match = html.match(/<script>([\s\S]*?)<\/script>/);
  if (!match) throw new Error('no inline <script> in getResidentSpyUiHtml() output');
  return match[1];
}

// Render, read out plain data, close the window (its intervals would keep
// the generated test process alive otherwise - bl929's discipline).
async function renderLiveScreen(snapshot) {
  const { JSDOM } = require(JSDOM_MODULE);
  const html = getResidentSpyUiHtml();
  const dom = new JSDOM(html, {
    runScripts: 'outside-only',
    url: 'https://example.github.io/resident-spy/?bearer=test-token',
    pretendToBeVisual: true,
  });
  try {
    dom.window.fetch = () => Promise.resolve({ ok: true, json: () => Promise.resolve(snapshot) });
    dom.window.eval(extractInlineScript(html));
    await new Promise((resolve) => setTimeout(resolve, 0));
    const tiles = [...dom.window.document.querySelectorAll('.pane-col')].map((col) => ({
      id: col.getAttribute('data-pane-id'),
      kind: col.querySelector('.pane-kind')?.textContent ?? '',
      model: col.querySelector('.pane-grid-model')?.textContent ?? '',
      headText: col.querySelector('.pane-head')?.textContent ?? '',
    }));
    return { tiles };
  } finally {
    dom.window.close();
  }
}

function capture(ctx) {
  const fake = installInProcessTmux([
    { subcommand: 'show-window-options', exitCode: 0, stdout: '0\n' },
    { subcommand: 'list-windows', exitCode: 0, stdout: '0\n' },
    { subcommand: 'has-session', exitCode: 0 },
    { subcommand: 'capture-pane', exitCode: 0, stdout: '$ plain output, no role banner' },
  ]);
  try {
    clearResidentPaneLiveCache();
    ctx.bl1858.panes = captureLiveScreenPanes(ctx.bl1858.root);
    ctx.bl1858.snapshot = captureMonoRouterLiveScreen(ctx.bl1858.root);
  } finally {
    fake.restore();
  }
}

function paneFor(ctx, seat) {
  return ctx.bl1858.panes.find((entry) => entry.id === seat);
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(/^a target swarm whose roles\.tsv lists the seats specifier, coder, coder@2, cleaner, architect, hardender, documenter, QA, art-director and coordinator$/, (ctx) => {
    delete process.env.SWARMFORGE_CONFIG;
    ctx.bl1858 = { root: mkSocketFixtureRoot('bl1858-acceptance-') };
  });

  scoped(/^every seat's tmux session is live$/, (ctx) => {
    ctx.bl1858.allLive = true;
  });

  scoped(/^its sessions\.tsv lists every seat except coder@2 and art-director$/, (ctx) => {
    writeFixture(ctx.bl1858.root, ROSTER.map(([seat]) => seat).filter((s) => s !== 'coder@2' && s !== 'art-director'));
  });

  scoped(/^seat "([^"]+)" holds "(BL-\d+)" in its own in_process mailbox$/, (ctx, seat, ticketId) => {
    holdTicket(ctx.bl1858.root, knownSeat(seat), ticketId);
  });

  // The fake tmux answers has-session for every session, so coder@iq3's
  // session reads live; only the rosters decide whether it gets a tile.
  scoped(/^a live tmux session for the seat coder@iq3, which neither roles\.tsv nor sessions\.tsv lists$/, () => {});

  scoped(/^coder@2's launch script starts qwen with the model "([^"]+)"$/, (ctx, model) => {
    assert.ok(KNOWN_MODELS.has(model), `unrecognized model: ${model}`);
    ctx.bl1858.model = model;
    fs.writeFileSync(
      path.join(ctx.bl1858.root, '.swarmforge', 'launch', 'coder@2.sh'),
      `#!/bin/bash\nsource qwen_launch_guard_lib.sh\nqwen --model ${model} --yolo\n`
    );
  });

  scoped(/^coder@2's launch script starts qwen with no --model flag$/, (ctx) => {
    ctx.bl1858.model = null;
    fs.writeFileSync(
      path.join(ctx.bl1858.root, '.swarmforge', 'launch', 'coder@2.sh'),
      `#!/bin/bash\nsource qwen_launch_guard_lib.sh\nqwen --yolo\n`
    );
  });

  scoped(/^a leftover Claude settings file for coder@2 names the model "(claude-sonnet-5)"$/, (ctx, model) => {
    fs.writeFileSync(
      path.join(ctx.bl1858.root, '.swarmforge', 'launch', 'coder@2.claude-settings.json'),
      JSON.stringify({ model })
    );
  });

  scoped(/^the live screen captures its panes$/, (ctx) => {
    capture(ctx);
  });

  scoped(/^Bubble's live screen page renders the captured panes$/, async (ctx) => {
    capture(ctx);
    ctx.bl1858.rendered = await renderLiveScreen(ctx.bl1858.snapshot);
  });

  scoped(/^the pane list has a tile for seat "([^"]+)" labelled "([^"]+)"$/, (ctx, seat, label) => {
    assert.equal(KNOWN_LABELS.get(knownSeat(seat)), label, `unexpected label for ${seat}: ${label}`);
    const pane = paneFor(ctx, seat);
    assert.ok(pane, `no tile for ${seat} in ${ctx.bl1858.panes.map((p) => p.id)}`);
    assert.equal(pane.label, label);
  });

  scoped(/^the tile for seat "([^"]+)" comes right after the tile for seat "([^"]+)"$/, (ctx, seat, after) => {
    const ids = ctx.bl1858.panes.map((p) => p.id);
    const at = ids.indexOf(knownSeat(seat));
    assert.ok(at > 0, `no tile for ${seat} in ${ids}`);
    assert.equal(ids[at - 1], knownSeat(after), `tile order: ${ids}`);
  });

  scoped(/^the tile for seat "([^"]+)" shows ticket "(BL-\d+)"$/, (ctx, seat, ticketId) => {
    const pane = paneFor(ctx, knownSeat(seat));
    assert.ok(pane, `no tile for ${seat}`);
    assert.equal(pane.pane.ticketId, ticketId);
  });

  scoped(/^the pane list has no tile for seat "([^"]+)"$/, (ctx, seat) => {
    assert.equal(paneFor(ctx, knownSeat(seat)), undefined);
  });

  scoped(/^the grid shows (\d+) tiles$/, (ctx, count) => {
    assert.equal(ctx.bl1858.rendered.tiles.length, Number(count), JSON.stringify(ctx.bl1858.rendered.tiles.map((t) => t.id)));
  });

  scoped(/^one grid tile reads "([^"]+)"$/, (ctx, label) => {
    assert.ok(KNOWN_SEATS.has([...KNOWN_LABELS].find(([, l]) => l === label)?.[0]), `unrecognized label: ${label}`);
    const matching = ctx.bl1858.rendered.tiles.filter((t) => t.kind === label);
    assert.equal(matching.length, 1, JSON.stringify(ctx.bl1858.rendered.tiles));
  });

  scoped(/^the tile for seat "([^"]+)" names the model "([^"]+)" under its role name$/, (ctx, seat, shown) => {
    assert.equal(KNOWN_MODELS.get(ctx.bl1858.model), shown, `unexpected shown model: ${shown}`);
    const tile = ctx.bl1858.rendered.tiles.find((t) => t.id === knownSeat(seat));
    assert.ok(tile, `no rendered tile for ${seat}`);
    assert.equal(tile.kind, KNOWN_LABELS.get(seat));
    assert.equal(tile.model, shown);
  });

  scoped(/^the tile for seat "([^"]+)" names no model under its role name$/, (ctx, seat) => {
    const tile = ctx.bl1858.rendered.tiles.find((t) => t.id === knownSeat(seat));
    assert.ok(tile, `no rendered tile for ${seat}`);
    assert.equal(tile.kind, KNOWN_LABELS.get(seat));
    assert.equal(tile.model, '', `expected no model under ${seat}, got: ${tile.model}`);
  });
}

module.exports = { registerSteps };
