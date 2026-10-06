'use strict';

// BL-1619: a fake `vitest` stub for exercising recordPropertyDuration.js's
// own runRecorder wiring (never the real 320s property lane - BL-1541).
// Writes a canned, time-independent vitest JSON report to whichever
// --outputFile=<path> arg it is given, so a run through the recorder and
// a direct run produce byte-identical report content (scenario 04).

const fs = require('fs');
const path = require('path');

const CANNED_RESULTS = [
  { name: 'test/pole.property.test.js', startTime: 0, endTime: 12000 },
  { name: 'test/second.property.test.js', startTime: 0, endTime: 11000 },
  { name: 'test/fast.property.test.js', startTime: 0, endTime: 500 },
];

// BL-1619 QA bounce D3: the fake also records the FULL argv it received,
// one per line, to "<outputFile>.argv.txt" - so a caller can prove two
// invocations (e.g. a direct, hand-built "correct" command and one spawned
// through the recorder) were given the SAME effective vitest command,
// including any forwarded file filter or the --config flag. Comparing
// argv rather than report CONTENT is the point: this fake's canned report
// never varies with its arguments, so a report-content comparison alone
// (the pre-bounce shape) cannot catch a recorder that silently drops or
// mutates an argument - readFakeVitestArgv below is what scenario 04
// actually asserts against.
function writeFakeVitestBin(dir, { exitCode = 0 } = {}) {
  const binPath = path.join(dir, 'vitest');
  const report = JSON.stringify({ testResults: CANNED_RESULTS });
  const script = `#!/bin/sh
out=""
for arg in "$@"; do
  case "$arg" in
    --outputFile=*) out="\${arg#--outputFile=}" ;;
  esac
done
cat > "$out" <<'JSON'
${report}
JSON
printf '%s\\n' "$@" > "$out.argv.txt"
exit ${exitCode}
`;
  fs.writeFileSync(binPath, script);
  fs.chmodSync(binPath, 0o755);
  return binPath;
}

// Reads back the argv the fake recorded for a given --outputFile path,
// with the --outputFile=<path> entry itself removed (the two invocations
// being compared legitimately use different report paths) - what remains
// is every flag and positional argument the fake was actually spawned
// with, in the order it received them.
function readFakeVitestArgv(outputFilePath) {
  const text = fs.readFileSync(`${outputFilePath}.argv.txt`, 'utf8');
  return text
    .split('\n')
    .filter(Boolean)
    .filter((arg) => !arg.startsWith('--outputFile='));
}

// Simulates the real-world shape of scenario 03: the process is killed
// before it ever writes a report - a genuine signal-terminated subprocess
// (self-SIGKILL), not a mocked spawnSync result, so the recorder's own
// spawnSync call sees the exact {status: null, signal: 'SIGKILL'} shape a
// real kill produces.
function writeKilledFakeVitestBin(dir) {
  const binPath = path.join(dir, 'vitest');
  fs.writeFileSync(binPath, '#!/bin/sh\nkill -9 $$\n');
  fs.chmodSync(binPath, 0o755);
  return binPath;
}

module.exports = { CANNED_RESULTS, writeFakeVitestBin, writeKilledFakeVitestBin, readFakeVitestArgv };
