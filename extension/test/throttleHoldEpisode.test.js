'use strict';

// BL-1981 (Article 3.5's 2026-10-05 amendment): unit coverage for the
// throttle-hold episode state machine (updateThrottleEpisode/
// heldCapForEpisode) and emitThrottleRecommendation's own folding of it -
// never a re-implementation in the test itself, these drive the real
// compiled functions directly.
const { mkTmpDir } = require('./helpers/tmpDir');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  updateThrottleEpisode,
  heldCapForEpisode,
  emitThrottleRecommendation,
  throttleRecommendationPath,
  throttleChangeLogPath,
} = require('../out/tools/emit-throttle-recommendation');
const { persistReworkSignal } = require('../out/metrics/reworkObservatoryStore');
const { describeStandingRedSignal } = require('../out/metrics/standingRedSignal');

function mkTmp() {
  return mkTmpDir('sfvc-throttle-hold-');
}

function writeConfiguredCap(targetPath, cap) {
  fs.mkdirSync(path.join(targetPath, 'swarmforge'), { recursive: true });
  fs.writeFileSync(path.join(targetPath, 'swarmforge', 'swarmforge.conf'), `config active_backlog_max_depth ${cap}\n`);
}

function writeSignal(targetPath, overrides) {
  persistReworkSignal(targetPath, {
    kind: 'rework-rate',
    version: 1,
    computedAtIso: '2026-10-05T00:00:00Z',
    signal: { hasSample: true, sampleCount: 10, reworkRate: 0.5, baselineRate: 0.1, topRole: null, topTicketClass: null, ...overrides },
  });
}

function readChangeLogLines(targetPath) {
  try {
    return fs
      .readFileSync(throttleChangeLogPath(targetPath), 'utf8')
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l));
  } catch {
    return [];
  }
}

function fakeRec(overrides = {}) {
  return { recommendedCap: null, severity: null, reworkRate: null, baselineRate: null, standingRed: null, updated_at: '2026-10-05T00:00:00Z', heldCap: null, episode: null, ...overrides };
}

// ── updateThrottleEpisode (pure) ──────────────────────────────────────────

test('no episode opens when the fresh recommendation does not lower the cap', () => {
  const episode = updateThrottleEpisode(null, null, 6, '2026-10-05T00:00:00Z', fakeRec());
  assert.equal(episode, null);
});

test('an episode opens on the first run whose fresh recommendation lowers the cap', () => {
  const episode = updateThrottleEpisode(null, 1, 6, '2026-10-05T00:00:00Z', fakeRec({ recommendedCap: 1, severity: 'degraded' }));
  assert.ok(episode);
  assert.equal(episode.lowestCapReached, 1);
  assert.equal(episode.configuredCapAtOpen, 6);
  assert.equal(episode.clearedAtIso, null);
  assert.equal(episode.answer, null);
  // BL-1981 hardening: this fixture's severity ('degraded', no standingRed)
  // reaches bindingSignalName's REWORK branch - the acceptance suite only
  // ever opens an episode off a standing-red fixture, so this is the only
  // test to ever touch that branch at all. Hand-mutating its return value
  // left every BL-1981 test (unit, property, acceptance) green until this
  // assertion was added.
  assert.equal(episode.openingSignal, 'a degraded rework diagnosis');
});

test('an episode opened by a severe rework diagnosis (no standing-red) names "a severe rework diagnosis"', () => {
  const episode = updateThrottleEpisode(null, 0, 6, '2026-10-05T00:00:00Z', fakeRec({ recommendedCap: 0, severity: 'severe' }));
  assert.ok(episode);
  assert.equal(episode.openingSignal, 'a severe rework diagnosis');
});

test('an episode opened where both a standing-red signal and a rework diagnosis bind picks whichever cap is actually lower - rework when it alone is the binding one', () => {
  // standingCap (1) is NOT <= reworkCap (0) here, so the rework diagnosis
  // is the binding signal even though a standingRed block is present.
  const episode = updateThrottleEpisode(
    null,
    0,
    6,
    '2026-10-05T00:00:00Z',
    fakeRec({ recommendedCap: 0, severity: 'severe', standingRed: { signal: 'count', recommendedCap: 1 } })
  );
  assert.ok(episode);
  assert.equal(episode.openingSignal, 'a severe rework diagnosis');
});

test('an episode opened where a tied standing-red and degraded-rework cap both bind names the standing-red signal (the <= tie-break)', () => {
  // standingCap (1) IS <= reworkCap (1, degraded) here - the only branch
  // combination the two tests above do not reach.
  const episode = updateThrottleEpisode(
    null,
    1,
    6,
    '2026-10-05T00:00:00Z',
    fakeRec({ recommendedCap: 1, severity: 'degraded', standingRed: { signal: 'count', recommendedCap: 1 } })
  );
  assert.ok(episode);
  assert.equal(episode.openingSignal, describeStandingRedSignal('count'));
});

// BL-1981 hardening: a scoped Stryker run (unit lane only - the acceptance
// suite is a separate runner Stryker never sees) found this exact disjunct
// surviving: every test above has severity SET (reworkCap non-null), so
// `reworkCap === null` is always false already - forcing it to the literal
// `false` changes nothing THERE. No unit test ever opens an episode with
// NO rework signal at all (severity: null, reworkCap genuinely null) to
// prove the standing-red branch is taken via THIS disjunct specifically,
// not merely via the `<=` comparison.
test('an episode opened by a standing-red signal alone (no rework diagnosis at all) names the standing-red signal', () => {
  const episode = updateThrottleEpisode(
    null,
    1,
    6,
    '2026-10-05T00:00:00Z',
    fakeRec({ recommendedCap: 1, severity: null, standingRed: { signal: 'count', recommendedCap: 1 } })
  );
  assert.ok(episode);
  assert.equal(episode.openingSignal, describeStandingRedSignal('count'));
});

// BL-1981 hardening: a scoped Stryker run found `rawCap < configuredCap`
// survived weakened to `<=` - no test ever checks the exact boundary
// (a fresh recommendation EQUAL to the configured cap is not a lowering
// at all, so it must never open an episode).
test('a fresh recommendation equal to the configured cap never opens an episode - only a genuine lowering does', () => {
  const episode = updateThrottleEpisode(null, 6, 6, '2026-10-05T00:00:00Z', fakeRec({ recommendedCap: 6, severity: 'degraded' }));
  assert.equal(episode, null, 'a cap equal to configured is not a lowering - no episode should open');
});

// BL-1981 hardening: a scoped Stryker run found the whole
// `if (rawCap !== null) { lowestCapReached = min(...) }` update survived
// being deleted entirely - the existing severe-then-degraded test cannot
// discriminate this because min(0, 1) === 0 whether or not the update
// runs at all (the value happens to coincide either way). The REVERSE
// order - a degraded 1 first, THEN a severe 0 - requires the update to
// actually run: skipping it would wrongly leave lowestCapReached at 1.
test('BL-1981 invariant 2 (reverse order): a degraded 1 that worsens to a severe 0 lowers the held floor - the update must actually run, not just coincidentally agree', () => {
  let episode = updateThrottleEpisode(null, 1, 6, '2026-10-05T00:00:00Z', fakeRec({ recommendedCap: 1, severity: 'degraded' }));
  assert.equal(episode.lowestCapReached, 1);
  episode = updateThrottleEpisode(episode, 0, 6, '2026-10-05T00:05:00Z', fakeRec({ recommendedCap: 0, severity: 'severe' }));
  assert.equal(episode.lowestCapReached, 0, 'worsening to a severe 0 must actually lower the held floor, not leave it at the stale prior value');
});

test('BL-1981 invariant 2: a severe 0 that eases to a degraded 1 stays at 0 (the lowest cap reached, not the latest)', () => {
  let episode = updateThrottleEpisode(null, 0, 6, '2026-10-05T00:00:00Z', fakeRec({ recommendedCap: 0, severity: 'severe' }));
  assert.equal(episode.lowestCapReached, 0);
  episode = updateThrottleEpisode(episode, 1, 6, '2026-10-05T00:05:00Z', fakeRec({ recommendedCap: 1, severity: 'degraded' }));
  assert.equal(episode.lowestCapReached, 0, 'easing to a degraded 1 must not raise the held floor back up');
  assert.equal(heldCapForEpisode(episode), 0);
});

test('an unanswered episode records when its signal first clears, and holds at the lowest cap reached', () => {
  let episode = updateThrottleEpisode(null, 1, 6, '2026-10-05T00:00:00Z', fakeRec({ recommendedCap: 1, severity: 'degraded' }));
  episode = updateThrottleEpisode(episode, null, 6, '2026-10-05T00:05:00Z', fakeRec());
  assert.equal(episode.clearedAtIso, '2026-10-05T00:05:00Z');
  assert.equal(heldCapForEpisode(episode), 1);
});

// BL-1874 QA bounce D1: a failed refresh's forced-null rawCap must never be
// read as a genuine clear - "we could not check" is not "the signal is
// gone". Before this fix, a failed-refresh tick stamped clearedAtIso and
// wrongly raised BL-1982's human-release question on a diagnosis that
// never actually cleared.
test('a failed refresh leaves an open episode uncleared - its null cap is not a genuine clear', () => {
  let episode = updateThrottleEpisode(null, 0, 6, '2026-10-05T00:00:00Z', fakeRec({ recommendedCap: 0, severity: 'severe' }));
  episode = updateThrottleEpisode(episode, null, 6, '2026-10-05T00:05:00Z', fakeRec({ refreshFailureReason: 'EACCES: permission denied' }), true);
  assert.equal(episode.clearedAtIso, null, 'a failed refresh must not stamp clearedAtIso');
  assert.equal(heldCapForEpisode(episode), 0, 'the hold must still bind at the lowest cap reached');
});

test('a failed refresh never closes a released episode either - only a genuine withdrawal does', () => {
  let episode = updateThrottleEpisode(null, 0, 6, '2026-10-05T00:00:00Z', fakeRec({ recommendedCap: 0, severity: 'severe' }));
  episode = { ...episode, answer: { kind: 'release', by: 'human', at: '2026-10-05T00:04:00Z' } };
  const afterFailedRefresh = updateThrottleEpisode(episode, null, 6, '2026-10-05T00:05:00Z', fakeRec({ refreshFailureReason: 'EACCES' }), true);
  assert.notEqual(afterFailedRefresh, null, 'a released episode must survive a failed refresh - it did not actually withdraw');
  const afterGenuineClear = updateThrottleEpisode(episode, null, 6, '2026-10-05T00:06:00Z', fakeRec());
  assert.equal(afterGenuineClear, null, 'a genuine clear (no refresh failure) still closes a released episode as before');
});

test('clearedAtIso is set only once - a later idempotent clear does not overwrite the first clearing instant', () => {
  let episode = updateThrottleEpisode(null, 1, 6, '2026-10-05T00:00:00Z', fakeRec({ recommendedCap: 1, severity: 'degraded' }));
  episode = updateThrottleEpisode(episode, null, 6, '2026-10-05T00:05:00Z', fakeRec());
  episode = updateThrottleEpisode(episode, null, 6, '2026-10-05T00:10:00Z', fakeRec());
  assert.equal(episode.clearedAtIso, '2026-10-05T00:05:00Z');
});

// BL-2034: a re-tripped signal is LIVE again, not "awaiting release".
// Before the fix, clearedAtIso was stamped on the first clear and never
// reset, so a severe→clear→severe→clear episode read as awaiting release
// from the FIRST clear even though the second clear is what actually
// needs a human answer.
test('BL-2034: a re-tripped episode clears again from the SECOND clear - a live tick resets clearedAtIso', () => {
  let episode = updateThrottleEpisode(null, 0, 6, '2026-10-05T00:00:00Z', fakeRec({ recommendedCap: 0, severity: 'severe' }));
  // First clear.
  episode = updateThrottleEpisode(episode, null, 6, '2026-10-05T00:05:00Z', fakeRec());
  assert.equal(episode.clearedAtIso, '2026-10-05T00:05:00Z');
  // Re-trip: the signal is live again - the episode is live, not awaiting release.
  episode = updateThrottleEpisode(episode, 0, 6, '2026-10-05T00:10:00Z', fakeRec({ recommendedCap: 0, severity: 'severe' }));
  assert.equal(episode.clearedAtIso, null, 'a live tick must reset clearedAtIso - the episode is live again, not awaiting release');
  // Second clear: the awaiting-release instant is the SECOND clear, not the first.
  episode = updateThrottleEpisode(episode, null, 6, '2026-10-05T00:15:00Z', fakeRec());
  assert.equal(episode.clearedAtIso, '2026-10-05T00:15:00Z', 'the awaiting-release instant must be the second clear, not the first');
  // Invariant 2 still holds across the re-trip: the held floor is the lowest cap ever reached.
  assert.equal(episode.lowestCapReached, 0);
  assert.equal(heldCapForEpisode(episode), 0);
});

test('a release answer lifts the hold immediately (heldCap null) while the signal is still live', () => {
  let episode = updateThrottleEpisode(null, 1, 6, '2026-10-05T00:00:00Z', fakeRec({ recommendedCap: 1, severity: 'degraded' }));
  episode = { ...episode, answer: { kind: 'release', by: 'human', at: '2026-10-05T00:01:00Z' } };
  assert.equal(heldCapForEpisode(episode), null);
});

test('a released episode closes once its raw signal has actually withdrawn', () => {
  let episode = updateThrottleEpisode(null, 1, 6, '2026-10-05T00:00:00Z', fakeRec({ recommendedCap: 1, severity: 'degraded' }));
  episode = { ...episode, answer: { kind: 'release', by: 'human', at: '2026-10-05T00:01:00Z' } };
  // Signal still live - the episode must stay open (not yet withdrawn).
  episode = updateThrottleEpisode(episode, 1, 6, '2026-10-05T00:02:00Z', fakeRec({ recommendedCap: 1, severity: 'degraded' }));
  assert.ok(episode, 'a released episode must stay open until the raw signal actually clears');
  // Now the signal clears - the episode closes.
  episode = updateThrottleEpisode(episode, null, 6, '2026-10-05T00:03:00Z', fakeRec());
  assert.equal(episode, null);
});

test('a keep answer holds the given value and never auto-closes the episode', () => {
  let episode = updateThrottleEpisode(null, 1, 6, '2026-10-05T00:00:00Z', fakeRec({ recommendedCap: 1, severity: 'degraded' }));
  episode = updateThrottleEpisode(episode, null, 6, '2026-10-05T00:05:00Z', fakeRec());
  episode = { ...episode, answer: { kind: 'keep', value: 3, by: 'human', at: '2026-10-05T00:06:00Z' } };
  assert.equal(heldCapForEpisode(episode), 3);
  // A further idempotent tick with the signal still clear must not close it.
  episode = updateThrottleEpisode(episode, null, 6, '2026-10-05T00:10:00Z', fakeRec());
  assert.ok(episode, 'a kept episode must never auto-close');
  assert.equal(heldCapForEpisode(episode), 3);
});

// ── emitThrottleRecommendation integration (acceptance scenario 01's own log wording) ──

test('emitThrottleRecommendation logs "held at N for a human release" when an unanswered episode clears', () => {
  const targetPath = mkTmp();
  writeConfiguredCap(targetPath, 6);
  writeSignal(targetPath, { reworkRate: 0.3, baselineRate: 0.1 }); // degraded -> cap 1
  emitThrottleRecommendation(targetPath, Date.parse('2026-10-05T00:00:00Z'));

  writeSignal(targetPath, { reworkRate: 0.1, baselineRate: 0.1 }); // clears
  const cleared = emitThrottleRecommendation(targetPath, Date.parse('2026-10-05T00:05:00Z'));

  assert.equal(cleared.recommendedCap, null, 'the raw recommendation itself is still withdrawn (BL-1429 contract unchanged)');
  assert.equal(cleared.heldCap, 1, 'the effective hold must keep the cap at the lowest it reached');
  assert.ok(cleared.episode && cleared.episode.answer === null);

  const last = readChangeLogLines(targetPath).at(-1);
  assert.match(last.reason, /held at 1 for a human release/);
});

// BL-1874 QA bounce D1 repro: the exact shape of QA's own probe - a severe
// diagnosis opens a hold, then a tick whose refresh FAILS (not whose
// signal genuinely clears) must leave the episode open and the change-log
// reason must name the failure, never "rework diagnosis cleared".
test('emitThrottleRecommendation: a failed refresh never reads as a clear - the episode stays open and the log names the failure', () => {
  const targetPath = mkTmp();
  writeConfiguredCap(targetPath, 6);
  writeSignal(targetPath, { reworkRate: 1, baselineRate: 0.1 }); // severe -> cap 0
  const tick1 = emitThrottleRecommendation(targetPath, Date.parse('2026-10-06T00:00:00Z'));
  assert.equal(tick1.recommendedCap, 0);
  assert.ok(tick1.episode && tick1.episode.clearedAtIso === null);

  const tick2 = emitThrottleRecommendation(targetPath, Date.parse('2026-10-06T00:01:00Z'), 'EACCES: permission denied, mkdir .swarmforge/telemetry');

  assert.equal(tick2.recommendedCap, null, "a failed refresh's rework half is empty");
  assert.equal(tick2.heldCap, 0, 'the hold must still bind at the severe cap reached');
  assert.equal(tick2.episode.clearedAtIso, null, 'a failed refresh must not be read as the signal clearing');
  assert.equal(tick2.episode.answer, null);

  const last = readChangeLogLines(targetPath).at(-1);
  assert.doesNotMatch(last.reason, /cleared/, `must not read as a clear, got: ${last.reason}`);
  assert.match(last.reason, /refresh failed/);
  assert.ok(last.reason.includes('EACCES'), `expected the reason to name the failure, got: ${last.reason}`);
});

test('emitThrottleRecommendation persists heldCap/episode to the recommendation file (plain JSON, no extension dependency)', () => {
  const targetPath = mkTmp();
  writeConfiguredCap(targetPath, 6);
  writeSignal(targetPath, { reworkRate: 0.3, baselineRate: 0.1 });
  emitThrottleRecommendation(targetPath, Date.parse('2026-10-05T00:00:00Z'));
  writeSignal(targetPath, { reworkRate: 0.1, baselineRate: 0.1 });
  emitThrottleRecommendation(targetPath, Date.parse('2026-10-05T00:05:00Z'));

  const onDisk = JSON.parse(fs.readFileSync(throttleRecommendationPath(targetPath), 'utf8'));
  assert.equal(onDisk.heldCap, 1);
  assert.equal(onDisk.episode.lowestCapReached, 1);
});

test('emitThrottleRecommendation leaves heldCap/episode null when the recommendation never lowers the cap', () => {
  const targetPath = mkTmp();
  writeConfiguredCap(targetPath, 6);
  const rec = emitThrottleRecommendation(targetPath, Date.parse('2026-10-05T00:00:00Z'));
  assert.equal(rec.heldCap, null);
  assert.equal(rec.episode, null);
});

test('with no configured-cap file at all, the default configured cap (5) still opens an episode for a lower recommendation', () => {
  const targetPath = mkTmp();
  writeSignal(targetPath, { reworkRate: 0.3, baselineRate: 0.1 }); // degraded -> cap 1, below default 5
  const rec = emitThrottleRecommendation(targetPath, Date.parse('2026-10-05T00:00:00Z'));
  assert.ok(rec.episode);
  assert.equal(rec.episode.configuredCapAtOpen, 5);
});

// BL-1981 hardening: a scoped Stryker run found readConfiguredCap's own
// config-key string and its `raw !== undefined` parse branch BOTH
// survived - every existing test either passes configuredCap as a bare
// LITERAL straight into updateThrottleEpisode (never touching
// readConfiguredCap at all) or writes cap 6 through emitThrottleRecommendation
// without ever asserting configuredCapAtOpen reflects it (only heldCap/
// lowestCapReached are checked). A DIFFERENT, non-default, non-6 value
// closes the gap: if the config key or the parse were broken, this would
// silently read back the unrelated default (5) instead.
test('readConfiguredCap (via emitThrottleRecommendation) actually reads a written, non-default cap - not just the default fallback', () => {
  const targetPath = mkTmp();
  writeConfiguredCap(targetPath, 9);
  writeSignal(targetPath, { reworkRate: 0.3, baselineRate: 0.1 }); // degraded -> cap 1, below 9
  const rec = emitThrottleRecommendation(targetPath, Date.parse('2026-10-05T00:00:00Z'));
  assert.ok(rec.episode);
  assert.equal(rec.episode.configuredCapAtOpen, 9, 'expected the real written cap (9), not the unrelated default (5)');
});
