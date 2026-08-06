const { mkTmpDir } = require('./helpers/tmpDir');
const assert = require('node:assert/strict');
const fc = require('fast-check');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

// BL-823 invariant 2 (declared in the ticket YAML): "The ledger is
// append-only: no writer ever rewrites, reorders, or deletes an existing
// record, and the reader tolerates duplicate, out-of-order and corrupt
// lines without ever inventing a record that is not there." Authored by
// the coder per BL-654. Drives the REAL Babashka reader
// (availability_ledger_lib.bb's fold, via the same acceptance-runner script
// specs/pipeline/steps/bl823AvailabilityIntervalLedgerSteps.js drives -
// never a JS reimplementation of the fold algorithm). Runs ONLY via
// `npm run test:properties` (vitest.properties.config.mjs).

const REPO_ROOT = path.join(__dirname, '..', '..');
const FOLD_RUNNER = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'test', 'bl823_fold_acceptance_runner.bb');

const BASE_MS = Date.parse('2026-08-01T00:00:00Z');

function tsFromOffsetMinutes(offsetMinutes) {
  return new Date(BASE_MS + offsetMinutes * 60000).toISOString();
}

function recordLine(event, ts) {
  const cls = 'swarm-stop';
  const source = event === 'stop' ? 'kill_pipeline_swarm.sh' : 'start-swarm.sh';
  return JSON.stringify({ ts, event, class: cls, source });
}

// K distinct sorted minute-offsets -> a strict stop/start/stop/start...
// alternation starting with stop, so the "valid timestamp" set this
// property checks against is unambiguous regardless of how the writer
// pairing algorithm itself works (that pairing is exercised by the
// scenario tests; this property is about tolerance of noise around it).
const validSequenceArb = fc
  .uniqueArray(fc.integer({ min: 0, max: 100000 }), { minLength: 2, maxLength: 10 })
  .map((offsets) => {
    const sorted = [...offsets].sort((a, b) => a - b);
    return sorted.map((offsetMinutes, i) => ({
      ts: tsFromOffsetMinutes(offsetMinutes),
      event: i % 2 === 0 ? 'stop' : 'start',
    }));
  });

const corruptLineArb = fc.oneof(
  fc.constant('not even json {{{'),
  fc.constant(''),
  fc.constant('{"ts":"not-a-real-instant","event":"stop","class":"swarm-stop","source":"x"}'),
  fc.constant('{"event":"stop","class":"swarm-stop","source":"x"}'), // missing ts
  fc.string({ minLength: 1, maxLength: 10 })
);

test('property: the reader tolerates duplicate, out-of-order, and corrupt lines without ever inventing a record that is not there', () => {
  fc.assert(
    fc.property(
      validSequenceArb,
      fc.array(corruptLineArb, { maxLength: 5 }),
      (validRecords, corruptLines) => {
        const root = mkTmpDir('bl823-prop-tolerance-');
        const validLines = validRecords.map((r) => recordLine(r.event, r.ts));
        // Duplicate a random prefix of the valid lines (append-only: writing
        // the same record twice must never be treated as two records).
        const duplicateCount = Math.min(validLines.length, 3);
        const duplicatedLines = validLines.slice(0, duplicateCount);

        const allLines = [...validLines, ...duplicatedLines, ...corruptLines];
        // Shuffle via a fixed PRNG seeded from the content itself, so the
        // property is reproducible per-input without depending on Date.now/
        // Math.random (engineering.prompt: pin fixture clocks/determinism).
        let seed = allLines.length * 2654435761;
        const keyed = allLines.map((line) => {
          seed = (seed * 1103515245 + 12345) & 0x7fffffff;
          return { line, key: seed };
        });
        keyed.sort((a, b) => a.key - b.key);
        const fileContent = keyed.map((x) => x.line).join('\n') + '\n';

        const month = '2026-08';
        const telemetryDir = path.join(root, '.swarmforge', 'telemetry');
        fs.mkdirSync(telemetryDir, { recursive: true });
        fs.writeFileSync(path.join(telemetryDir, `availability-${month}.jsonl`), fileContent);

        const out = execFileSync('bb', [FOLD_RUNNER, path.join(root, '.swarmforge')], { encoding: 'utf8' });
        const intervals = JSON.parse(out);

        const validMsSet = new Set(validRecords.map((r) => Date.parse(r.ts)));
        for (const interval of intervals) {
          assert.ok(
            validMsSet.has(interval['start-ms']),
            `interval start-ms ${interval['start-ms']} was never a written record's timestamp: ${JSON.stringify({ interval, validRecords })}`
          );
          if (interval['end-ms'] !== null && interval['end-ms'] !== undefined) {
            assert.ok(
              validMsSet.has(interval['end-ms']),
              `interval end-ms ${interval['end-ms']} was never a written record's timestamp: ${JSON.stringify({ interval, validRecords })}`
            );
          }
        }
      }
    ),
    { numRuns: 25 }
  );
});
