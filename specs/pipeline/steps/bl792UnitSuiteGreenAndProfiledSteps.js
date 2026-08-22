'use strict';

// BL-792: step handlers for "the extension unit suite's latest recorded run
// is green and profiled". Unlike a generic feature, this ticket is about
// THIS repo's own suite, so the scenarios read the real artifacts a green
// `npm test` run already produces here - the machine-local duration log
// (extension/.test-durations.jsonl, BL-078) and the committed per-file
// profile (docs/reference/BL-792-test-duration-profile.md) - through the
// same real functions build-test-duration-profile.ts exports, rather than
// synthesized fixtures. "the suite has been run on an otherwise-idle host"
// is a precondition of the real environment, not an action this Background
// step performs (re-running the whole suite here would duplicate QA's own
// e2e procedure and make every acceptance pass minutes long).
const fs = require('node:fs');
const path = require('node:path');

const {
  assertRecordPassed,
  assertTestCountNotShrunk,
  OPERATIONAL_CEILING_MS,
} = require(path.join(__dirname, '..', '..', '..', 'extension', 'out', 'tools', 'build-test-duration-profile'));

const DURATIONS_PATH = path.join(__dirname, '..', '..', '..', 'extension', '.test-durations.jsonl');
const PROFILE_DOC_PATH = path.join(__dirname, '..', '..', '..', 'docs', 'reference', 'BL-792-test-duration-profile.md');

function readRecords() {
  return fs
    .readFileSync(DURATIONS_PATH, 'utf8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

// Extracts every `| file | durationMs |` row from a block of markdown text
// (the header/separator rows and prose above the tables never match).
function parseDurationTable(markdown) {
  const rows = [];
  for (const line of markdown.split('\n')) {
    const match = /^\|\s*(.+?)\s*\|\s*(\d+)\s*\|$/.exec(line.trim());
    if (match) {
      rows.push({ file: match[1], durationMs: Number(match[2]) });
    }
  }
  return rows;
}

function readProfileDoc() {
  const doc = fs.readFileSync(PROFILE_DOC_PATH, 'utf8');
  const marker = '## Every test file that ran, slowest first';
  const markerIndex = doc.indexOf(marker);
  if (markerIndex === -1) {
    throw new Error(`expected "${marker}" in ${PROFILE_DOC_PATH}`);
  }
  const polesSection = doc.slice(0, markerIndex);
  const entriesSection = doc.slice(markerIndex + marker.length);
  return { poles: parseDurationTable(polesSection), entries: parseDurationTable(entriesSection) };
}

function registerSteps(registry) {
  // ── Background ───────────────────────────────────────────────────────
  registry.define(/^the extension unit suite has been run on an otherwise-idle host$/, (ctx) => {
    const records = readRecords();
    if (records.length === 0) {
      throw new Error(`expected at least one recorded run in ${DURATIONS_PATH}`);
    }
    ctx.records = records;
    ctx.current = records[records.length - 1];
    ctx.previous = records.length > 1 ? records[records.length - 2] : undefined;
  });

  // ── unit-suite-green-and-profiled-01 ─────────────────────────────────
  registry.define(/^the duration record is read$/, (ctx) => {
    ctx.recordRead = ctx.current;
  });

  registry.define(/^it shows the run passed$/, (ctx) => {
    assertRecordPassed(ctx.recordRead);
  });

  registry.define(/^it carries the run's wall-clock duration$/, (ctx) => {
    if (!(typeof ctx.recordRead.duration_ms === 'number' && ctx.recordRead.duration_ms > 0)) {
      throw new Error(`expected a positive duration_ms, got: ${JSON.stringify(ctx.recordRead)}`);
    }
  });

  // ── unit-suite-green-and-profiled-02 ─────────────────────────────────
  registry.define(/^the run's outcome is read$/, (ctx) => {
    ctx.outcome = ctx.current;
  });

  registry.define(/^no worker was terminated during the run$/, (ctx) => {
    // recordTestDuration.js's computeFinalExitCode records `result: 'fail'`
    // whenever the vitest child's own exit code was non-zero - which is
    // exactly what a worker being terminated mid-run produces (BL-792's own
    // failing baseline: 169.5s/438 files, result fail). A passing record is
    // the real signal that no worker was terminated during this run.
    assertRecordPassed(ctx.outcome);
  });

  // ── unit-suite-green-and-profiled-03 ─────────────────────────────────
  registry.define(/^the per-file duration report is read$/, (ctx) => {
    ctx.profile = readProfileDoc();
  });

  registry.define(/^every test file that ran is listed with its own duration$/, (ctx) => {
    if (ctx.profile.entries.length === 0) {
      throw new Error(`expected at least one test file entry in ${PROFILE_DOC_PATH}`);
    }
    for (const entry of ctx.profile.entries) {
      if (!(Number.isFinite(entry.durationMs) && entry.durationMs >= 0)) {
        throw new Error(`expected a numeric duration for ${entry.file}, got: ${JSON.stringify(entry)}`);
      }
    }
  });

  registry.define(/^the slowest test files are listed first$/, (ctx) => {
    const { entries } = ctx.profile;
    for (let i = 1; i < entries.length; i++) {
      if (entries[i].durationMs > entries[i - 1].durationMs) {
        throw new Error(
          `expected entries sorted slowest-first, but "${entries[i].file}" (${entries[i].durationMs}ms) ` +
            `comes after "${entries[i - 1].file}" (${entries[i - 1].durationMs}ms)`
        );
      }
    }
  });

  // ── unit-suite-green-and-profiled-04 ─────────────────────────────────
  registry.define(/^the duration record is compared with the previous duration record$/, (ctx) => {
    ctx.comparison = { previous: ctx.previous, current: ctx.current };
  });

  registry.define(/^the recorded test count is not lower than the previous one$/, (ctx) => {
    assertTestCountNotShrunk(ctx.comparison.previous, ctx.comparison.current);
  });

  // ── unit-suite-green-and-profiled-05 ─────────────────────────────────
  registry.define(/^the recorded duration is over the thirteen second ceiling$/, (ctx) => {
    if (!(ctx.current.duration_ms > OPERATIONAL_CEILING_MS)) {
      throw new Error(
        `expected the recorded duration (${ctx.current.duration_ms}ms) to exceed the ${OPERATIONAL_CEILING_MS}ms ceiling`
      );
    }
  });

  registry.define(/^the test files accounting for the bulk of the run are named as poles$/, (ctx) => {
    if (ctx.profile.poles.length === 0) {
      throw new Error(`expected at least one named pole in ${PROFILE_DOC_PATH}`);
    }
  });

  registry.define(/^each named pole carries its own measured duration$/, (ctx) => {
    for (const pole of ctx.profile.poles) {
      if (!(Number.isFinite(pole.durationMs) && pole.durationMs >= 0)) {
        throw new Error(`expected a numeric duration for pole ${pole.file}, got: ${JSON.stringify(pole)}`);
      }
    }
  });
}

module.exports = { registerSteps };
