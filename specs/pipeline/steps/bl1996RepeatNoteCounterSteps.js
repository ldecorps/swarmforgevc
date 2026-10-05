'use strict';

// BL-1996: step handlers for the REPEAT-note counter check 5b will use
// (BL-1997). Drives the REAL local_seat_report_lib.bb functions
// (repeat-notes-since / current-session-repeat-notes), never a
// restatement of the count or the line-start regex - the handler shape
// `specs/pipeline/steps/bl970BusyGateSteps.js` uses (load-file the lib
// via `bb -e`, call one function, assert on what it prints). Session
// text is written into a tracked tmp root per scenario, never kept as a
// fixture file in the repo.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const { trackedTmpRoot } = require('./lib/fixtureReaper');

const FEATURE = "BL-1996 A local seat's REPEAT notes are counted from its progress origin, never from text it read";

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const LIB = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'local_seat_report_lib.bb');

const ORIGIN_ISO = '2026-10-05T13:00:00.000Z';
const BEFORE_ISO = '2026-10-05T10:00:00.000Z';
const AFTER_ISO = '2026-10-05T13:10:00.000Z';

function repeatNoteLine(n) {
  return `REPEAT: you have now made this exact read_file call ${n} times since your last edit`;
}

function quotedPhraseLine(n) {
  // Quotes the phrase inside text the seat read (a grep hit, a file
  // excerpt) - never as the line's own start, so it must NOT count.
  return `grep -n "REPEAT: you have now made this exact read_file call ${n} times" swarmforge/scripts/local_model_repeat_guard.bb`;
}

function toolResultLine(iso, output) {
  return JSON.stringify({
    type: 'tool_result',
    timestamp: iso,
    message: { parts: [{ functionResponse: { response: { output } } }] },
  });
}

function callLib(fnCall) {
  const res = spawnSync('bb', ['-e', `(load-file ${JSON.stringify(LIB)}) (print ${fnCall})`], {
    encoding: 'utf8',
    timeout: 60000,
  });
  assert.equal(res.status, 0, `lib call failed: ${res.stderr}`);
  const n = Number(res.stdout.trim());
  assert.ok(Number.isInteger(n), `expected an integer count, got: ${JSON.stringify(res.stdout)}`);
  return n;
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  // ── Scenario 01 ──────────────────────────────────────────────────────
  scoped(
    /^a qwen session with (\d+) REPEAT notes stamped before the origin and (\d+) stamped at or after it$/,
    (ctx, beforeCount, atOrAfterCount) => {
      const lines = [];
      for (let i = 0; i < Number(beforeCount); i += 1) {
        lines.push(toolResultLine(BEFORE_ISO, repeatNoteLine(i + 1)));
      }
      for (let i = 0; i < Number(atOrAfterCount); i += 1) {
        // Half at exactly the origin instant, half after - both count.
        const iso = i % 2 === 0 ? ORIGIN_ISO : AFTER_ISO;
        lines.push(toolResultLine(iso, repeatNoteLine(i + 1)));
      }
      ctx.bl1996 = { chatJsonl: lines.join('\n') + '\n' };
    }
  );

  // ── Scenario 02 ──────────────────────────────────────────────────────
  scoped(
    /^a qwen session with (\d+) REPEAT notes after the origin and (\d+) tool results after it that quote the phrase inside the text they read$/,
    (ctx, noteCount, quotedCount) => {
      const lines = [];
      for (let i = 0; i < Number(noteCount); i += 1) {
        lines.push(toolResultLine(AFTER_ISO, repeatNoteLine(i + 1)));
      }
      for (let i = 0; i < Number(quotedCount); i += 1) {
        lines.push(toolResultLine(AFTER_ISO, quotedPhraseLine(i + 1)));
      }
      ctx.bl1996 = { chatJsonl: lines.join('\n') + '\n' };
    }
  );

  // ── shared When/Then for scenarios 01/02 ────────────────────────────
  scoped(/^the REPEAT notes since the origin are counted$/, (ctx) => {
    const root = trackedTmpRoot('sfvc-bl1996-');
    const sessionPath = path.join(root, 'session.jsonl');
    fs.writeFileSync(sessionPath, ctx.bl1996.chatJsonl);
    const originMs = Date.parse(ORIGIN_ISO);
    ctx.bl1996.count = callLib(
      `(local-seat-report-lib/repeat-notes-since (slurp ${JSON.stringify(sessionPath)}) ${originMs})`
    );
  });

  // ── Scenario 03 ──────────────────────────────────────────────────────
  scoped(/^a worktree with no qwen session directory$/, (ctx) => {
    const projectsDir = trackedTmpRoot('sfvc-bl1996-projects-');
    ctx.bl1996 = { projectsDir, worktree: '/no/such/worktree-for-bl1996' };
  });

  scoped(/^the REPEAT notes in its current session are counted$/, (ctx) => {
    const originMs = Date.parse(ORIGIN_ISO);
    ctx.bl1996.count = callLib(
      `(local-seat-report-lib/current-session-repeat-notes ${JSON.stringify(ctx.bl1996.projectsDir)} ${JSON.stringify(
        ctx.bl1996.worktree
      )} ${originMs})`
    );
  });

  // ── shared Then ──────────────────────────────────────────────────────
  scoped(/^the count is (\d+)$/, (ctx, expected) => {
    assert.equal(ctx.bl1996.count, Number(expected), `expected a count of ${expected}, got ${ctx.bl1996.count}`);
  });
}

module.exports = { registerSteps };
