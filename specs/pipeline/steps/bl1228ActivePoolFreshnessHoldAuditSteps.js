'use strict';

// BL-1228: step handlers for the active-pool freshness hold audit. Drives
// the REAL listActiveTicketRefs/auditActivePool/formatFinding
// (extension/out/tools/active-pool-freshness-audit.js) against a fixture
// backlog corpus on disk, with the freshness-verdict LOOKUP injected — the
// same "no real backlog corpus in unit tests, verdict lookup via injected
// seam" discipline the ticket's own constraints require, applied here too
// so the CLI subprocess (and its own real-repo state) never enters this
// suite's determinism.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  listActiveTicketRefs,
  auditActivePool,
} = require('../../../extension/out/tools/active-pool-freshness-audit');

const FEATURE = 'A ticket sitting in active/ under a standing freshness hold is reported';

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(/^an empty backlog corpus$/, (ctx) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bl1228-backlog-'));
    for (const pool of ['paused', 'active', 'hold', 'done']) {
      fs.mkdirSync(path.join(root, 'backlog', pool), { recursive: true });
    }
    ctx.bl1228 = { root, rawByTicket: {} };
  });

  scoped(/^ticket "([^"]+)" is in "backlog\/([a-z]+)\/"$/, (ctx, id, pool) => {
    const dir = path.join(ctx.bl1228.root, 'backlog', pool);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${id}-fixture.yaml`), `id: ${id}\ntitle: "fixture"\n`);
  });

  scoped(/^the freshness check for "([^"]+)" returns decision "([^"]+)"$/, (ctx, id, decision) => {
    ctx.bl1228.rawByTicket[id] = JSON.stringify({ decision });
  });

  scoped(/^the freshness check for "([^"]+)" returns decision "([^"]+)" with reason "([^"]+)"$/, (ctx, id, decision, reason) => {
    ctx.bl1228.rawByTicket[id] = JSON.stringify({ decision, reason });
  });

  scoped(/^the freshness check for "([^"]+)" is missing from the checkout$/, (ctx, id) => {
    ctx.bl1228.rawByTicket[id] = ''; // checkFreshnessViaCli's own empty-return for a missing CLI
  });

  scoped(/^the freshness check for "([^"]+)" exits non-zero$/, (ctx, id) => {
    ctx.bl1228.rawByTicket[id] = ''; // checkFreshnessViaCli also returns '' on a non-zero exit
  });

  scoped(/^the freshness check for "([^"]+)" prints unparseable output$/, (ctx, id) => {
    ctx.bl1228.rawByTicket[id] = 'not json at all';
  });

  scoped(/^the freshness check for "([^"]+)" prints an unrecognised decision$/, (ctx, id) => {
    ctx.bl1228.rawByTicket[id] = JSON.stringify({ decision: 'maybe' });
  });

  scoped(/^the active-pool freshness audit runs$/, (ctx) => {
    const refs = listActiveTicketRefs(ctx.bl1228.root);
    ctx.bl1228.beforeListing = listBacklogTree(ctx.bl1228.root);
    ctx.bl1228.findings = auditActivePool(ctx.bl1228.root, refs, (root, id) => ctx.bl1228.rawByTicket[id] ?? '');
  });

  scoped(/^"([^"]+)" is reported$/, (ctx, id) => {
    assert.ok(
      ctx.bl1228.findings.some((f) => f.ticketId === id),
      `expected ${id} among findings, got: ${JSON.stringify(ctx.bl1228.findings)}`
    );
  });

  scoped(/^"([^"]+)" is not reported$/, (ctx, id) => {
    assert.ok(
      !ctx.bl1228.findings.some((f) => f.ticketId === id),
      `expected ${id} NOT among findings, got: ${JSON.stringify(ctx.bl1228.findings)}`
    );
  });

  scoped(/^nothing is reported$/, (ctx) => {
    assert.deepEqual(ctx.bl1228.findings, []);
  });

  scoped(/^the report for "([^"]+)" carries the reason "([^"]+)"$/, (ctx, id, reason) => {
    const finding = ctx.bl1228.findings.find((f) => f.ticketId === id);
    assert.ok(finding, `expected a finding for ${id}`);
    assert.equal(finding.reason, reason);
  });

  scoped(/^"([^"]+)" is still in "backlog\/([a-z]+)\/"$/, (ctx, id, pool) => {
    const dir = path.join(ctx.bl1228.root, 'backlog', pool);
    const files = fs.readdirSync(dir).filter((f) => f.startsWith(`${id}-`));
    assert.ok(files.length > 0, `expected ${id} still under backlog/${pool}/`);
  });

  scoped(/^no backlog file has been created, moved, deleted, or rewritten$/, (ctx) => {
    const after = listBacklogTree(ctx.bl1228.root);
    assert.deepEqual(after, ctx.bl1228.beforeListing);
  });
}

function listBacklogTree(root) {
  const out = {};
  const backlogDir = path.join(root, 'backlog');
  for (const pool of fs.readdirSync(backlogDir)) {
    const poolDir = path.join(backlogDir, pool);
    if (!fs.statSync(poolDir).isDirectory()) {
      continue;
    }
    for (const file of fs.readdirSync(poolDir)) {
      out[path.join(pool, file)] = fs.readFileSync(path.join(poolDir, file), 'utf8');
    }
  }
  return out;
}

module.exports = { registerSteps };
