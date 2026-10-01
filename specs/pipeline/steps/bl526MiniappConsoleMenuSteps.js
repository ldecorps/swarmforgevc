'use strict';

// BL-526: Miniapp console menu — portrait landing led by two buttons, pipeline
// STATUS GRID without below-grid LINKS, and mono-router resident feed.
const assert = require('node:assert/strict');
const path = require('node:path');

const EXT_OUT = path.join(__dirname, '..', '..', '..', 'extension', 'out');

function registerSteps(registry) {
  registry.define(/^the miniapp console menu is open on a portrait phone viewport$/, () => {
    const { getConsoleMenuUiHtml } = require(path.join(EXT_OUT, 'bridge', 'consoleMenuUiHtml'));
    const html = getConsoleMenuUiHtml();
    assert.match(html, /data-testid="pipeline-grid"/);
    assert.match(html, /data-testid="mono-router-feed"/);
    assert.match(html, /flex-direction:\s*column/);
    assert.match(html, /overflow-x:\s*hidden/);
    assert.match(html, /max-width:\s*100/);
    // BL-1859: the menu started with these two buttons; BL-572, BL-592,
    // BL-696 and later tickets added more on purpose (8 on 2026-10-01), so
    // the old "exactly two" count was a frozen boundary (BL-1006). What
    // BL-526 owns is that its two buttons lead the menu, in this order.
    const testIds = [...html.matchAll(/data-testid="([^"]+)"/g)].map((m) => m[1]);
    assert.deepEqual(
      testIds.slice(0, 2),
      ['pipeline-grid', 'mono-router-feed'],
      `expected the menu to open with the pipeline-grid and mono-router-feed buttons, found ${testIds.join(', ')}`,
    );
  });

  registry.define(/^the operator taps the pipeline-grid button$/, (ctx) => {
    const { getPipelineGridUiHtml } = require(path.join(EXT_OUT, 'bridge', 'pipelineGridUiHtml'));
    const { renderPipelineBoardGridOnly } = require(path.join(EXT_OUT, 'concierge', 'pipelineBoard'));
    ctx.pipelineGridHtml = getPipelineGridUiHtml();
    ctx.pipelineGridText = renderPipelineBoardGridOnly({
      rows: [{ id: 'BL-526', column: 'coder', slug: 'console-menu', epic: 'swarmforge-console' }],
      parked: [{ id: 'BL-513', slug: 'links-friction', status: 'parked' }],
      links: [{ id: 'BL-526', path: 'backlog/active/BL-526.yaml' }],
      rootIntake: [],
      recentlyClosed: [],
    });
  });

  registry.define(/^the pipeline STATUS GRID is shown without the below-grid links section$/, (ctx) => {
    assert.ok(ctx.pipelineGridHtml, 'expected pipeline-grid shell from prior step');
    // BL-1859: the pages authenticate with ?bearer= (BL-696), never ?token=.
    assert.match(ctx.pipelineGridHtml, /pipeline-board\?bearer=/);
    assert.match(ctx.pipelineGridHtml, /STATUS GRID/);
    assert.ok(!ctx.pipelineGridHtml.includes('LINKS:'));
    assert.match(ctx.pipelineGridText, /526/);
    assert.ok(!ctx.pipelineGridText.includes('LINKS:'));
    assert.ok(!ctx.pipelineGridText.includes('PARKED:'));
    assert.ok(!ctx.pipelineGridText.includes('<a href'));
  });

  registry.define(/^when they return and tap the mono-router feed button$/, (ctx) => {
    const { getResidentSpyUiHtml } = require(path.join(EXT_OUT, 'bridge', 'residentSpyUiHtml'));
    const { getConsoleMenuUiHtml } = require(path.join(EXT_OUT, 'bridge', 'consoleMenuUiHtml'));
    const menu = getConsoleMenuUiHtml();
    assert.match(menu, /\/resident-spy/);
    ctx.residentSpyHtml = getResidentSpyUiHtml();
  });

  registry.define(/^a live feed of the mono-router RESIDENT is shown$/, (ctx) => {
    assert.ok(ctx.residentSpyHtml, 'expected resident-spy shell');
    // BL-1859: ?bearer= since BL-696. The 07-22 live screen shows every
    // live pane in one grid, so the old coordinator-pane split id is gone;
    // the resident's live feed is the /resident-pane poll.
    assert.match(ctx.residentSpyHtml, /resident-pane\?bearer=/);
    assert.match(ctx.residentSpyHtml, /Swarm Live Screen/);
  });

  registry.define(/^neither destination requires horizontal scroll at a typical phone portrait width$/, (ctx) => {
    assert.match(ctx.pipelineGridHtml, /overflow-x:\s*hidden/);
    assert.match(ctx.pipelineGridHtml, /overflow-wrap:\s*anywhere/);
    assert.match(ctx.residentSpyHtml, /word-break:\s*break-word/);
    const { getConsoleMenuUiHtml } = require(path.join(EXT_OUT, 'bridge', 'consoleMenuUiHtml'));
    const menu = getConsoleMenuUiHtml();
    assert.match(menu, /overflow-x:\s*hidden/);
    assert.match(menu, /width:\s*100%/);
  });
}

module.exports = { registerSteps };
