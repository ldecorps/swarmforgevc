'use strict';

// BL-990: step handlers for "a bounce's attribution can be corrected without
// rewriting history". Drives the REAL compiled store and the REAL consumer
// modules against a temp fixture root - never a reimplementation of
// supersession, and never the live .swarmforge/ tree.
//
// Invariant 1 (BL-968) applies here: module load is requires and pure
// constants only - everything environmental binds at step-execution time.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const EXT_OUT = path.join(__dirname, '..', '..', '..', 'extension', 'out');
const {
  readBounceRecords,
  readRawBounceRecords,
  appendBounceRecordIfNew,
  appendBounceCorrectionIfNew,
  bouncesDir,
} = require(path.join(EXT_OUT, 'metrics', 'bounceStore'));
const { recordsFromQaBounceJsonl } = require(path.join(EXT_OUT, 'metrics', 'failureModeInventory'));
const { composeBounceEvents } = require(path.join(EXT_OUT, 'metrics', 'leanLedgerComposeBounce'));
const { computeDailyReworkSeries } = require(path.join(EXT_OUT, 'metrics', 'reworkRounds'));

const FEATURE = "BL-990 a bounce's attribution can be corrected without rewriting history";

// The real misattribution this ticket was raised from.
const TICKET = 'BL-971';
const COMMIT = '8956d30eee';
const BLAMED_ROLE = 'coder';
const BOUNCE_DAY = '2026-08-20';

// Scenario Outline handlers validate against explicit KNOWN_VALUES - no
// passthrough (engineering.prompt's rule). Each entry is the REAL consumer
// module, called for real; a token this table does not name throws.
const CONSUMERS = {
  qaBounceStore: (ctx) => readBounceRecords(ctx.root).filter((r) => r.producingRole === BLAMED_ROLE).length,
  failureModeInventory: (ctx) =>
    recordsFromQaBounceJsonl(fs.readFileSync(monthFile(ctx.root), 'utf8')).filter((r) =>
      r.signature.endsWith(`:${BLAMED_ROLE}`)
    ).length,
  // reworkRounds counts by the BOUNCING role (bounceAttribution -> `by`),
  // not the blamed one, so this asks it for QA's bounces on the day the
  // fixture bounce happened. A corrected record leaves readBounceRecords
  // altogether, so a consumer that resolves supersession reports zero.
  reworkRounds: (ctx) =>
    computeDailyReworkSeries(readBounceRecords(ctx.root), 'QA', [BOUNCE_DAY]).reduce(
      (sum, p) => sum + (p.value ?? 0),
      0
    ),
  leanLedgerComposeBounce: (ctx) =>
    composeBounceEvents(ctx.root, TICKET).filter((e) => e.data.blamedRole === BLAMED_ROLE).length,
};

function monthFile(root) {
  return path.join(bouncesDir(root), '2026-08.jsonl');
}

function storeLines(root) {
  try {
    return fs.readFileSync(monthFile(root), 'utf8').split('\n').filter(Boolean);
  } catch {
    return [];
  }
}

function bounceRecord() {
  return {
    ticket: TICKET,
    producingRole: BLAMED_ROLE,
    ticketType: 'defect',
    failureClass: 'acceptance',
    commit: COMMIT,
    by: 'QA',
    at: `${BOUNCE_DAY}T13:45:00.000Z`,
  };
}

function correction(over = {}) {
  return {
    kind: 'bounce-correction',
    ticket: TICKET,
    commit: COMMIT,
    at: `${BOUNCE_DAY}T14:00:00.000Z`,
    by: 'QA',
    reason: 'misattributed - a mid-flight spec amendment caused this, not the coder',
    ...over,
  };
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  // ── Background ────────────────────────────────────────────────────────
  scoped(/^a bounce store holding a recorded bounce for ticket "([^"]+)" at commit "([^"]+)"$/, (ctx, ticket, commit) => {
    if (ticket !== TICKET || commit !== COMMIT) {
      throw new Error(`bl990: unexpected fixture ticket/commit "${ticket}"@"${commit}" - known: ${TICKET}@${COMMIT}`);
    }
    ctx.root = fs.mkdtempSync(path.join(os.tmpdir(), 'bl990-acc-'));
    ctx.cleanup = () => fs.rmSync(ctx.root, { recursive: true, force: true });
    // The ticket YAML too: leanLedgerComposeBounce reads bounce_history from
    // there, not the JSONL - a third read path over the same event.
    fs.mkdirSync(path.join(ctx.root, 'backlog', 'active'), { recursive: true });
    fs.writeFileSync(
      path.join(ctx.root, 'backlog', 'active', `${TICKET}-fixture.yaml`),
      [
        `id: ${TICKET}`,
        'bounce_count: 1',
        'bounce_history:',
        `  - { at: ${BOUNCE_DAY}, by: QA, blamed: ${BLAMED_ROLE}, class: acceptance, commit: ${COMMIT}, evidence: backlog/evidence/${TICKET}-x.md }`,
        '',
      ].join('\n')
    );
    assert.equal(appendBounceRecordIfNew(ctx.root, bounceRecord()), true, 'fixture bounce must be recorded');
    ctx.linesAtStart = storeLines(ctx.root);
    // An UNCORRECTED twin of the same fixture. Scenario 02 asks each
    // consumer for its reading only AFTER the correction, so "it reports 0"
    // would pass just as happily against a consumer adapter that is simply
    // wired wrong and always reports 0 - the green-when-broken shape this
    // ticket is itself an instance of. The twin makes every consumer prove
    // it counted the bounce BEFORE, in the same step.
    ctx.pristine = { root: fs.mkdtempSync(path.join(os.tmpdir(), 'bl990-acc-pristine-')) };
    fs.mkdirSync(path.join(ctx.pristine.root, 'backlog', 'active'), { recursive: true });
    fs.copyFileSync(
      path.join(ctx.root, 'backlog', 'active', `${TICKET}-fixture.yaml`),
      path.join(ctx.pristine.root, 'backlog', 'active', `${TICKET}-fixture.yaml`)
    );
    appendBounceRecordIfNew(ctx.pristine.root, bounceRecord());
    const priorCleanup = ctx.cleanup;
    ctx.cleanup = () => {
      priorCleanup();
      fs.rmSync(ctx.pristine.root, { recursive: true, force: true });
    };
  });

  // ── Givens ────────────────────────────────────────────────────────────
  scoped(/^a correction has already been recorded$/, (ctx) => {
    assert.equal(appendBounceCorrectionIfNew(ctx.root, correction()), true);
    ctx.linesAfterFirstCorrection = storeLines(ctx.root);
  });

  scoped(/^the blamed role's bounce count for that day is known$/, (ctx) => {
    ctx.countBefore = CONSUMERS.qaBounceStore(ctx);
    ctx.recordCountBefore = storeLines(ctx.root).length;
    assert.equal(ctx.countBefore, 1, 'precondition: the bounce is attributed to the blamed role');
  });

  // ── Whens ─────────────────────────────────────────────────────────────
  scoped(/^a correction is recorded with a reason$/, (ctx) => {
    ctx.accepted = appendBounceCorrectionIfNew(ctx.root, correction());
  });

  scoped(/^a correction is recorded with no reason$/, (ctx) => {
    const { reason, ...withoutReason } = correction();
    ctx.linesBeforeAttempt = storeLines(ctx.root);
    ctx.accepted = appendBounceCorrectionIfNew(ctx.root, withoutReason);
  });

  scoped(/^the identical correction is recorded again$/, (ctx) => {
    ctx.linesBeforeAttempt = storeLines(ctx.root);
    ctx.accepted = appendBounceCorrectionIfNew(ctx.root, correction());
  });

  scoped(/^"([^"]+)" reports its bounce attribution$/, (ctx, consumer) => {
    const read = CONSUMERS[consumer];
    if (!read) {
      throw new Error(`bl990: unknown <consumer> token "${consumer}" - known: ${Object.keys(CONSUMERS).join(' | ')}`);
    }
    ctx.consumer = consumer;
    ctx.reported = read(ctx);
  });

  // ── Thens ─────────────────────────────────────────────────────────────
  scoped(/^the original record is still present unchanged$/, (ctx) => {
    const lines = storeLines(ctx.root);
    assert.equal(lines[0], ctx.linesAtStart[0], 'the original line must be byte-for-byte unchanged');
    assert.deepEqual(readRawBounceRecords(ctx.root), [bounceRecord()], 'the raw audit trail still holds it');
  });

  scoped(/^the correction is appended after it as a new record$/, (ctx) => {
    const lines = storeLines(ctx.root);
    assert.equal(ctx.accepted, true, 'the correction was accepted');
    assert.equal(lines.length, ctx.linesAtStart.length + 1, 'exactly one line was added');
    assert.deepEqual(JSON.parse(lines[lines.length - 1]), correction(), 'and it is the correction, last');
    ctx.cleanup();
  });

  scoped(/^it reports the corrected attribution rather than the original$/, (ctx) => {
    // Non-vacuity, per consumer: the same adapter against the uncorrected
    // twin must report the bounce, or this scenario proves nothing.
    assert.equal(
      CONSUMERS[ctx.consumer](ctx.pristine),
      1,
      `${ctx.consumer} does not report the bounce even WITHOUT a correction - the adapter, not the fix, is wrong`
    );
    assert.equal(
      ctx.reported,
      0,
      `${ctx.consumer} still attributes the corrected bounce to ${BLAMED_ROLE} - a consumer that ignores ` +
        'supersession yields a second, different bounce rate from the same store'
    );
    ctx.cleanup();
  });

  scoped(/^the correction is refused$/, (ctx) => {
    assert.equal(ctx.accepted, false, 'a reasonless correction must be refused');
  });

  scoped(/^the store is unchanged$/, (ctx) => {
    assert.deepEqual(storeLines(ctx.root), ctx.linesBeforeAttempt, 'not a single byte was written');
    ctx.cleanup();
  });

  scoped(/^the blamed role's count for that day falls by exactly one$/, (ctx) => {
    assert.equal(ctx.accepted, true);
    assert.equal(CONSUMERS.qaBounceStore(ctx), ctx.countBefore - 1);
  });

  scoped(/^the total number of records in the store rises by exactly one$/, (ctx) => {
    assert.equal(storeLines(ctx.root).length, ctx.recordCountBefore + 1);
    ctx.cleanup();
  });
}

module.exports = { registerSteps };
