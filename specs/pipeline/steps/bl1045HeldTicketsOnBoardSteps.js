'use strict';

// BL-1045: step handlers for "The board surfaces held tickets".
//
// Everything here drives the REAL compiled board
// (extension/out/concierge/pipelineBoard.js) and the REAL git-derived hold-age
// reader (extension/out/concierge/heldSince.js) against a throwaway git
// repository. No step re-implements a section layout, a cap, or an age format
// in JS; a handler that did would keep passing after the production code it
// describes was deleted.
//
// Scenario 04 - "an age survives the file being touched" - is the one that
// needs a REAL repository: mtime is exactly what the ticket forbids trusting,
// so the only honest way to show the age does not come from it is to touch the
// file and re-read. The fixture repo is created and removed inside one step
// (BL-971): a throw between mkdtemp and the assertion must not leak it.
//
// Invariant (BL-968): module load is requires and pure constants only.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

// Scoped to this feature: several of these step texts ("the board is
// rendered") are shared with other board features' handlers, and an unscoped
// pattern would be a silent first-registered-wins race between them.
const FEATURE_NAME = 'The board surfaces held tickets';
const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const BOARD = require(path.join(REPO_ROOT, 'extension', 'out', 'concierge', 'pipelineBoard'));
const HELD_SINCE = require(path.join(REPO_ROOT, 'extension', 'out', 'concierge', 'heldSince'));

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 7, 22, 12, 0, 0);
const HELD_TICKET = 'BL-844';
const HELD_DAYS = 12;
const IN_FLIGHT_TICKET = 'BL-999';

function heldItem(id, days) {
  return {
    id,
    title: `${id} title`,
    filename: `${id}-thing.yaml`,
    heldSinceMs: NOW - days * DAY_MS,
  };
}

function renderWith(ctx) {
  ctx.data = BOARD.computePipelineBoard(
    { coder: [IN_FLIGHT_TICKET] },
    [],
    {},
    { nowMs: NOW, held: ctx.held, activeIds: [IN_FLIGHT_TICKET] }
  );
  ctx.body = BOARD.renderPipelineBoardBody(ctx.data);
}

function displayId(id) {
  return id.replace(/^BL-/, '');
}

function heldSectionLines(body) {
  const lines = body.split('\n');
  const start = lines.indexOf('HELD:');
  if (start === -1) {
    return [];
  }
  const out = [];
  for (let i = start + 1; i < lines.length; i++) {
    if (lines[i] === '' || /^[A-Z ]+:$/.test(lines[i])) {
      break;
    }
    out.push(lines[i]);
  }
  return out;
}

// A throwaway repository with one ticket committed into backlog/hold/, so the
// REAL git query runs against real history.
function withHoldRepo(fn) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'bl1045-hold-')));
  try {
    const git = (...args) =>
      execFileSync('git', args, {
        cwd: root,
        encoding: 'utf8',
        env: {
          ...process.env,
          GIT_AUTHOR_NAME: 'bl1045',
          GIT_AUTHOR_EMAIL: 'bl1045@example.invalid',
          GIT_COMMITTER_NAME: 'bl1045',
          GIT_COMMITTER_EMAIL: 'bl1045@example.invalid',
        },
      });
    git('init', '-q', '-b', 'main');
    fs.mkdirSync(path.join(root, 'backlog', 'hold'), { recursive: true });
    const filename = `${HELD_TICKET}-thing.yaml`;
    fs.writeFileSync(path.join(root, 'backlog', 'hold', filename), `id: ${HELD_TICKET}\n`);
    git('add', '-A');
    // A pinned commit date, so the derived age is a fact about history and
    // never about when this test happened to run.
    const heldAt = new Date(NOW - HELD_DAYS * DAY_MS).toISOString();
    execFileSync('git', ['commit', '-q', '-m', 'park it'], {
      cwd: root,
      encoding: 'utf8',
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: 'bl1045',
        GIT_AUTHOR_EMAIL: 'bl1045@example.invalid',
        GIT_COMMITTER_NAME: 'bl1045',
        GIT_COMMITTER_EMAIL: 'bl1045@example.invalid',
        GIT_AUTHOR_DATE: heldAt,
        GIT_COMMITTER_DATE: heldAt,
      },
    });
    return fn({ root, git, filename });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function registerSteps(registry) {
  // ── Background ──────────────────────────────────────────────────────────
  registry.defineScoped(/^a pipeline board rendered from the backlog folders$/, (ctx) => {
    ctx.held = [];
    assert.equal(typeof BOARD.computePipelineBoard, 'function');
    assert.equal(typeof HELD_SINCE.readHeldSinceMsFor, 'function');
  }, FEATURE_NAME);

  // ── 01 / 02 / 04 ────────────────────────────────────────────────────────
  registry.defineScoped(/^a ticket has been held for some time$/, (ctx) => {
    ctx.held = [heldItem(HELD_TICKET, HELD_DAYS)];
  }, FEATURE_NAME);

  registry.defineScoped(/^the board is rendered$/, (ctx) => {
    if (!ctx.ages) {
      renderWith(ctx);
    }
  }, FEATURE_NAME);

  registry.defineScoped(/^the held section names that ticket$/, (ctx) => {
    const lines = heldSectionLines(ctx.body);
    assert.ok(lines.length > 0, `the board has no HELD section at all:\n${ctx.body}`);
    assert.ok(
      lines.some((line) => line.trim().startsWith(`${displayId(HELD_TICKET)} `)),
      `${HELD_TICKET} is not in the HELD section:\n${ctx.body}`
    );
  }, FEATURE_NAME);

  registry.defineScoped(/^it shows how long the ticket has been held$/, (ctx) => {
    const line = heldSectionLines(ctx.body).find((l) => l.trim().startsWith(`${displayId(HELD_TICKET)} `));
    assert.match(line, /\((\d+[dhm]|just now|age unknown)\)$/, `no age on "${line}"`);
    assert.match(line, new RegExp(`\\(${HELD_DAYS}d\\)$`), `expected a ${HELD_DAYS}d age on "${line}"`);
  }, FEATURE_NAME);

  registry.defineScoped(/^no role column names that ticket$/, (ctx) => {
    for (const row of ctx.data.rows) {
      assert.notEqual(row.id, HELD_TICKET, `held ticket rendered in column ${row.column}`);
    }
  }, FEATURE_NAME);

  registry.defineScoped(/^the not-started column does not name it$/, (ctx) => {
    const notStarted = ctx.data.rows.filter((r) => r.column === BOARD.PIPELINE_BOARD_NOT_STARTED_COLUMN);
    assert.ok(
      !notStarted.some((r) => r.id === HELD_TICKET),
      'no role holds a held ticket, so it is not merely not-started'
    );
  }, FEATURE_NAME);

  // ── 03 ──────────────────────────────────────────────────────────────────
  registry.defineScoped(/^more held tickets than the held section renders$/, (ctx) => {
    ctx.overflow = 3;
    ctx.held = Array.from({ length: BOARD.PIPELINE_BOARD_HELD_MAX + ctx.overflow }, (_, i) =>
      heldItem(`BL-${900 + i}`, i + 1)
    );
  }, FEATURE_NAME);

  registry.defineScoped(/^it states how many held tickets it left out$/, (ctx) => {
    assert.equal(ctx.data.heldOmittedCount, ctx.overflow);
    assert.ok(
      ctx.body.includes(`+${ctx.overflow} more held`),
      `the cap was silent:\n${ctx.body}`
    );
  }, FEATURE_NAME);

  // ── 04: the age is history, not the filesystem ──────────────────────────
  registry.defineScoped(/^the ticket's file is written again without being unheld$/, (ctx) => {
    ctx.ages = withHoldRepo(({ root, filename }) => {
      const read = () =>
        HELD_SINCE.readHeldSinceMsFor(filename, (args) =>
          execFileSync('git', args, { cwd: root, encoding: 'utf8' })
        );
      const before = read();
      // The exact thing the ticket forbids trusting: rewrite the file (and
      // its mtime) without moving it out of hold/.
      const held = path.join(root, 'backlog', 'hold', filename);
      fs.writeFileSync(held, `${fs.readFileSync(held, 'utf8')}# touched\n`);
      fs.utimesSync(held, new Date(), new Date());
      return { before, after: read() };
    });
    assert.ok(ctx.ages.before !== undefined, 'the hold date must be derivable from history at all');
    ctx.held = [{ ...heldItem(HELD_TICKET, HELD_DAYS), heldSinceMs: ctx.ages.after }];
    renderWith(ctx);
  }, FEATURE_NAME);

  registry.defineScoped(/^it still shows the ticket as held for the original duration$/, (ctx) => {
    assert.equal(
      ctx.ages.after,
      ctx.ages.before,
      'the derived hold date moved when the file was touched - it is coming from mtime'
    );
    const line = heldSectionLines(ctx.body).find((l) => l.trim().startsWith(`${displayId(HELD_TICKET)} `));
    assert.match(line, new RegExp(`\\(${HELD_DAYS}d\\)$`), `expected the original ${HELD_DAYS}d age on "${line}"`);
  }, FEATURE_NAME);

  // ── 05 ──────────────────────────────────────────────────────────────────
  registry.defineScoped(/^no ticket is held$/, (ctx) => {
    ctx.held = [];
  }, FEATURE_NAME);

  registry.defineScoped(/^there is no held section$/, (ctx) => {
    assert.ok(!ctx.body.includes('HELD:'), `an empty held section frame was rendered:\n${ctx.body}`);
  }, FEATURE_NAME);

  registry.defineScoped(/^the rest of the board is unchanged$/, (ctx) => {
    // Byte-identical to a board computed with no held input at all - the
    // shape every caller had before this ticket.
    const before = BOARD.renderPipelineBoardBody(
      BOARD.computePipelineBoard({ coder: [IN_FLIGHT_TICKET] }, [], {}, { activeIds: [IN_FLIGHT_TICKET] })
    );
    assert.equal(ctx.body, before);
  }, FEATURE_NAME);
}

module.exports = { registerSteps };
