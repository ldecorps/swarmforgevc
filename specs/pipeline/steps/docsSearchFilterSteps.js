'use strict';

// BL-254: step handlers for the phone-app full-text spec search filter.
// Drives the REAL filterDocsTree (extension/out/docs/docsTree.js) over a
// REAL buildDocsTree fixture tree - the ticket's own explicit constraint
// is that the acceptance layer drives the PURE filter, not the rendered
// DOM (the DOM search box in pwa/app.js is the unsuitable-for-testing
// boundary here; it is covered separately by
// extension/test/pwaDocsExplorer.test.js's own jsdom-based unit tests).
const path = require('node:path');

const { buildDocsTree, filterDocsTree } = require(path.join(__dirname, '..', '..', '..', 'extension', 'out', 'docs', 'docsTree'));

function scenario(text, name) {
  return { name: name || 'a scenario', text };
}

// One fixture tree shared across every scenario in this feature, each
// scenario's own Given step only ever picks ctx.query - the tree itself
// never changes shape, matching the ticket's own "filter the tree, don't
// build a new one" reuse constraint.
function buildFixtureTree() {
  const items = [
    { id: 'BL-500', title: 'alpha ticket', status: 'done', milestone: 'M1' },
    { id: 'BL-501', title: 'beta ticket', status: 'active', milestone: 'M1', description: 'discusses gherkin mutation coverage details' },
    { id: 'BL-502', title: 'zzz nothing matches here', status: 'paused', milestone: 'M2' },
    { id: 'BL-503', title: 'shared search term ticket A', status: 'done', milestone: 'M2' },
    { id: 'BL-504', title: 'shared search term ticket B', status: 'active', milestone: 'M2' },
  ];
  const scenariosByTicketId = new Map([
    ['BL-500', [scenario('Scenario: x\n  Given the fleet console refreshes')]],
    ['BL-501', [scenario('Scenario: y\n  Given something unrelated')]],
    ['BL-502', [scenario('Scenario: z\n  Given something else entirely')]],
    ['BL-503', [scenario('Scenario: a\n  Given something else again')]],
    ['BL-504', [scenario('Scenario: b\n  Given yet another thing')]],
  ]);
  return buildDocsTree([], items, scenariosByTicketId, 'abc1234567', '2026-07-10T00:00:00Z');
}

function registerSteps(registry) {
  // ── Background ───────────────────────────────────────────────────────
  registry.define(/^the phone docs drill-down tree over milestones, tickets, and their Gherkin scenarios$/, (ctx) => {
    ctx.tree = buildFixtureTree();
  });

  // ── filter-by-gherkin-01 ─────────────────────────────────────────────
  registry.define(/^a query that appears in a ticket's Gherkin scenario text$/, (ctx) => {
    ctx.query = 'fleet console';
    ctx.expectedMatchId = 'BL-500';
    ctx.expectedHiddenId = 'BL-502';
  });

  // ── match-title-description-02 ───────────────────────────────────────
  registry.define(/^a query that appears in a ticket's title or description but not its scenarios$/, (ctx) => {
    ctx.query = 'gherkin mutation coverage';
    ctx.expectedMatchId = 'BL-501';
  });

  // ── case-insensitive-03 ──────────────────────────────────────────────
  registry.define(/^a query that differs only in letter case from text in a ticket's Gherkin$/, (ctx) => {
    ctx.query = 'FLEET Console';
    ctx.expectedMatchId = 'BL-500';
  });

  // ── spans-implemented-and-not-yet-04 ─────────────────────────────────
  registry.define(/^a query that matches both an implemented ticket and a not-yet-implemented ticket$/, (ctx) => {
    ctx.query = 'shared search term';
    ctx.expectedImplementedId = 'BL-503';
    ctx.expectedNotYetId = 'BL-504';
  });

  // ── empty-query-05 ───────────────────────────────────────────────────
  registry.define(/^an empty query$/, (ctx) => {
    ctx.query = '';
  });

  // ── no-results-06 ────────────────────────────────────────────────────
  registry.define(/^a query that matches no ticket$/, (ctx) => {
    ctx.query = 'zzzz-no-ticket-anywhere-contains-this-zzzz';
  });

  // ── When ─────────────────────────────────────────────────────────────
  registry.define(/^the search is applied$/, (ctx) => {
    ctx.filtered = filterDocsTree(ctx.tree, ctx.query);
  });

  // ── Then ─────────────────────────────────────────────────────────────
  registry.define(/^that ticket remains in the filtered tree$/, (ctx) => {
    const ids = ctx.filtered.tickets.map((t) => t.id);
    if (!ids.includes(ctx.expectedMatchId)) {
      throw new Error(`expected ticket "${ctx.expectedMatchId}" in the filtered tree, got: ${JSON.stringify(ids)}`);
    }
  });

  registry.define(/^a ticket containing the query nowhere is hidden$/, (ctx) => {
    const ids = ctx.filtered.tickets.map((t) => t.id);
    if (ids.includes(ctx.expectedHiddenId)) {
      throw new Error(`expected ticket "${ctx.expectedHiddenId}" to be hidden, got: ${JSON.stringify(ids)}`);
    }
  });

  registry.define(/^that ticket still matches$/, (ctx) => {
    const ids = ctx.filtered.tickets.map((t) => t.id);
    if (!ids.includes(ctx.expectedMatchId)) {
      throw new Error(`expected ticket "${ctx.expectedMatchId}" to still match case-insensitively, got: ${JSON.stringify(ids)}`);
    }
  });

  registry.define(/^both remain in the filtered tree, each with the tree's normal status treatment$/, (ctx) => {
    const byId = Object.fromEntries(ctx.filtered.tickets.map((t) => [t.id, t]));
    const implemented = byId[ctx.expectedImplementedId];
    const notYet = byId[ctx.expectedNotYetId];
    if (!implemented || !notYet) {
      throw new Error(`expected both ${ctx.expectedImplementedId} and ${ctx.expectedNotYetId} in the filtered tree, got: ${JSON.stringify(Object.keys(byId))}`);
    }
    if (implemented.status !== 'done' || notYet.status !== 'active') {
      throw new Error(`expected each ticket's status untouched by filtering, got: ${implemented.status}, ${notYet.status}`);
    }
  });

  registry.define(/^the full unfiltered tree is shown$/, (ctx) => {
    if (ctx.filtered.tickets.length !== ctx.tree.tickets.length) {
      throw new Error(`expected an empty query to return every ticket (${ctx.tree.tickets.length}), got ${ctx.filtered.tickets.length}`);
    }
  });

  registry.define(/^a clear no-results state is shown rather than a blank or an error$/, (ctx) => {
    if (!Array.isArray(ctx.filtered.tickets) || ctx.filtered.tickets.length !== 0) {
      throw new Error(`expected zero matching tickets, got: ${JSON.stringify(ctx.filtered.tickets)}`);
    }
    if (!Array.isArray(ctx.filtered.milestones)) {
      throw new Error('expected filtered milestones to still be an array, not blank/undefined');
    }
  });
}

module.exports = { registerSteps };
