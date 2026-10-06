// BL-1619: pure logic for the property-lane duration recorder, mirroring
// testDurationRecorderLib.js's own split (BL-078) - recordPropertyDuration.js
// (the CLI entry point that shells out to the real property-lane run) stays
// a thin wrapper. Deliberately carries NONE of the unit-lane recorder's
// budget/refusal/register/work-ratchet machinery (FIRM, out_of_scope): this
// is observation only - a row and a verdict, nothing that changes what
// vitest runs or how it exits (invariant 2).

// BL-1817 scales the lane's OWN testTimeout at runtime (20000-60000ms,
// vitest.properties.config.mjs); this recorder's verdict threshold stays
// the ticket's own literal half of the 20s BASELINE (scenario 02's "10 s"),
// never the scaled runtime value - a verdict whose threshold moved with
// contention would name a different set of files on every run.
const BASELINE_TIMEOUT_MS = 20000;
const HALF_TIMEOUT_MS = BASELINE_TIMEOUT_MS / 2;

// Scenario 01 / invariant 1's own shape: finished_at, file_count, result,
// duration_ms, work_ms, pole_ms, pole_file - nothing else (no budget/work
// verdict fields; this slice has no register or ratchet to report).
function buildRecord({ finishedAt, fileCount, exitCode, durationMs, workMs, poleMs, poleFile }) {
  return {
    finished_at: finishedAt,
    file_count: fileCount,
    result: exitCode === 0 ? 'pass' : 'fail',
    duration_ms: durationMs,
    work_ms: workMs,
    pole_ms: poleMs,
    pole_file: poleFile,
  };
}

// Pure fold over check-suite-file-budget.js's own extractFileDurations
// output ({file, durationMs}[], the ONE per-file duration extractor this
// recorder reuses rather than re-parsing the vitest JSON report itself -
// BL-1811). The pole keeps the FIRST file reached on an exact tie, so the
// result is deterministic over the report's own file order rather than
// depending on sort stability at the call site.
function summarizeDurations(durations) {
  let workMs = 0;
  let poleMs = 0;
  let poleFile = null;
  for (const d of durations) {
    workMs += d.durationMs;
    if (d.durationMs > poleMs) {
      poleMs = d.durationMs;
      poleFile = d.file;
    }
  }
  return { workMs, poleMs, poleFile };
}

function formatSeconds(ms) {
  return (ms / 1000).toFixed(1);
}

// BL-1619 scenario 02: names the pole file and its seconds, lists every
// file above the half-timeout threshold with its seconds (the pole
// itself included, since it is always >= any other file and therefore
// above the threshold whenever one exists), and prints the work sum and
// the wall in seconds - so the poles are visible before they time out
// under load, never only discovered one ticket at a time.
function formatPropertyDurationVerdict(summary, durations, halfTimeoutMs, wallMs) {
  const poleLine = summary.poleFile
    ? `property lane pole: ${summary.poleFile} (${formatSeconds(summary.poleMs)}s)`
    : 'property lane pole: none';

  const above = durations
    .filter((d) => d.durationMs > halfTimeoutMs)
    .sort((a, b) => b.durationMs - a.durationMs);
  const aboveLine =
    above.length > 0
      ? `property lane files above ${formatSeconds(halfTimeoutMs)}s: ` +
        above.map((d) => `${d.file} (${formatSeconds(d.durationMs)}s)`).join(', ')
      : `property lane files above ${formatSeconds(halfTimeoutMs)}s: none`;

  const summaryLine = `property lane work ${formatSeconds(summary.workMs)}s / wall ${formatSeconds(wallMs)}s`;

  return [poleLine, aboveLine, summaryLine].join('\n');
}

module.exports = {
  HALF_TIMEOUT_MS,
  buildRecord,
  summarizeDurations,
  formatPropertyDurationVerdict,
};
