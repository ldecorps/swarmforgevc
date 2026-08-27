const assert = require('node:assert/strict');
const { formatBurnSectionText, USAGE_ANCHOR_COMMAND } = require('../out/metrics/burnSectionText');

// BL-619: pure formatting layer over burnProjection.ts's BurnSectionResult.

// warning-leads-briefing-01/04
test('BL-619 warning-leads-briefing-01: warn produces leadingText naming the run-out time, rate, and both levers', () => {
  const result = { kind: 'warn', ratePctPerDay: 23, runOutAtMs: Date.parse('2026-07-27T13:20:52.000Z') };
  const text = formatBurnSectionText(result, 'all-models');
  assert.equal(text.subjectMarker, true);
  assert.equal(text.appendedText, null);
  assert.match(text.leadingText, /2026-07-27T13:20:52/);
  assert.match(text.leadingText, /23\.0%\/day/);
  assert.match(text.leadingText, /pauses usage/);
  assert.match(text.leadingText, /throttles/);
  assert.match(text.leadingText, /control-pause\.json/);
  assert.match(text.leadingText, /cooldown window/);
  assert.match(text.leadingText, /active_backlog_max_depth/);
});

// ok-path-one-line-status-03
test('BL-619 ok-path-one-line-status-03: ok produces a single appended line, no leading text, no subject marker', () => {
  const result = { kind: 'ok', ratePctPerDay: 4.8 };
  const text = formatBurnSectionText(result, 'all-models');
  assert.equal(text.subjectMarker, false);
  assert.equal(text.leadingText, null);
  assert.equal(text.appendedText.split('\n').length, 1);
  assert.match(text.appendedText, /4\.8%\/day/);
});

// no-anchor-never-fabricates-06
test('BL-619 no-anchor-never-fabricates-06: no-anchor names local burn and the anchor command, never a percentage claim', () => {
  const result = { kind: 'no-anchor', localBurnRateTokensPerHour: 2500 };
  const text = formatBurnSectionText(result, 'all-models');
  assert.equal(text.subjectMarker, false);
  assert.equal(text.leadingText, null);
  assert.match(text.appendedText, /2500 tokens\/hr/);
  assert.match(text.appendedText, /unavailable/);
  assert.ok(text.appendedText.includes(USAGE_ANCHOR_COMMAND));
  assert.doesNotMatch(text.appendedText, /projected to exhaust/);
});

// malformed-reset-config-08
test('BL-619 malformed-reset-config-08: malformed reports local-burn-only and carries the warning text', () => {
  const result = { kind: 'malformed', localBurnRateTokensPerHour: 1500, warning: 'malformed usage week reset config: day=funday local=(default)' };
  const text = formatBurnSectionText(result, 'all-models');
  assert.equal(text.subjectMarker, false);
  assert.equal(text.leadingText, null);
  assert.match(text.appendedText, /1500 tokens\/hr/);
  assert.equal(text.warning, result.warning);
  assert.ok(text.appendedText.includes(result.warning));
});
