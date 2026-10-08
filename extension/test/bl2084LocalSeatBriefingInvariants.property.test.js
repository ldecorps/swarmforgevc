'use strict';

// BL-2084 declared invariants (coder-authored per BL-654 / coder.prompt):
//   1. "The briefing section is read-only to produce and the same records
//      always print the same section."
//   2. "Every number in the section comes from a record; a field no
//      record carries prints as unknown, never as 0."
//
// Drives the REAL local_seat_tuning_report_cli.bb --briefing mode (never
// a reimplementation of summarise-day/briefing-day-rows, which live only
// in local_seat_tuning_report_lib.bb) against real mkdtemp fixtures.
//
// GENERATOR REACH: both invariants are checked over an EXHAUSTIVE set of
// deliberately CONSTRUCTED day shapes - a day with zero tool-calls, a day
// with tool-calls that all succeed, one with some failing, and one with
// zero compressions - rather than a randomly sampled space (BL-1062/
// BL-2083's own rule: a space this small and this precisely about a
// nil-vs-zero boundary is constructed, never hoped for from a random
// draw). Every shape in the set below is asserted to appear at least once
// in the rendered output, so a generator that silently stopped producing
// one would fail loudly here, not pass by omission.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { mkTmpDir } = require('./helpers/tmpDir');

const REPO_ROOT = path.join(__dirname, '..', '..');
const CLI = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'local_seat_tuning_report_cli.bb');
const SEAT = 'coder@iq3';
const NOW = '2026-10-08T12:00:00Z';
const DAYS = 7;

function cwdKeyFor(root, seat) {
  const worktreePath = path.join(root, '.worktrees', seat.replace('@', '-'));
  return worktreePath.replace(/[/.]/g, '-');
}

function daysBeforeNowIso(daysAgo, minuteOffset = 0) {
  return new Date(Date.parse(NOW) - daysAgo * 86400000 + minuteOffset * 60000).toISOString();
}

function apiResponseRow(ts) {
  return {
    type: 'system',
    subtype: 'ui_telemetry',
    timestamp: ts,
    systemPayload: {
      uiEvent: {
        'event.name': 'qwen-code.api_response',
        ttft_ms: 1000,
        duration_ms: 2000,
        input_token_count: 100,
        output_token_count: 50,
        thoughts_token_count: 10,
      },
    },
  };
}

function toolCallRow(ts, success) {
  return {
    type: 'system',
    subtype: 'ui_telemetry',
    timestamp: ts,
    systemPayload: { uiEvent: { 'event.name': 'qwen-code.tool_call', function_name: 'run_shell_command', success } },
  };
}

function compressionRow(ts) {
  return {
    type: 'system',
    subtype: 'chat_compression',
    timestamp: ts,
    systemPayload: { info: { originalTokenCount: 1000, newTokenCount: 500 } },
  };
}

// Four deliberately constructed days, each isolating one nil-vs-zero
// boundary (see the header's GENERATOR REACH note): daysAgo chosen 2/4/5/6
// days back, each at least 1 day from either window edge (days=7) at the
// shared noon-UTC anchor, same margin reasoning as bl2084LocalSeatBriefingSteps.js.
const DAY_SHAPES = [
  {
    label: 'no tool-calls at all',
    daysAgo: 2,
    rows: (ts) => [apiResponseRow(ts(0))],
    expectUnknownFailureRate: true,
  },
  {
    label: 'tool-calls, all succeed',
    daysAgo: 4,
    rows: (ts) => [apiResponseRow(ts(0)), toolCallRow(ts(1), true), toolCallRow(ts(2), true)],
    expectUnknownFailureRate: false,
    expectZeroFailureRate: true,
  },
  {
    label: 'tool-calls, some fail',
    daysAgo: 5,
    rows: (ts) => [apiResponseRow(ts(0)), toolCallRow(ts(1), true), toolCallRow(ts(2), false)],
    expectUnknownFailureRate: false,
    expectZeroFailureRate: false,
  },
  {
    label: 'zero compressions',
    daysAgo: 6,
    rows: (ts) => [apiResponseRow(ts(0))],
    expectZeroCompressionsPerTen: true,
  },
];

function buildFixture() {
  const root = mkTmpDir('bl2084-prop-');
  const settingsDir = path.join(root, '.swarmforge', 'local-agent', 'seat-settings');
  const chatsDir = path.join(root, 'qwen-projects', cwdKeyFor(root, SEAT), 'chats');
  fs.mkdirSync(settingsDir, { recursive: true });
  fs.mkdirSync(chatsDir, { recursive: true });
  fs.writeFileSync(
    path.join(settingsDir, `${SEAT}.jsonl`),
    `${JSON.stringify({ at: daysBeforeNowIso(DAYS + 1), fingerprint: 'fp-only', gpu: { powerLimitW: 180, defaultPowerLimitW: 180 } })}\n`
  );
  DAY_SHAPES.forEach((shape, i) => {
    const ts = (minuteOffset) => daysBeforeNowIso(shape.daysAgo, minuteOffset);
    const rows = shape.rows(ts);
    fs.writeFileSync(path.join(chatsDir, `S${i + 1}.jsonl`), rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
  });
  return { root, chatsDir };
}

function runBriefing(root) {
  return execFileSync(
    'bb',
    [
      CLI,
      root,
      '--briefing',
      '--days',
      String(DAYS),
      '--now',
      NOW,
      '--qwen-projects-dir',
      path.join(root, 'qwen-projects'),
      '--ollama-log',
      path.join(root, 'ollama.log'),
    ],
    { encoding: 'utf8' }
  );
}

function rowForDaysAgo(output, daysAgo) {
  const date = daysBeforeNowIso(daysAgo).slice(0, 10);
  const line = output.split('\n').find((l) => l.startsWith(`| ${date} `));
  assert.ok(line, `no row for ${date} in:\n${output}`);
  return line
    .split('|')
    .map((c) => c.trim())
    .filter((c) => c.length > 0);
}

// Hashes every regular file's content under root, by relative path - a
// read-only run must leave every one of these byte-identical, proving
// "read-only" against the fixture's OWN data rather than trusting the
// CLI's own claim.
function hashTree(root) {
  const out = {};
  const walk = (dir) => {
    for (const name of fs.readdirSync(dir)) {
      const full = path.join(dir, name);
      const stat = fs.statSync(full);
      if (stat.isDirectory()) {
        walk(full);
      } else if (stat.isFile()) {
        out[path.relative(root, full)] = crypto.createHash('sha256').update(fs.readFileSync(full)).digest('hex');
      }
    }
  };
  walk(root);
  return out;
}

test('property (BL-2084 invariant 1): the briefing is read-only and the same records print the same section', () => {
  const { root } = buildFixture();
  const before = hashTree(root);

  const first = runBriefing(root);
  const after = hashTree(root);
  assert.deepEqual(after, before, 'the fixture tree changed after a --briefing run - it must be read-only');

  const second = runBriefing(root);
  assert.equal(second, first, 'the same records produced a different section on a second run');
});

test('property (BL-2084 invariant 2): a field no record carries prints unknown, never 0 - and a genuine zero prints 0, never unknown', () => {
  const { root } = buildFixture();
  const output = runBriefing(root);

  for (const shape of DAY_SHAPES) {
    const cells = rowForDaysAgo(output, shape.daysAgo);
    assert.equal(cells.length, 9, `${shape.label}: expected 9 cells, got ${cells.length}: ${cells.join('|')}`);
    const [, , , , , , , compressionsPerTen, failureRate] = cells;

    if (shape.expectUnknownFailureRate) {
      assert.equal(failureRate, 'unknown', `${shape.label}: expected tool-call failure rate "unknown" (no tool calls at all), got "${failureRate}"`);
    }
    if (shape.expectZeroFailureRate) {
      assert.equal(failureRate, '0%', `${shape.label}: expected a genuine 0% failure rate (tool calls ran, none failed), got "${failureRate}"`);
    }
    if (shape.expectUnknownFailureRate === false && !shape.expectZeroFailureRate) {
      assert.notEqual(failureRate, 'unknown', `${shape.label}: tool calls happened, failure rate must not read "unknown"`);
      assert.notEqual(failureRate, '0%', `${shape.label}: some tool calls failed, failure rate must not read "0%"`);
    }
    if (shape.expectZeroCompressionsPerTen) {
      assert.equal(compressionsPerTen, '0', `${shape.label}: expected a genuine 0 compressions/10 (requests happened, no compressions), got "${compressionsPerTen}"`);
    }
  }
});
