'use strict';

// BL-1040: seat identity never escapes the mailbox layer on the OBSERVATION
// path either.
//
// BL-983 declared the invariant and enforced it only where a seat FORWARDS
// work. Where the board READS who holds what, the seat id survived: the
// stage map recorded `coder@sonnet2`, the held-role inversion propagated it,
// and the renderer - which knows only bare stage names - matched nothing and
// painted the ticket as NOT-STARTED while the seat was actively working it.
//
// Every scenario EXECUTES the real production path rather than asserting on
// source text: the actual `pipeline_stage_cli.bb` over a real on-disk
// roles.tsv / mailbox fixture for the stage-map half, and the actual compiled
// `computePipelineBoard` / `invertTicketStageToRoleHeldTickets` for the board
// half. A source-text assertion cannot tell a wired fold from a dead one,
// which is the exact failure mode this ticket exists to close.
//
// The stale-file scenario matters most and is the one a source-only fix would
// miss: the stage map is a FILE on disk that outlives the process that wrote
// it, so a map recorded by a pre-fix producer must still read correctly.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const FEATURE = 'Seat identity never escapes the mailbox layer on the observation path';
const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const CLI = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'pipeline_stage_cli.bb');
const OUT = path.join(REPO_ROOT, 'extension', 'out');

const { computePipelineBoard, PIPELINE_BOARD_NOT_STARTED_COLUMN } = require(
  path.join(OUT, 'concierge', 'pipelineBoard')
);
const { invertTicketStageToRoleHeldTickets, normaliseTicketStageEntry } = require(
  path.join(OUT, 'swarm', 'swarmState')
);

// The stage this feature configures with two seats, and the seat id itself.
// BL-982's seat syntax is `<stage>@<suffix>`; the seat's STAGE is the part
// before the `@`, and that is the only thing an observer may ever see.
const STAGE = 'coder';
const SECOND_SEAT = 'coder@sonnet2';

// Scenario Outline holders, validated against explicit KNOWN_VALUES rather
// than passed through - an Outline that accepts any placeholder text asserts
// nothing about which holder was exercised.
const KNOWN_HOLDERS = {
  'the bare seat': STAGE,
  'the second seat': SECOND_SEAT,
};

const ROLE_ROWS = [
  ['specifier', 'master', ''],
  ['coder', 'coder', 'wt-coder'],
  ['cleaner', 'cleaner', 'wt-cleaner'],
  ['architect', 'architect', 'wt-architect'],
  ['hardender', 'hardender', 'wt-hardender'],
  ['documenter', 'documenter', 'wt-documenter'],
  ['QA', 'QA', 'wt-QA'],
  ['coordinator', 'master', ''],
];

function mkFixture(ctx) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bl1040-seat-'));
  ctx.cleanups.push(root);
  fs.mkdirSync(path.join(root, '.swarmforge'), { recursive: true });
  fs.mkdirSync(path.join(root, 'backlog', 'active'), { recursive: true });

  const rows = [...ROLE_ROWS, ['coder@sonnet2', 'coder-sonnet2', 'wt-coder-sonnet2']];
  const tsv = rows
    .map(([role, wtName, wtDir]) => {
      const wtPath = wtDir ? path.join(root, wtDir) : root;
      return `${role}\t${wtName}\t${wtPath}\tswarmforge-${wtName}\t${role}\tclaude\ttask`;
    })
    .join('\n');
  fs.writeFileSync(path.join(root, '.swarmforge', 'roles.tsv'), `${tsv}\n`);
  ctx.root = root;
  return root;
}

// The mailbox a seat actually reads - its own worktree, exactly as the real
// multi-worktree layout puts it. Two seats sharing a path would collide.
function inProcessDir(root, seat) {
  const wtDir = seat === SECOND_SEAT ? 'wt-coder-sonnet2' : `wt-${seat}`;
  return path.join(root, wtDir, '.swarmforge', 'handoffs', 'inbox', 'in_process');
}

function writeActive(root, id) {
  fs.writeFileSync(
    path.join(root, 'backlog', 'active', `${id}-fixture.yaml`),
    `id: ${id}\ntitle: "fixture ticket"\n`
  );
}

function placeParcel(root, seat, ticketId) {
  const dir = inProcessDir(root, seat);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, `50_${ticketId}.handoff`),
    `from: specifier\nto: ${STAGE}\ntype: git_handoff\npriority: 50\n` +
      `task: ${ticketId}-fixture\ncommit: 1234567890\n\nmerge_and_process specifier 1234567890\n`
  );
  writeActive(root, ticketId);
}

function runReport(root) {
  const out = execFileSync('bb', [CLI, root, 'report'], { encoding: 'utf8' });
  return JSON.parse(out);
}

// The board, from whatever stage map the scenario has in hand - the real
// production chain: stage map -> held-role inversion -> computePipelineBoard.
function renderBoard(stageMap) {
  const normalised = {};
  for (const [id, value] of Object.entries(stageMap)) {
    normalised[id] = normaliseTicketStageEntry(value);
  }
  const roleHeld = invertTicketStageToRoleHeldTickets(normalised);
  const activeIds = Object.keys(stageMap);
  return computePipelineBoard(roleHeld, [], {}, { activeIds }).rows;
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  // ── Background ──────────────────────────────────────────────────────────

  scoped(/^a pipeline stage configured with a bare seat and a second seat$/, (ctx) => {
    ctx.cleanups = ctx.cleanups ?? [];
    ctx.bl1040 = { tickets: {} };
    const root = mkFixture(ctx);
    const tsv = fs.readFileSync(path.join(root, '.swarmforge', 'roles.tsv'), 'utf8');
    assert.match(tsv, /^coder\t/m, 'the fixture must configure the bare seat');
    assert.match(tsv, /^coder@sonnet2\t/m, 'the fixture must configure a second seat of that stage');
  });

  // ── Holding steps ───────────────────────────────────────────────────────

  scoped(/^the second seat holds a ticket in its mailbox$/, (ctx) => {
    placeParcel(ctx.root, SECOND_SEAT, 'BL-993');
    ctx.bl1040.tickets[SECOND_SEAT] = 'BL-993';
    // The Outline's "the second seat" row resolves to THIS handler, not the
    // generic one below, so the subject is set here too or the board steps
    // have nothing to look for.
    ctx.bl1040.subject = 'BL-993';
  });

  scoped(/^(.+) holds a ticket in its mailbox$/, (ctx, holder) => {
    const seat = KNOWN_HOLDERS[holder];
    assert.ok(seat, `unknown holder "${holder}" - the Outline must name a configured seat`);
    const ticketId = seat === SECOND_SEAT ? 'BL-993' : 'BL-995';
    placeParcel(ctx.root, seat, ticketId);
    ctx.bl1040.tickets[seat] = ticketId;
    ctx.bl1040.subject = ticketId;
  });

  scoped(/^each seat holds its own ticket in its mailbox$/, (ctx) => {
    placeParcel(ctx.root, STAGE, 'BL-995');
    placeParcel(ctx.root, SECOND_SEAT, 'BL-993');
    ctx.bl1040.tickets[STAGE] = 'BL-995';
    ctx.bl1040.tickets[SECOND_SEAT] = 'BL-993';
  });

  // The stale-file case: a map written by a producer that predates the fix,
  // read back by the fixed reader. No CLI run - the point is precisely that
  // this file was NOT produced by the current source.
  scoped(/^a stage map recorded earlier that records a ticket under a seat id$/, (ctx) => {
    ctx.bl1040.stageMap = { 'BL-993': { stage: SECOND_SEAT, status: 'holding' } };
    ctx.bl1040.subject = 'BL-993';
    assert.ok(
      JSON.stringify(ctx.bl1040.stageMap).includes('@'),
      'the pre-fix map must actually carry a seat id, or this scenario proves nothing'
    );
  });

  // ── When ────────────────────────────────────────────────────────────────

  scoped(/^the stage map is computed$/, (ctx) => {
    ctx.bl1040.stageMap = runReport(ctx.root);
  });

  scoped(/^the board is rendered$/, (ctx) => {
    if (!ctx.bl1040.stageMap) {
      ctx.bl1040.stageMap = runReport(ctx.root);
    }
    ctx.bl1040.rows = renderBoard(ctx.bl1040.stageMap);
  });

  // ── Then ────────────────────────────────────────────────────────────────

  scoped(/^the ticket is recorded under the stage$/, (ctx) => {
    const entry = ctx.bl1040.stageMap['BL-993'];
    assert.ok(entry, 'the seat-held ticket must appear in the stage map at all');
    assert.equal(entry.stage, STAGE);
  });

  scoped(/^the stage map carries no seat id$/, (ctx) => {
    const serialised = JSON.stringify(ctx.bl1040.stageMap);
    assert.ok(!serialised.includes('@'), `the stage map leaked a seat id: ${serialised}`);
  });

  scoped(/^that ticket is shown as held by the stage$/, (ctx) => {
    const row = ctx.bl1040.rows.find((r) => r.id === ctx.bl1040.subject);
    assert.ok(row, `the held ticket ${ctx.bl1040.subject} must appear on the board`);
    assert.equal(row.column, STAGE);
  });

  scoped(/^it is not shown as not-started$/, (ctx) => {
    const row = ctx.bl1040.rows.find((r) => r.id === ctx.bl1040.subject);
    assert.notEqual(row.column, PIPELINE_BOARD_NOT_STARTED_COLUMN);
  });

  scoped(/^both tickets are shown under the one stage$/, (ctx) => {
    const columns = ['BL-993', 'BL-995'].map((id) => {
      const row = ctx.bl1040.rows.find((r) => r.id === id);
      assert.ok(row, `${id} must appear on the board`);
      return row.column;
    });
    assert.deepEqual(columns, [STAGE, STAGE]);
  });

  scoped(/^the board has exactly one column for that stage$/, (ctx) => {
    const columns = ctx.bl1040.rows.map((r) => r.column);
    assert.equal(new Set(columns).size, 1, `N seats widened the board: ${columns.join(', ')}`);
    assert.ok(!columns.some((c) => c.includes('@')));
  });

  // One position in the precedence order, observed through the behaviour the
  // order exists for: "most downstream wins". A ticket held by BOTH a seat of
  // the stage and a genuinely downstream stage resolves to the downstream one
  // and yields exactly ONE entry - which a stage occupying two positions
  // could not guarantee.
  scoped(/^the stage appears exactly once in the stage precedence order$/, (ctx) => {
    placeParcel(ctx.root, SECOND_SEAT, 'BL-993');
    placeParcel(ctx.root, 'cleaner', 'BL-993');
    const stageMap = runReport(ctx.root);
    const entries = Object.keys(stageMap).filter((id) => id === 'BL-993');
    assert.equal(entries.length, 1, 'a stage in two positions can yield two entries for one ticket');
    assert.equal(stageMap['BL-993'].stage, 'cleaner', 'the downstream stage must still win over a seat');
    assert.ok(!JSON.stringify(stageMap).includes('@'));
  });
}

module.exports = { registerSteps };
