#!/usr/bin/env node
/**
 * BL-792 slice A: publishes the per-file duration profile of a GREEN
 * `npm test` run as a committed markdown artifact - console output does
 * not survive to the parcel slice B/C read from, per the ticket's own
 * "committed artifact, not console output" requirement. Reads the same
 * Vitest JSON report (`vitest run --reporter=json`) check-suite-file-budget.ts
 * already parses, plus the newest row of `.test-durations.jsonl` (BL-078),
 * so this tool and that guard agree on what "one file's duration" means -
 * no second collection mechanism.
 *
 * Usage: node build-test-duration-profile.js <vitest-json-report-path> <test-durations-jsonl-path> <output-md-path>
 */
import * as fs from 'fs';
import * as path from 'path';
import { extractFileDurations, FileDuration, VitestJsonReport } from './check-suite-file-budget';
import { runCliMain } from './swarm-metrics';

export interface DurationRecord {
  finished_at: string;
  test_count: number;
  result: string;
  duration_ms: number;
}

// BL-791: the human-given 13s OPERATIONAL ceiling - distinct from (and never
// a substitute for) SUITE_DURATION_BUDGET_MS's 10s code ratchet. Naming poles
// below is keyed off this ceiling, not the coded budget.
export const OPERATIONAL_CEILING_MS = 13000;

// The fraction of total measured file time a run's "poles" must account for
// (scenario 05: "the test files accounting for the bulk of the run"). The
// smallest slowest-first prefix whose cumulative duration reaches this
// fraction - not a fixed per-file threshold - so the named set actually is
// the bulk of the run, however many or few files that takes.
const BULK_OF_RUN_FRACTION = 0.5;

// BL-792 invariant: "a failing run is never used as a baseline or as
// evidence about where the suite's time goes". Throws rather than silently
// building a profile whose numbers cannot be trusted.
export function assertRecordPassed(record: DurationRecord): void {
  if (record.result !== 'pass') {
    throw new Error(`refusing to build a duration profile from a non-passing run (result: ${record.result})`);
  }
}

// BL-792 invariant: "no run is made green by removing test coverage - the
// recorded test_count never falls below the previous recorded run". No
// previous record (first-ever run) trivially satisfies this.
export function assertTestCountNotShrunk(previous: DurationRecord | undefined, current: DurationRecord): void {
  if (previous && current.test_count < previous.test_count) {
    throw new Error(`recorded test_count fell from ${previous.test_count} to ${current.test_count}`);
  }
}

export interface DurationProfile {
  entries: FileDuration[];
  totalMs: number;
  poles: FileDuration[];
}

// Pure: sorts slowest-first (scenario 03) and names the smallest prefix
// whose cumulative duration reaches BULK_OF_RUN_FRACTION of the total
// (scenario 05's "poles").
export function buildDurationProfile(fileDurations: FileDuration[], bulkFraction: number = BULK_OF_RUN_FRACTION): DurationProfile {
  const entries = [...fileDurations].sort((a, b) => b.durationMs - a.durationMs);
  const totalMs = entries.reduce((sum, e) => sum + e.durationMs, 0);
  const target = totalMs * bulkFraction;
  const poles: FileDuration[] = [];
  let running = 0;
  for (const entry of entries) {
    if (running >= target) {
      break;
    }
    poles.push(entry);
    running += entry.durationMs;
  }
  return { entries, totalMs, poles };
}

function asRelativePath(absolutePath: string, cwd: string): string {
  return path.relative(cwd, absolutePath).split(path.sep).join('/');
}

function formatTable(entries: FileDuration[], cwd: string): string {
  const rows = entries.map((e) => `| ${asRelativePath(e.file, cwd)} | ${Math.round(e.durationMs)} |`);
  return ['| File | Duration (ms) |', '| --- | ---: |', ...rows].join('\n');
}

export function formatDurationProfileMarkdown(record: DurationRecord, profile: DurationProfile, cwd: string = process.cwd()): string {
  const lines: string[] = [
    '# Unit suite per-file duration profile',
    '',
    `BL-792 slice A baseline (unit-suite-speed epic, BL-791). Recorded run: ${record.finished_at}, ` +
      `result **${record.result}**, ${record.test_count} test files, ${(record.duration_ms / 1000).toFixed(1)}s wall-clock.`,
    '',
  ];
  if (record.duration_ms > OPERATIONAL_CEILING_MS) {
    lines.push(
      `Over the 13s operational ceiling. Poles slice B must cut - the smallest slowest-first set ` +
        `accounting for at least half of the ${(profile.totalMs / 1000).toFixed(1)}s total measured file time:`,
      '',
      formatTable(profile.poles, cwd),
      ''
    );
  }
  lines.push('## Every test file that ran, slowest first', '', formatTable(profile.entries, cwd));
  return lines.join('\n') + '\n';
}

export function main(): void {
  const [reportPath, durationsJsonlPath, outputPath] = process.argv.slice(2);
  if (!reportPath || !durationsJsonlPath || !outputPath) {
    process.stderr.write('Usage: node build-test-duration-profile.js <vitest-json-report-path> <test-durations-jsonl-path> <output-md-path>\n');
    process.exitCode = 1;
    return;
  }
  const records: DurationRecord[] = fs
    .readFileSync(durationsJsonlPath, 'utf8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  const current = records[records.length - 1];
  const previous = records.length > 1 ? records[records.length - 2] : undefined;
  assertRecordPassed(current);
  assertTestCountNotShrunk(previous, current);

  const report = JSON.parse(fs.readFileSync(reportPath, 'utf8')) as VitestJsonReport;
  const profile = buildDurationProfile(extractFileDurations(report));
  fs.writeFileSync(outputPath, formatDurationProfileMarkdown(current, profile));
  console.log(`wrote ${outputPath} (${profile.entries.length} files, ${profile.poles.length} poles)`);
}

if (require.main === module) {
  runCliMain(main);
}
