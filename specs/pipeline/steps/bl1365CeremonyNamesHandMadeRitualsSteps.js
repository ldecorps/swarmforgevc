'use strict';

// BL-1365: step handlers for "The ceremony packet names hand-made rituals".
//
// Drives the REAL producer (runRitualLedgerProducer) into a REAL store on disk
// and the REAL ceremony (runClosingCeremony) back out of it. The ticket's whole
// point is that the measurement accrues on a cadence of its own and the
// ceremony merely reads it, so a handler that computed candidates inline would
// prove nothing - the two halves have to be separate processes' worth of work
// for scenario 05 to mean anything.
//
// Fixture roots come from mkProcessTmpDir, not mkTmpDir: the acceptance runner
// has no Vitest afterEach to drive the per-test sweep, so a root registered for
// it would simply leak. mkProcessTmpDir registers removal on process exit
// instead - cleanup that does not depend on a hook that never fires, and does
// not reach for the prefix-glob sweep that would delete a concurrent run's
// fixtures (BL-1390).

const assert = require('node:assert/strict');
const { mkProcessTmpDir } = require('../../../extension/test/helpers/tmpDir');
const {
  RITUAL_CLASSES,
  RITUAL_VOLUME_FLOOR,
} = require('../../../extension/out/metrics/ritualLedger');
const { runRitualLedgerProducer } = require('../../../extension/out/metrics/ritualLedgerProducer');
const { runClosingCeremony } = require('../../../extension/out/metrics/closingCeremonyRun');

const FEATURE = 'The ceremony packet names hand-made rituals';

const HAND_MADE_CLASS = RITUAL_CLASSES.find((c) => c.id === 'pass-bounce-evidence');
const SCRIPTED_CLASS = RITUAL_CLASSES.find((c) => c.id === 'backlog-promotion');
const ABOVE_FLOOR = RITUAL_VOLUME_FLOOR + 10;

function logBody(entries) {
  return entries.map(({ subject, paths }) => [`COMMIT\t${subject}`, ...paths, ''].join('\n')).join('');
}

// Every subject differs — the long tail an agent leaves behind.
function handMade(cls, n) {
  return Array.from({ length: n }, (_unused, i) => ({
    subject: `hand written subject ${'w'.repeat(i + 1)}`,
    paths: [`${cls.pathPrefix}item-${i}.md`],
  }));
}

// One generated subject for every commit — what a script leaves behind.
function scripted(cls, n) {
  return Array.from({ length: n }, (_unused, i) => ({
    subject: 'Close BL-1: move to done. By coordinator.',
    paths: [`${cls.pathPrefix}item-${i}.yaml`],
  }));
}

function ensureCtx(ctx) {
  if (!ctx.bl1365) {
    ctx.bl1365 = {
      root: mkProcessTmpDir('aps-bl1365-'),
      openTicketTexts: [],
      subjectClass: null,
      ceremoniesRun: 0,
    };
  }
  return ctx.bl1365;
}

// The producer's own pass: classify the window and write the ledger. Separate
// from any ceremony, which is the invariant-1 split the feature rests on.
function classifyWindow(state, entries) {
  runRitualLedgerProducer({
    repoRoot: state.root,
    nowIso: '2026-09-01T00:00:00.000Z',
    readLogFn: () => logBody(entries),
  });
}

function assembleCeremony(state, nowIso) {
  state.result = runClosingCeremony(state.root, nowIso, {
    sendNote: () => undefined,
    readWindowModels: () => ({}),
    readOpenTicketTexts: () => state.openTicketTexts,
  });
  state.ceremoniesRun += 1;
  return state.result;
}

function candidates(state) {
  return state.result.run.packet.determinismCandidates;
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  // Background, and scenario 05's own restatement of it. A default hand-made
  // window so a scenario that adds no commits of its own still has a
  // measurement to lose.
  scoped(/^the ritual ledger has classified a window of commits$/, (ctx) => {
    const state = ensureCtx(ctx);
    state.subjectClass = HAND_MADE_CLASS;
    classifyWindow(state, handMade(HAND_MADE_CLASS, ABOVE_FLOOR));
  });

  scoped(/^a ritual class whose commits nearly all share one subject$/, (ctx) => {
    const state = ensureCtx(ctx);
    state.subjectClass = SCRIPTED_CLASS;
    classifyWindow(state, scripted(SCRIPTED_CLASS, ABOVE_FLOOR));
  });

  scoped(/^a ritual class above the volume threshold whose subjects vary widely$/, (ctx) => {
    const state = ensureCtx(ctx);
    state.subjectClass = HAND_MADE_CLASS;
    classifyWindow(state, handMade(HAND_MADE_CLASS, ABOVE_FLOOR));
  });

  scoped(/^a ritual class an open ticket already names$/, (ctx) => {
    const state = ensureCtx(ctx);
    state.subjectClass = HAND_MADE_CLASS;
    classifyWindow(state, handMade(HAND_MADE_CLASS, ABOVE_FLOOR));
    // Named by its path prefix, the way a real ticket describing the work
    // would name it.
    state.openTicketTexts = [`title: nobody writes ${HAND_MADE_CLASS.pathPrefix} by script yet`];
  });

  scoped(/^every ritual class is scripted or already ticketed$/, (ctx) => {
    const state = ensureCtx(ctx);
    state.subjectClass = HAND_MADE_CLASS;
    classifyWindow(state, [
      ...scripted(SCRIPTED_CLASS, ABOVE_FLOOR),
      ...handMade(HAND_MADE_CLASS, ABOVE_FLOOR),
    ]);
    state.openTicketTexts = [`a ticket that already names ${HAND_MADE_CLASS.pathPrefix}`];
  });

  scoped(/^no ceremony runs for that window$/, (ctx) => {
    const state = ensureCtx(ctx);
    assert.equal(state.ceremoniesRun, 0, 'the scenario claims no ceremony ran, but one already had');
  });

  scoped(/^the packet is assembled$/, (ctx) => {
    assembleCeremony(ensureCtx(ctx), '2026-09-05T18:00:00.000Z');
  });

  // Deliberately far later than the window the ledger classified, so "still
  // offered" is a claim about a genuinely later ceremony.
  scoped(/^a later ceremony assembles its packet$/, (ctx) => {
    assembleCeremony(ensureCtx(ctx), '2026-09-20T18:00:00.000Z');
  });

  scoped(/^that class is not offered as a candidate$/, (ctx) => {
    const state = ensureCtx(ctx);
    const offered = candidates(state).map((c) => c.ritualClass);
    assert.ok(
      !offered.includes(state.subjectClass.id),
      `${state.subjectClass.id} should not have been offered, but the packet carries ${JSON.stringify(offered)}`
    );
  });

  scoped(/^that class is offered as a candidate$/, (ctx) => {
    const state = ensureCtx(ctx);
    const offered = candidates(state).map((c) => c.ritualClass);
    assert.ok(
      offered.includes(state.subjectClass.id),
      `${state.subjectClass.id} should have been offered, but the packet carries ${JSON.stringify(offered)}`
    );
  });

  scoped(/^the candidate carries its volume and its subject spread$/, (ctx) => {
    const state = ensureCtx(ctx);
    const candidate = candidates(state).find((c) => c.ritualClass === state.subjectClass.id);
    assert.ok(candidate, 'no candidate for the class under test');
    // Volume and spread are the two numbers that justified the offer, so the
    // specifier can judge it without re-deriving anything.
    assert.equal(candidate.commits, ABOVE_FLOOR, 'volume');
    assert.equal(candidate.distinctSubjects, ABOVE_FLOOR, 'subject spread');
    assert.ok(candidate.dominance > 0 && candidate.dominance < 1, `dominance ${candidate.dominance}`);
  });

  scoped(/^no candidate is offered$/, (ctx) => {
    const state = ensureCtx(ctx);
    assert.deepEqual(candidates(state), [], 'the packet offered a candidate');
  });

  scoped(/^the ceremony can record a reasoned no-change$/, (ctx) => {
    const state = ensureCtx(ctx);
    // Nothing to adjudicate, so the ceremony records the outcome itself rather
    // than delivering an empty packet and waiting on a turn with nothing to
    // react to. It is a RECORDED no-change, not a silent one.
    assert.equal(state.result.status, 'auto_no_change');
    assert.equal(state.result.run.outcome.type, 'no_change');
  });

  scoped(/^the earlier window's candidates are still offered$/, (ctx) => {
    const state = ensureCtx(ctx);
    const offered = candidates(state).map((c) => c.ritualClass);
    assert.deepEqual(
      offered,
      [HAND_MADE_CLASS.id],
      'the measurement taken before the skipped ceremony did not survive to a later one'
    );
  });
}

module.exports = { registerSteps };
