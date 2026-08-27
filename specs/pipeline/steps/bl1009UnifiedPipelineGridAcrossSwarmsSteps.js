'use strict';

// BL-1009: step handlers for "One pipeline grid across every swarm, badged
// by owner". Drives the REAL compiled computePipelineBoard /
// renderPipelineBoardBody / renderPipelineBoardGridOnly — never a
// hand-rolled badge or stage rule.

const assert = require('node:assert/strict');
const path = require('node:path');

const FEATURE = 'One pipeline grid across every swarm, badged by owner';
const EXT_OUT = path.join(__dirname, '..', '..', '..', 'extension', 'out');
const {
  computePipelineBoard,
  renderPipelineBoardBody,
  renderPipelineBoardGridOnly,
  deriveDisplayTicketId,
  PIPELINE_BOARD_NOT_STARTED_COLUMN,
  swarmDisplayBadge,
} = require(path.join(EXT_OUT, 'concierge', 'pipelineBoard'));

const KNOWN_BADGES = {
  primary: 's1',
  second: 's2',
  third: 'third',
};

function ensureBoard(ctx) {
  ctx.activeIds = ctx.activeIds ?? [];
  ctx.ticketMeta = ctx.ticketMeta ?? {};
  ctx.roleHeldTickets = ctx.roleHeldTickets ?? {};
  ctx.localSwarmName = ctx.localSwarmName ?? 'primary';
}

function addActive(ctx, id, swarm, heldRole) {
  ensureBoard(ctx);
  if (!ctx.activeIds.includes(id)) {
    ctx.activeIds.push(id);
  }
  const meta = { title: `${id} title` };
  if (swarm !== undefined) {
    meta.swarm = swarm;
  }
  ctx.ticketMeta[id] = meta;
  if (heldRole !== undefined) {
    (ctx.roleHeldTickets[heldRole] ??= []).push(id);
  }
}

function render(ctx) {
  ensureBoard(ctx);
  ctx.board = computePipelineBoard(ctx.roleHeldTickets, [], ctx.ticketMeta, {
    activeIds: ctx.activeIds,
    localSwarmName: ctx.localSwarmName,
  });
  ctx.body = renderPipelineBoardBody(ctx.board);
  ctx.gridText = renderPipelineBoardGridOnly(ctx.board);
}

function captionFor(ctx, ticketId) {
  const display = deriveDisplayTicketId(ticketId);
  const line = ctx.body.split('\n').find((l) => l.startsWith(`${display} `) || l === display);
  assert.ok(line, `no caption for ${ticketId} in:\n${ctx.body}`);
  return line;
}

function registerSteps(registry) {
  registry.defineScoped(/^the local swarm is named "([^"]+)"$/, (ctx, name) => {
    ensureBoard(ctx);
    ctx.localSwarmName = name;
  }, FEATURE);

  registry.defineScoped(/^an active ticket "([^"]+)" assigned to swarm "([^"]+)"$/, (ctx, id, swarm) => {
    addActive(ctx, id, swarm);
  }, FEATURE);

  registry.defineScoped(/^an active ticket (BL-\d+) assigned to swarm (\S+)$/, (ctx, id, swarm) => {
    addActive(ctx, id, swarm);
  }, FEATURE);

  registry.defineScoped(/^an active ticket "([^"]+)" with no swarm field$/, (ctx, id) => {
    addActive(ctx, id, undefined);
  }, FEATURE);

  registry.defineScoped(
    /^an active ticket "([^"]+)" assigned to swarm "([^"]+)" held by role "([^"]+)"$/,
    (ctx, id, swarm, role) => {
      addActive(ctx, id, swarm, role);
    },
    FEATURE
  );

  registry.defineScoped(/^the pipeline board is rendered$/, (ctx) => {
    render(ctx);
  }, FEATURE);

  registry.defineScoped(/^the grid has a column for "([^"]+)"$/, (ctx, id) => {
    assert.ok(
      ctx.board.rows.some((r) => r.id === id),
      `expected a grid row for ${id}, got ${JSON.stringify(ctx.board.rows.map((r) => r.id))}`
    );
  }, FEATURE);

  registry.defineScoped(/^the caption for (BL-\d+) carries the swarm badge (\S+)$/, (ctx, id, badge) => {
    if (!(badge === 's1' || badge === 's2' || badge === 'third' || Object.values(KNOWN_BADGES).includes(badge))) {
      // Outline Examples: badge is the display form; validate known set.
      throw new Error(`BL-1009: unrecognized <badge> example value "${badge}"`);
    }
    const line = captionFor(ctx, id);
    assert.ok(line.includes(`[${badge}]`), `expected [${badge}] in caption, got: ${line}`);
  }, FEATURE);

  registry.defineScoped(/^the caption for "([^"]+)" carries the swarm badge "([^"]+)"$/, (ctx, id, badge) => {
    const line = captionFor(ctx, id);
    assert.ok(line.includes(`[${badge}]`), `expected [${badge}] in caption, got: ${line}`);
  }, FEATURE);

  registry.defineScoped(/^no caption carries a swarm badge$/, (ctx) => {
    assert.doesNotMatch(ctx.body, / \[[^\]]+\] /);
  }, FEATURE);

  registry.defineScoped(/^the grid marks "([^"]+)" as held at stage "([^"]+)"$/, (ctx, id, stage) => {
    const row = ctx.board.rows.find((r) => r.id === id);
    assert.ok(row, `no row for ${id}`);
    assert.equal(row.column, stage, `${id} expected held at ${stage}, got ${row.column}`);
  }, FEATURE);

  registry.defineScoped(/^the grid marks no stage as holding "([^"]+)"$/, (ctx, id) => {
    const row = ctx.board.rows.find((r) => r.id === id);
    assert.ok(row, `no row for ${id}`);
    assert.equal(row.column, PIPELINE_BOARD_NOT_STARTED_COLUMN, `${id} must be not-started, got ${row.column}`);
  }, FEATURE);

  registry.defineScoped(/^the number of visible grid columns is the same as with no badges$/, (ctx) => {
    const withBadges = ctx.gridText.split('\n')[0] ?? '';
    const plain = computePipelineBoard(ctx.roleHeldTickets, [], ctx.ticketMeta, {
      activeIds: ctx.activeIds,
    });
    const withoutBadges = renderPipelineBoardGridOnly(plain).split('\n')[0] ?? '';
    assert.equal(withBadges.length, withoutBadges.length);
  }, FEATURE);

  // Keep the display map reachable from APS (mutation/wiring probes).
  registry.defineScoped(/^swarm display badges are defined$/, () => {
    assert.equal(swarmDisplayBadge('primary'), 's1');
    assert.equal(swarmDisplayBadge('second'), 's2');
  }, FEATURE);
}

module.exports = { registerSteps };
