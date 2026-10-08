'use strict';

// BL-2084: step handlers for "The tuning report's briefing mode prints
// each local seat's days" (BL-1854's scenarios 01/04, split out). Drives
// the REAL local_seat_tuning_report_cli.bb --briefing mode via a real
// mkdtemp fixture - never a reimplementation of briefing-window,
// briefing-day-rows or summarise-day, which live only in
// local_seat_tuning_report_lib.bb. Fixtures under mkdtemp, paths passed
// as arguments (--qwen-projects-dir, --ollama-log) so this never reads
// the operator's real ~/.qwen (the ticket's own constraint).
//
// BL-2085 reuses this file's Background ("a fixture root holding...") and
// When ("the tuning report runs with --briefing") step shapes - copy the
// fixture helpers below into that ticket's own handler file rather than
// importing across handler files (house convention).

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { mkProcessTmpDir } = require('../../../extension/test/helpers/tmpDir');

const FEATURE = "BL-2084 The tuning report's briefing mode prints each local seat's days";
const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const SCRIPTS = path.join(REPO_ROOT, 'swarmforge', 'scripts');
const CLI = path.join(SCRIPTS, 'local_seat_tuning_report_cli.bb');

// now is a fixed noon-UTC instant: every test timestamp below sits at
// least 2 days away from either window edge (days=7) at the SAME
// noon-UTC anchor, so the host's own local timezone (ZoneId/systemDefault,
// never injectable - local-date-of/briefing-window both read it) can
// never push a chosen day across a window boundary or into the wrong
// calendar date for any realistic offset (-12..+14h, well under the
// 2-day/48h margin built in here).
const NOW = '2026-10-08T12:00:00Z';
const DAYS = 7;

// Mirrors local-seat-report-lib/seat-worktree-path + qwen-cwd-key exactly
// (never a hardcoded guess at the key) - the real CLI computes the SAME
// key from the SAME root, and the fixture must land its chat files where
// that computation will actually look.
function cwdKeyFor(root, seat) {
  const worktreePath = path.join(root, '.worktrees', seat.replace('@', '-'));
  return worktreePath.replace(/[/.]/g, '-');
}

function daysBeforeNowIso(daysAgo, minuteOffset = 0) {
  const base = Date.parse(NOW) - daysAgo * 86400000 + minuteOffset * 60000;
  return new Date(base).toISOString();
}

function ensure(ctx) {
  if (!ctx.bl2084) {
    const root = mkProcessTmpDir('bl2084acc-');
    fs.mkdirSync(path.join(root, '.swarmforge', 'local-agent', 'seat-settings'), { recursive: true });
    ctx.bl2084 = { root, seats: {} };
  }
  return ctx.bl2084;
}

function settingsFileFor(fx, seat) {
  return path.join(fx.root, '.swarmforge', 'local-agent', 'seat-settings', `${seat}.jsonl`);
}

function chatsDirFor(fx, seat) {
  return path.join(fx.root, 'qwen-projects', cwdKeyFor(fx.root, seat), 'chats');
}

function ensureSeat(fx, seat) {
  if (!fx.seats[seat]) {
    const chatsDir = chatsDirFor(fx, seat);
    fs.mkdirSync(chatsDir, { recursive: true });
    const settingsFile = settingsFileFor(fx, seat);
    // One settings row is enough to give every request a resolvable
    // fingerprint - this ticket's table is not about settings grouping
    // (BL-1851 owns that), so every request here rides the same row.
    fs.writeFileSync(settingsFile, `${JSON.stringify({ at: daysBeforeNowIso(DAYS + 1), fingerprint: 'fp-only', gpu: { powerLimitW: 180, defaultPowerLimitW: 180 } })}\n`);
    fx.seats[seat] = { chatsDir, sessionCounter: 0 };
  }
  return fx.seats[seat];
}

function apiResponseRow(ts, ttftMs, durationMs, inTok, outTok, thinkTok) {
  return {
    type: 'system',
    subtype: 'ui_telemetry',
    timestamp: ts,
    systemPayload: {
      uiEvent: {
        'event.name': 'qwen-code.api_response',
        ttft_ms: ttftMs,
        duration_ms: durationMs,
        input_token_count: inTok,
        output_token_count: outTok,
        thoughts_token_count: thinkTok,
      },
    },
  };
}

function writeDayOfRequests(fx, seat, daysAgo, count) {
  const seatFx = ensureSeat(fx, seat);
  seatFx.sessionCounter += 1;
  const file = path.join(seatFx.chatsDir, `S${seatFx.sessionCounter}.jsonl`);
  const rows = [];
  for (let i = 0; i < count; i += 1) {
    rows.push(apiResponseRow(daysBeforeNowIso(daysAgo, i), 1000, 2000, 100, 50, 10));
  }
  fs.writeFileSync(file, rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
}

// Drives the REAL, standalone local_seat_tuning_report_cli.bb exactly as a
// person would (real argv, real -main) - never `load-file`d, which would
// also run its own trailing (-main (cli-args)) against THIS process's
// empty *command-line-args* and exit before --briefing's own render could
// be captured.
function runBriefing(fx) {
  const out = execFileSync(
    'bb',
    [
      CLI,
      fx.root,
      '--briefing',
      '--days',
      String(DAYS),
      '--now',
      NOW,
      '--qwen-projects-dir',
      path.join(fx.root, 'qwen-projects'),
      '--ollama-log',
      path.join(fx.root, 'ollama.log'),
    ],
    { encoding: 'utf8' }
  );
  fx.output = out;
  return out;
}

function seatSection(output, seat) {
  const marker = `### ${seat}`;
  const start = output.indexOf(marker);
  if (start < 0) return null;
  const rest = output.slice(start + marker.length);
  const next = rest.search(/\n### /);
  return marker + (next < 0 ? rest : rest.slice(0, next));
}

function tableDataRows(section) {
  return section
    .split('\n')
    .filter((line) => line.startsWith('| ') && !line.startsWith('|---'))
    .filter((line) => !/\| Date \|/.test(line));
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  // ── Background ──────────────────────────────────────────────────────
  scoped(/^a fixture root holding settings records, qwen session records and an Ollama log$/, (ctx) => {
    ensure(ctx);
  });

  // ── one-row-per-day-per-seat-01 ───────────────────────────────────────
  scoped(/^"([^"]+)" made requests on (\d+) of the last (\d+) days$/, (ctx, seat, dayCount, windowDays) => {
    const fx = ensure(ctx);
    assert.equal(Number(windowDays), DAYS, 'fixture/scenario window mismatch');
    // 2, 4, 6 days ago for dayCount=3 - each at least 2 days inside both
    // window edges (see the NOW/DAYS comment above for the margin math).
    const offsets = Array.from({ length: Number(dayCount) }, (_, i) => 2 + i * 2);
    for (const daysAgo of offsets) {
      writeDayOfRequests(fx, seat, daysAgo, 3);
    }
    fx.lastSeat = seat;
    fx.lastDayCount = Number(dayCount);
  });

  // ── no-local-seat-is-one-line-02 ──────────────────────────────────────
  scoped(/^no local-model seat made a request in the last (\d+) days$/, (ctx, windowDays) => {
    ensure(ctx);
    assert.equal(Number(windowDays), DAYS, 'fixture/scenario window mismatch');
    // The Background already built an empty seat-settings/ dir and
    // nothing has written a .jsonl into it - settings-record-seats finds
    // no seat at all, which is exactly this scenario's own premise.
  });

  // ── When (shared) ─────────────────────────────────────────────────────
  scoped(/^the tuning report runs with --briefing$/, (ctx) => {
    runBriefing(ensure(ctx));
  });

  // ── Then ────────────────────────────────────────────────────────────
  scoped(/^the section has a table for "([^"]+)" with one row for each of those (\d+) days$/, (ctx, seat, dayCount) => {
    const { output } = ensure(ctx);
    const section = seatSection(output, seat);
    assert.ok(section, `no "### ${seat}" section in:\n${output}`);
    const rows = tableDataRows(section);
    assert.equal(rows.length, Number(dayCount), `expected ${dayCount} day row(s), got ${rows.length}:\n${section}`);
  });

  scoped(
    /^each row reads requests, median time to first token, prefill and decode speed, median output tokens, thinking share, compressions per 10 requests and tool-call failure rate$/,
    (ctx) => {
      const { output, lastSeat } = ensure(ctx);
      const section = seatSection(output, lastSeat);
      const rows = tableDataRows(section);
      assert.ok(rows.length > 0, `no data rows to check:\n${section}`);
      for (const row of rows) {
        const cells = row
          .split('|')
          .map((c) => c.trim())
          .filter((c) => c.length > 0);
        // Date, Requests, TTFT, prefill, decode, output, thinking, compressions/10, failure rate
        assert.equal(cells.length, 9, `expected 9 cells, got ${cells.length}: ${row}`);
        const [, requests, ttft, prefill, decode, outputTok, thinking, compressions, failureRate] = cells;
        assert.match(requests, /^\d+$/, `requests cell not a number: ${row}`);
        assert.match(ttft, /s$|^unknown$/, `ttft cell malformed: ${row}`);
        assert.match(prefill, /tokens\/s$|^unknown$/, `prefill cell malformed: ${row}`);
        assert.match(decode, /tokens\/s$|^unknown$/, `decode cell malformed: ${row}`);
        assert.match(outputTok, /tokens$|^unknown$/, `output cell malformed: ${row}`);
        assert.match(thinking, /%$|^unknown$/, `thinking cell malformed: ${row}`);
        assert.ok(compressions.length > 0, `compressions cell empty: ${row}`);
        assert.match(failureRate, /%$|^unknown$/, `failure-rate cell malformed: ${row}`);
      }
    }
  );

  scoped(/^the section is the single line "([^"]+)"$/, (ctx, text) => {
    const { output } = ensure(ctx);
    assert.equal(output.trim(), text);
  });
}

module.exports = { registerSteps };
