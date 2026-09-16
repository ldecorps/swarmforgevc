'use strict';

// BL-1493: step handlers for "the delivery hop's usage lookup reads what
// it needs, never the whole log". Drives the REAL
// context-telemetry-store/latest-event-for-role via a small bb CLI
// (specs/pipeline/steps/lib/bl1493UsageLookupCli.bb) that rebinds the
// lib's own *read-tail-chunk* seam to count bytes - never a
// reimplementation of the lookup's chunk-growth logic or a restated byte
// count.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { mkSocketFixtureRoot, releaseSocketFixtureRoot } = require('./lib/socketFixtureRoot');

const FEATURE = "BL-1493 the delivery hop's usage lookup reads what it needs, never the whole log";

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const CLI = path.join(__dirname, 'lib', 'bl1493UsageLookupCli.bb');

const ROW_COUNT = 200000;
const OTHER_ROLE = 'someoneelse';

function jsonlLine(event) {
  return `${JSON.stringify(event)}\n`;
}

function baseEvent(role, i) {
  return {
    role,
    timestamp: '2026-09-08T10:00:00Z',
    model: 'claude-sonnet-5',
    provider: 'anthropic',
    input_tokens: 1,
    output_tokens: 1,
    seq: i,
  };
}

// Writes ROW_COUNT rows, all OTHER_ROLE except roleAtIndex (if given),
// which is written at exactly that 0-based row index - the ticket's own
// "N rows from the end" language means index (ROW_COUNT - N). Batched
// into chunks (never one syscall per row, never one giant string) so a
// 200 000-row fixture builds in under a second.
function writeLog(telemetryDir, roleAtIndex) {
  fs.mkdirSync(telemetryDir, { recursive: true });
  const file = path.join(telemetryDir, 'context-events.jsonl');
  const fd = fs.openSync(file, 'w');
  const CHUNK = 5000;
  try {
    let buf = '';
    for (let i = 0; i < ROW_COUNT; i += 1) {
      const role = roleAtIndex && i === roleAtIndex.index ? roleAtIndex.role : OTHER_ROLE;
      buf += jsonlLine(baseEvent(role, i));
      if ((i + 1) % CHUNK === 0) {
        fs.writeSync(fd, buf);
        buf = '';
      }
    }
    if (buf.length > 0) fs.writeSync(fd, buf);
  } finally {
    fs.closeSync(fd);
  }
  return file;
}

// The independent "full read" reference this scenario checks the bounded
// lookup against - filter by role, keep append order, take last. Plain
// JS over the file's own JSONL text, never a call into the SUT's own
// (optimized) implementation. A line that fails to parse (scenario 03's
// own NUL-byte tail has no newline of its own, so it reads as one long
// non-blank "line") is skipped, the same BL-1477 tolerant-read posture
// the production store applies - never a crash on damaged content this
// reference is specifically meant to see PAST.
function referenceLatest(file, role) {
  const lines = fs.readFileSync(file, 'utf8').split('\n').filter((l) => l.replace(/\0/g, '').trim().length > 0);
  let latest = null;
  for (const line of lines) {
    let parsed;
    try {
      parsed = JSON.parse(line.replace(/\0/g, ''));
    } catch {
      continue;
    }
    if (parsed && parsed.role === role) latest = parsed;
  }
  return latest;
}

function runLookup(telemetryDir, role) {
  const out = execFileSync('bb', [CLI, telemetryDir, role], { encoding: 'utf8', cwd: REPO_ROOT });
  return JSON.parse(out);
}

function registerSteps(registry) {
  const scoped = (pattern, handler) => registry.defineScoped(pattern, handler, FEATURE);

  scoped(/^a context-events log of 200000 rows whose byte reads are counted$/, (ctx) => {
    const root = mkSocketFixtureRoot('bl1493-usage-lookup-');
    ctx.bl1493root = root;
    ctx.bl1493telemetryDir = path.join(root, 'telemetry');
    // A plain background log, no role of interest placed yet - each
    // scenario's own Given (or absence of one) decides what, if
    // anything, is customized before the lookup runs.
    ctx.bl1493file = writeLog(ctx.bl1493telemetryDir, null);
  });

  scoped(/^the latest row for role "([^"]+)" is (\d+) rows from the end$/, (ctx, role, n) => {
    const index = ROW_COUNT - Number(n);
    ctx.bl1493file = writeLog(ctx.bl1493telemetryDir, { role, index });
  });

  scoped(/^the log ends in (\d+) NUL bytes after the latest row for role "([^"]+)"$/, (ctx, nulCount, role) => {
    // The role's latest row sits 10 rows from the end - close enough to
    // the tail that the NUL corruption after it stays within the
    // lookup's own first (smallest) read chunk, the case this scenario
    // means to exercise (BL-1477's shape: a torn tail must not hide an
    // intact row that precedes it).
    const index = ROW_COUNT - 10;
    ctx.bl1493file = writeLog(ctx.bl1493telemetryDir, { role, index });
    const nulBuf = Buffer.alloc(Number(nulCount), 0);
    fs.appendFileSync(ctx.bl1493file, nulBuf);
  });

  scoped(/^the delivery hop looks up the latest usage for "([^"]+)"$/, (ctx, role) => {
    ctx.bl1493role = role;
    ctx.bl1493lookup = runLookup(ctx.bl1493telemetryDir, role);
    // Computed here, before cleanup below removes the fixture file - the
    // Then steps read only this captured value, never the file again.
    ctx.bl1493expected = referenceLatest(ctx.bl1493file, role);
    try {
      releaseSocketFixtureRoot(ctx.bl1493root);
      fs.rmSync(ctx.bl1493root, { recursive: true, force: true });
    } catch {
      // best-effort cleanup, never masks the assertions below
    }
  });

  scoped(/^the result equals the answer a full read of the log gives$/, (ctx) => {
    assert.deepEqual(
      ctx.bl1493lookup.result,
      ctx.bl1493expected,
      `bounded lookup result did not match the full-read reference:\n  bounded: ${JSON.stringify(ctx.bl1493lookup.result)}\n  full read: ${JSON.stringify(ctx.bl1493expected)}`
    );
  });

  scoped(/^fewer than 5 percent of the log's bytes were read$/, (ctx) => {
    const { bytesRead, fileLen } = ctx.bl1493lookup;
    assert.ok(fileLen > 0, 'fileLen was not reported by the CLI');
    const pct = (100 * bytesRead) / fileLen;
    assert.ok(pct < 5, `expected under 5% of the log's bytes read, got ${pct.toFixed(3)}% (${bytesRead} of ${fileLen} bytes)`);
  });

  scoped(/^the result is nil$/, (ctx) => {
    assert.equal(ctx.bl1493lookup.result, null, `expected a nil result, got: ${JSON.stringify(ctx.bl1493lookup.result)}`);
  });
}

module.exports = { registerSteps };
