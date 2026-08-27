'use strict';

// BL-504: step handlers for "the TS metrics ticket-id extractor uses the
// BL/GH allowlist and resolves the no-hyphen prefix form". Drives the REAL
// compiled extension/out/metrics/swarmMetrics.extractTicketId and
// extension/out/metrics/stageDwell.readRoleStageDwellRecords against a real
// fs fixture, never reimplements the matching/derivation logic here.

const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const { extractTicketId } = require(path.join(__dirname, '..', '..', '..', 'extension', 'out', 'metrics', 'swarmMetrics'));
const { readRoleStageDwellRecords } = require(path.join(__dirname, '..', '..', '..', 'extension', 'out', 'metrics', 'stageDwell'));

function mkTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'aps-bl504-ticket-id-'));
}

function writeCompletedHandoff(worktreePath, task) {
  const dir = path.join(worktreePath, '.swarmforge', 'handoffs', 'inbox', 'completed');
  fs.mkdirSync(dir, { recursive: true });
  const headers = [
    'from: coordinator',
    'to: coder',
    'type: git_handoff',
    'priority: 50',
    `task: ${task}`,
    'commit: 0123456789',
    'enqueued_at: 2026-07-17T08:00:00Z',
    'dequeued_at: 2026-07-17T08:05:00Z',
    'completed_at: 2026-07-17T09:05:00Z',
  ];
  fs.writeFileSync(path.join(dir, '50_fixture.handoff'), `${headers.join('\n')}\n\nbody\n`);
}

// The feature's own Scenario Outline load-bearing rule: validate the
// "resolved" Examples column against an explicit KNOWN_VALUES lookup, never
// a bare passthrough - an Examples value outside this set (including a
// gherkin-mutator mutant) must fail loudly rather than silently pass
// (engineering.prompt's Scenario Outline rule).
const KNOWN_VALUES = {
  'BL-493': (actual) => actual === 'BL-493',
  'GH-77': (actual) => actual === 'GH-77',
  NONE: (actual) => actual === null,
};

function registerSteps(registry) {
  registry.define(/^a ticket id is extracted from the task header "([^"]*)"$/, (ctx, task) => {
    ctx.extracted = extractTicketId(task);
  });

  registry.define(/^it resolves to "([^"]*)"$/, (ctx, resolved) => {
    const check = KNOWN_VALUES[resolved];
    if (!check) {
      throw new Error(`BL-504: unknown resolved value "${resolved}" - not in KNOWN_VALUES`);
    }
    if (!check(ctx.extracted)) {
      throw new Error(`expected resolved "${resolved}", got extracted: ${JSON.stringify(ctx.extracted)}`);
    }
  });

  registry.define(/^a role held handoff trail for a ticket whose task header is "([^"]*)"$/, (ctx, task) => {
    ctx.worktreePath = mkTmp();
    writeCompletedHandoff(ctx.worktreePath, task);
  });

  registry.define(/^the stage-dwell report is computed$/, (ctx) => {
    const entry = { role: 'coder', worktreeName: 'coder', worktreePath: ctx.worktreePath };
    ctx.dwell = readRoleStageDwellRecords(entry, 0, Date.now() + 1000 * 60 * 60 * 24 * 365);
  });

  registry.define(/^the report includes an entry keyed by "([^"]*)"$/, (ctx, ticketId) => {
    const found = ctx.dwell.records.some((r) => r.ticketId === ticketId);
    if (!found) {
      throw new Error(`expected a dwell record keyed by "${ticketId}", got: ${JSON.stringify(ctx.dwell.records)}`);
    }
  });
}

module.exports = { registerSteps };
