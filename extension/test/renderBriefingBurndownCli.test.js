const { mkTmpDir } = require('./helpers/tmpDir');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { renderBriefingBurndown, main } = require('../out/tools/render-briefing-burndown');
const { NOT_DONE_BURNDOWN_DIAGRAM_NAME } = require('../out/metrics/notDoneBurndownChart');
const { serializeLifecycleSnapshot } = require('../out/metrics/lifecycleSnapshot');

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const NOW_MS = Date.parse('2026-08-15T15:00:00Z');

// Ticket ids that could never appear in this real repo's own git history -
// if the resulting diagram reflects THIS data, the shared snapshot was
// used, not a live git derivation (render-briefing-burndown.ts has no
// injectable runGitLog seam, so this is the only way to prove which path
// ran without faking git itself).
const FAKE_RECORDS = [
  { ticketId: 'ZZ-90001', specDateIso: '2026-08-10T10:00:00Z', closeDateIso: null },
  { ticketId: 'ZZ-90002', specDateIso: '2026-08-11T10:00:00Z', closeDateIso: null },
];

function writeFixtureSnapshot(dir, records, nowMs) {
  const filePath = path.join(dir, 'snapshot.json');
  fs.writeFileSync(filePath, JSON.stringify(serializeLifecycleSnapshot(records, nowMs), null, 2), 'utf8');
  return filePath;
}

test('renderBriefingBurndown uses the shared snapshot records when a fresh one is given, never deriving its own', () => {
  const dir = mkTmpDir('sfvc-render-burndown-');
  const snapshotPath = writeFixtureSnapshot(dir, FAKE_RECORDS, NOW_MS);

  const diagrams = renderBriefingBurndown(dir, NOW_MS, snapshotPath);

  assert.equal(diagrams.length, 1);
  assert.equal(diagrams[0].name, NOT_DONE_BURNDOWN_DIAGRAM_NAME);
  const png = Buffer.from(diagrams[0].base64, 'base64');
  assert.ok(png.subarray(0, 8).equals(PNG_MAGIC));
});

test('renderBriefingBurndown falls back to deriving its own history when no snapshot path is given (smoke test against the real repo)', () => {
  const repoRoot = path.join(__dirname, '..', '..');
  const diagrams = renderBriefingBurndown(repoRoot);
  assert.equal(diagrams.length, 1);
  assert.equal(diagrams[0].name, NOT_DONE_BURNDOWN_DIAGRAM_NAME);
});

test('renderBriefingBurndown falls back to deriving its own history when the given snapshot path does not exist', () => {
  const repoRoot = path.join(__dirname, '..', '..');
  const diagrams = renderBriefingBurndown(repoRoot, Date.now(), '/no/such/snapshot.json');
  assert.equal(diagrams.length, 1);
});

// ── main(): argv parsing + stdout plumbing ───────────────────────────────

async function runCli(cwd, argv) {
  const originalCwd = process.cwd;
  const originalArgv = process.argv;
  const writes = [];
  const originalWrite = process.stdout.write.bind(process.stdout);
  process.stdout.write = (chunk) => {
    writes.push(chunk);
    return true;
  };
  try {
    process.cwd = () => cwd;
    process.argv = ['node', 'render-briefing-burndown.js', ...argv];
    await main();
  } finally {
    process.stdout.write = originalWrite;
    process.cwd = originalCwd;
    process.argv = originalArgv;
  }
  return JSON.parse(writes.join(''));
}

test('the compiled CLI reads --snapshot from argv and reflects the shared snapshot data', async () => {
  // cwd must resolve to a real project root (.swarmforge/roles.tsv) for
  // resolveProjectRoot to succeed - the snapshot path itself is unrelated
  // to that root, so it can still point at an arbitrary fixture file.
  const repoRoot = path.join(__dirname, '..', '..');
  const dir = mkTmpDir('sfvc-render-burndown-');
  const snapshotPath = writeFixtureSnapshot(dir, FAKE_RECORDS, Date.now());

  const diagrams = await runCli(repoRoot, ['--snapshot', snapshotPath]);

  assert.equal(diagrams.length, 1);
  assert.equal(diagrams[0].name, NOT_DONE_BURNDOWN_DIAGRAM_NAME);
});

test('the compiled CLI runs with no flags at all against the real repo (unchanged pre-BL-897 behavior)', async () => {
  const diagrams = await runCli(path.join(__dirname, '..', '..'), []);
  assert.equal(diagrams.length, 1);
  assert.equal(diagrams[0].name, NOT_DONE_BURNDOWN_DIAGRAM_NAME);
});
