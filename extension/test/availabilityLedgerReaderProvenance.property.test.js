const { mkTmpDir } = require('./helpers/tmpDir');
const assert = require('node:assert/strict');
const fc = require('fast-check');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

// BL-823 invariant 3 (declared in the ticket YAML): "Every interval the
// reader emits carries explicit provenance, and an interval whose end is
// not evidenced is emitted open or omitted - never closed with a guessed
// timestamp." Authored by the coder per BL-654. Drives the REAL Babashka
// reader (availability_ledger_lib.bb's fold, via the same acceptance-runner
// script the feature steps drive) against an arbitrary, possibly-unpaired
// stream of pause/stop/start events - never a JS reimplementation of the
// fold algorithm. Runs ONLY via `npm run test:properties`
// (vitest.properties.config.mjs).

const REPO_ROOT = path.join(__dirname, '..', '..');
const FOLD_RUNNER = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'test', 'bl823_fold_acceptance_runner.bb');

const BASE_MS = Date.parse('2026-08-01T00:00:00Z');
const KNOWN_PROVENANCE = new Set(['proven', 'inferred', 'open']);

function tsFromOffsetMinutes(offsetMinutes) {
  return new Date(BASE_MS + offsetMinutes * 60000).toISOString();
}

const stopSourceArb = fc.constantFrom('kill_pipeline_swarm.sh', 'heartbeat-inferred');

function recordFor(kind, ts, stopSource) {
  const cls = kind === 'stop' || kind === 'start' ? 'swarm-stop' : 'control-pause';
  const source =
    kind === 'stop'
      ? stopSource
      : kind === 'start'
        ? 'start-swarm.sh'
        : kind === 'pause-start'
          ? 'telegram-front-desk-bot:pause'
          : 'telegram-front-desk-bot:resume';
  return { ts, event: kind, class: cls, source };
}

// Built from SLOTS rather than independently-random (kind, timestamp) pairs:
// an independent draw makes a "stop" immediately followed in time by its own
// matching "start" a low-probability accident, so across a bounded numRuns a
// mutant that only misbehaves on a CLOSED "inferred" interval (see the
// restore-and-mutate check this file's non-vacuity pass used) could slip
// through unexercised. Each slot explicitly constructs either a
// stop/pause PAIR (closed, exercising "proven"/"inferred") or a LONE
// stop/start/pause event (exercising "open" or the no-pair-yields-nothing
// path) at strictly increasing timestamps, so every run has a real chance of
// covering both the closed and open branches for both classes.
const slotKindArb = fc.constantFrom('stop-start-pair', 'lone-stop', 'lone-start', 'pause-pair', 'lone-pause-start', 'lone-pause-end');

const eventsArb = fc.array(fc.tuple(slotKindArb, stopSourceArb), { minLength: 1, maxLength: 10 }).map((slots) => {
  const records = [];
  let offset = 0;
  for (const [kind, stopSource] of slots) {
    if (kind === 'stop-start-pair') {
      records.push(recordFor('stop', tsFromOffsetMinutes(offset), stopSource));
      offset += 5;
      records.push(recordFor('start', tsFromOffsetMinutes(offset), stopSource));
    } else if (kind === 'lone-stop') {
      records.push(recordFor('stop', tsFromOffsetMinutes(offset), stopSource));
    } else if (kind === 'lone-start') {
      records.push(recordFor('start', tsFromOffsetMinutes(offset), stopSource));
    } else if (kind === 'pause-pair') {
      records.push(recordFor('pause-start', tsFromOffsetMinutes(offset)));
      offset += 5;
      records.push(recordFor('pause-end', tsFromOffsetMinutes(offset)));
    } else if (kind === 'lone-pause-start') {
      records.push(recordFor('pause-start', tsFromOffsetMinutes(offset)));
    } else {
      records.push(recordFor('pause-end', tsFromOffsetMinutes(offset)));
    }
    offset += 5;
  }
  return records;
});

test('property: every emitted interval carries explicit provenance, and provenance is never guessed', () => {
  fc.assert(
    fc.property(eventsArb, (records) => {
      const root = mkTmpDir('bl823-prop-provenance-');
      const telemetryDir = path.join(root, '.swarmforge', 'telemetry');
      fs.mkdirSync(telemetryDir, { recursive: true });
      const content = records.map((r) => JSON.stringify(r)).join('\n') + (records.length ? '\n' : '');
      fs.writeFileSync(path.join(telemetryDir, 'availability-2026-08.jsonl'), content);

      const out = execFileSync('bb', [FOLD_RUNNER, path.join(root, '.swarmforge')], { encoding: 'utf8' });
      const intervals = JSON.parse(out);

      for (const interval of intervals) {
        // (a) explicit provenance, always one of the three known values.
        assert.ok(
          KNOWN_PROVENANCE.has(interval.provenance),
          `interval carries an unrecognized provenance: ${JSON.stringify(interval)}`
        );

        // (b) an interval with no end is open - never closed with a guessed
        // timestamp under a "proven"/"inferred" label.
        const hasEnd = interval['end-ms'] !== null && interval['end-ms'] !== undefined;
        if (!hasEnd) {
          assert.equal(interval.provenance, 'open', `an unclosed interval must be provenance "open": ${JSON.stringify(interval)}`);
        } else {
          assert.notEqual(interval.provenance, 'open', `a closed interval must not be provenance "open": ${JSON.stringify(interval)}`);
        }

        // (c) "inferred" vs "proven" round-trips EXACTLY to the closing
        // stop record's own source - checked in BOTH directions, never only
        // "inferred implies heartbeat-inferred". A one-directional check
        // (only asking "if inferred, is the source heartbeat-inferred?")
        // cannot catch a mutant that always labels "proven": that direction
        // is vacuously true when "inferred" is never produced at all. The
        // reverse direction - "if the source WAS heartbeat-inferred, is the
        // label inferred?" - is what actually pins the label to its source
        // rather than to a guess.
        if (hasEnd && interval.class === 'swarm-stop') {
          const matchingStop = records.find((r) => r.event === 'stop' && Date.parse(r.ts) === interval['start-ms']);
          assert.ok(matchingStop, `a closed swarm-stop interval must start at a real stop record: ${JSON.stringify(interval)}`);
          const expectedProvenance = matchingStop.source === 'heartbeat-inferred' ? 'inferred' : 'proven';
          assert.equal(
            interval.provenance,
            expectedProvenance,
            `expected provenance "${expectedProvenance}" for a stop record sourced "${matchingStop.source}", got: ${JSON.stringify({ interval, matchingStop })}`
          );
        }
      }
    }),
    { numRuns: 50 }
  );
});
