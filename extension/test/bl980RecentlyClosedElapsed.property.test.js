'use strict';

// BL-980 invariant: an age is never fabricated — a line carries a parenthetical
// age only when a durable closure instant is recorded for that ticket.

const fc = require('fast-check');
const assert = require('node:assert/strict');

const {
  computePipelineBoard,
  formatRecentlyClosedAgeLabel,
  renderPipelineBoardBody,
} = require('../out/concierge/pipelineBoard');

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

function recentlyClosedLine(body, displayId) {
  return recentlyClosedLines(body).find((line) => new RegExp(`^ {2}${displayId}( |$)`).test(line));
}

function recentlyClosedLines(body) {
  const lines = body.split('\n');
  const start = lines.indexOf('RECENTLY CLOSED:');
  if (start === -1) {
    return [];
  }
  const out = [];
  for (let i = start + 1; i < lines.length; i++) {
    if (lines[i] === '' || /^[A-Z][A-Z ]*:$/.test(lines[i])) {
      break;
    }
    out.push(lines[i]);
  }
  return out;
}

test('property: no closedAtMs means no parenthetical age on the line', () => {
  fc.assert(
    fc.property(fc.integer({ min: 1, max: 9999 }), fc.string({ minLength: 1, maxLength: 40 }), (num, slug) => {
      const id = `BL-${num}`;
      const nowMs = Date.UTC(2026, 0, 1, 12, 0, 0);
      const data = computePipelineBoard({}, [], {}, {
        nowMs,
        recentlyClosed: [{ id, title: slug, filename: `${id}.yaml` }],
      });
      const line = recentlyClosedLine(renderPipelineBoardBody(data), String(num));
      assert.ok(line, `expected a line for ${id}`);
      assert.doesNotMatch(line, /\([^)]*\)/);
    })
  );
});

test('property: when closedAtMs is recorded the suffix matches formatRecentlyClosedAgeLabel', () => {
  fc.assert(
    fc.property(
      fc.integer({ min: 1, max: 9999 }),
      fc.integer({ min: 0, max: 14 * DAY_MS }),
      (num, elapsedMs) => {
        const id = `BL-${num}`;
        const nowMs = Date.UTC(2026, 0, 1, 12, 0, 0);
        const closedAtMs = nowMs - elapsedMs;
        const expected = formatRecentlyClosedAgeLabel(closedAtMs, nowMs);
        const data = computePipelineBoard({}, [], {}, {
          nowMs,
          recentlyClosed: [{ id, title: 'ticket', filename: `${id}.yaml`, closedAtMs }],
        });
        const line = recentlyClosedLine(renderPipelineBoardBody(data), String(num));
        assert.ok(line);
        if (expected === undefined) {
          assert.doesNotMatch(line, /\([^)]*\)/);
        } else {
          assert.match(line, new RegExp(`\\(${expected.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\)$`));
        }
      }
    )
  );
});
