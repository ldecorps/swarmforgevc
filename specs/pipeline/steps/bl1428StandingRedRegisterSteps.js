'use strict';

// BL-1428: step handlers for "every standing red names an open owner".
//
// Every scenario drives the REAL standing_red_register_cli.bb (via its own
// lib) and the REAL check_standing_red_register.sh - never a
// reimplementation - via lib/bl1428StandingRedRegisterCli.bb, against real
// fixture roots (scenarios 01-03) or this repo's own live register
// (scenario 04, justified because the register at this commit is the
// contract).

const assert = require('node:assert/strict');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const FEATURE = 'BL-1428 Every standing red names an open owner';
const CLI = path.join(__dirname, 'lib', 'bl1428StandingRedRegisterCli.bb');

function run(...args) {
  const out = execFileSync('bb', [CLI, ...args], { encoding: 'utf8', timeout: 120000 });
  return JSON.parse(out.trim().split('\n').pop());
}

// Explicit known values per the Scenario Outline handler rule.
const KNOWN_TICKETS = new Map([
  ['a ticket open in backlog/paused', 'paused'],
  ['a ticket open in backlog/active', 'active'],
  ['a ticket already in backlog/done', 'done'],
  ['no ticket at all', 'none'],
]);
const KNOWN_VERDICTS = new Map([
  ['exits 0 with no refusal', { exit: 0 }],
  ['refuses naming the row and the closed ticket', { exit: 1, mustMatch: /BL-9001/ }],
  ['refuses naming the row', { exit: 1 }],
]);

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(/^a fixture root with a property allowlist, a hardening-debt ledger, a standing-red register and a backlog holding both open and closed tickets$/, (ctx) => {
    ctx.bl1428 = {};
  });

  // ── 01 ──────────────────────────────────────────────────────────────
  scoped(/^the standing-red register CLI reads the fixture root$/, (ctx) => {
    ctx.bl1428.report = run('report');
  });

  scoped(/^every allowlist, ledger and register row appears once with its lane, file, ticket and first-seen date$/, (ctx) => {
    const { rows } = ctx.bl1428.report;
    assert.equal(rows.length, 5, `expected 5 rows (1 property+register, 1 unit+register open, 1 unit+register closed, 1 orphan allowlist, 1 ledger), got: ${JSON.stringify(rows)}`);
    for (const r of rows) {
      assert.ok('lane' in r && 'file' in r && 'ticket' in r && 'first_seen' in r, `row missing a required field: ${JSON.stringify(r)}`);
    }
    const seen = new Set();
    for (const r of rows) {
      const key = `${r.lane}::${r.file}`;
      assert.ok(!seen.has(key), `row appeared more than once: ${key}`);
      seen.add(key);
    }
  });

  scoped(/^a row whose ticket is closed or absent is reported as unowned$/, (ctx) => {
    const { unowned } = ctx.bl1428.report;
    const files = unowned.map((r) => r.file);
    assert.ok(files.includes('extension/test/bl9003.test.js'), `expected the closed-ticket row unowned, got: ${JSON.stringify(unowned)}`);
    assert.ok(files.includes('extension/test/bl9099Orphan.property.test.js'), `expected the no-register-row allowlist file unowned, got: ${JSON.stringify(unowned)}`);
    for (const r of unowned) assert.equal(r.owned, false, `an unowned row must carry owned:false: ${JSON.stringify(r)}`);
  });

  scoped(/^the report carries the total count and the oldest age in days$/, (ctx) => {
    const { report } = ctx.bl1428;
    assert.equal(report.count, report.rows.length, `count must equal the number of rows`);
    assert.equal(report.oldest_age_days, 35, `expected the oldest row's age (2026-08-01), got: ${report.oldest_age_days}`);
  });

  // ── 02 (Scenario Outline) ───────────────────────────────────────────
  scoped(/^the commit stages a register row for a red test naming (.+)$/, (ctx, ticketPhrase) => {
    assert.ok(KNOWN_TICKETS.has(ticketPhrase), `unknown ticket phrase "${ticketPhrase}" - known: ${[...KNOWN_TICKETS.keys()]}`);
    ctx.bl1428.shape = KNOWN_TICKETS.get(ticketPhrase);
  });

  scoped(/^check_standing_red_register\.sh runs in that repository$/, (ctx) => {
    ctx.bl1428.result = ctx.bl1428.preExisting
      ? run('guard-pre-existing')
      : run('guard', ctx.bl1428.shape);
  });

  scoped(/^the guard (.+)$/, (ctx, verdictPhrase) => {
    assert.ok(KNOWN_VERDICTS.has(verdictPhrase), `unknown verdict phrase "${verdictPhrase}" - known: ${[...KNOWN_VERDICTS.keys()]}`);
    const expected = KNOWN_VERDICTS.get(verdictPhrase);
    const { result } = ctx.bl1428;
    assert.equal(result.exit, expected.exit, `expected exit ${expected.exit}, got: ${JSON.stringify(result)}`);
    if (expected.mustMatch) {
      assert.match(result.err, expected.mustMatch, `expected the refusal to name the ticket, got: ${result.err}`);
    }
  });

  // ── 03 ──────────────────────────────────────────────────────────────
  scoped(/^the register already holds a row naming a closed ticket committed earlier$/, (ctx) => {
    ctx.bl1428.preExisting = true;
  });

  scoped(/^the commit stages a change that touches no register source$/, (ctx) => {
    // The driver's guard-pre-existing mode builds BOTH this scenario's
    // GIVENs in one real fixture (a committed stale row, then an unrelated
    // staged file) - the shared "runs in that repository" When-step
    // dispatches to it because ctx.bl1428.preExisting is set here, so the
    // "no register source touched" claim is checked against the SAME
    // repository the guard actually runs in, not a second one.
    assert.ok(ctx.bl1428.preExisting, 'expected the pre-existing-row precondition to have been set');
  });

  // (reuses "the guard the guard exits 0 with no refusal" handler above)

  // ── 04 ──────────────────────────────────────────────────────────────
  scoped(/^each ticket named in backlog\/standing-reds\.tsv is looked up under backlog\/paused and backlog\/active$/, (ctx) => {
    ctx.bl1428.liveResult = run('live-register');
  });

  scoped(/^every one of them is found$/, (ctx) => {
    const { liveResult } = ctx.bl1428;
    const notFound = liveResult.results.filter((r) => !r.found);
    assert.deepEqual(notFound, [], `expected every register ticket open, not found: ${JSON.stringify(notFound)}`);
    assert.ok(liveResult.count > 0, 'expected at least one register row to check');
  });
}

module.exports = { registerSteps };
