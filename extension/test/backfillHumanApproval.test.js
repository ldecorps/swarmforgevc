const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const {
  backfillHumanApprovalText,
  runHumanApprovalBackfill,
  formatBackfillResultLine,
  formatBackfillReport,
  resolveTargetPath,
  main,
} = require('../out/tools/backfill-human-approval');

const CLI = path.join(__dirname, '..', 'out', 'tools', 'backfill-human-approval.js');

// BL-251 backfill-seeds-field-05: a one-time, idempotent migration seeding
// the structured human_approval field on live tickets from their existing
// free-text "# HUMAN APPROVAL:" comment block - the SAME multi-line
// comment shape real tickets in this repo already use (a header line plus
// consecutive '#'-prefixed continuation lines). Touches only backlog/active
// and backlog/paused, never backlog/done. Never clobbers a human's later
// edit: any file that already carries a human_approval: line is skipped
// entirely, regardless of its value.

// ── backfillHumanApprovalText (pure) ──────────────────────────────────────

test('a comment block marking the ticket "PENDING human review" seeds human_approval: pending', () => {
  const raw = [
    'id: BL-900',
    'title: t',
    '',
    '# HUMAN APPROVAL: feature file specs/features/BL-900.feature is a NEW draft',
    '# authored by the specifier and is PENDING human review.',
  ].join('\n') + '\n';
  const result = backfillHumanApprovalText(raw);
  assert.equal(result.outcome, 'seeded');
  assert.equal(result.value, 'pending');
  assert.match(result.text, /^human_approval: pending$/m);
});

test('a comment block marking the ticket "APPROVED by operator" seeds human_approval: approved', () => {
  const raw = [
    'id: BL-901',
    'title: t',
    '',
    '# HUMAN APPROVAL: APPROVED by operator 2026-07-10 (dep now met; promotable).',
  ].join('\n') + '\n';
  const result = backfillHumanApprovalText(raw);
  assert.equal(result.outcome, 'seeded');
  assert.equal(result.value, 'approved');
});

test('the seeded field line is inserted immediately after the comment block, matching real tickets\' own layout', () => {
  const raw = 'id: BL-900\ntitle: t\n\n# HUMAN APPROVAL: feature file\n# is pending human review.\n';
  const result = backfillHumanApprovalText(raw);
  assert.equal(result.text, 'id: BL-900\ntitle: t\n\n# HUMAN APPROVAL: feature file\n# is pending human review.\nhuman_approval: pending\n');
});

test('a ticket that already has human_approval: is left completely untouched (idempotent, never clobbers a later human edit)', () => {
  const raw = 'id: BL-900\ntitle: t\n\n# HUMAN APPROVAL: pending human review.\nhuman_approval: approved\n';
  const result = backfillHumanApprovalText(raw);
  assert.equal(result.outcome, 'already-set');
  assert.equal(result.text, raw);
});

test('a ticket with no "# HUMAN APPROVAL:" comment at all is left untouched (not applicable - no approval needed, or legacy)', () => {
  const raw = 'id: BL-900\ntitle: t\nstatus: paused\n';
  const result = backfillHumanApprovalText(raw);
  assert.equal(result.outcome, 'no-comment-found');
  assert.equal(result.text, raw);
});

test('a comment block whose text mentions neither "pending" nor "approved" is left undetermined, not guessed', () => {
  const raw = 'id: BL-900\ntitle: t\n\n# HUMAN APPROVAL: this is unclear text with no verdict.\n';
  const result = backfillHumanApprovalText(raw);
  assert.equal(result.outcome, 'undetermined');
  assert.equal(result.text, raw);
});

test('matching is case-insensitive (real tickets use both "PENDING"/"pending" and "APPROVED"/"approved")', () => {
  const raw = 'id: BL-900\ntitle: t\n\n# HUMAN APPROVAL: feature file is a new draft\n# authored by the specifier and is pending human review.\n';
  const result = backfillHumanApprovalText(raw);
  assert.equal(result.value, 'pending');
});

// ── runHumanApprovalBackfill (impure, real fs, idempotent) ────────────────

function mkTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sfvc-backfill-'));
}

function writeTicket(dir, fileName, content) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, fileName), content);
}

test('seeds human_approval on both active and paused tickets carrying the legacy comment', () => {
  const targetPath = mkTmp();
  writeTicket(
    path.join(targetPath, 'backlog', 'active'),
    'BL-900.yaml',
    'id: BL-900\ntitle: t\n\n# HUMAN APPROVAL: pending human review.\n'
  );
  writeTicket(
    path.join(targetPath, 'backlog', 'paused'),
    'BL-901.yaml',
    'id: BL-901\ntitle: t\n\n# HUMAN APPROVAL: APPROVED by operator.\n'
  );

  const results = runHumanApprovalBackfill(targetPath);

  assert.equal(results.find((r) => r.filePath.endsWith('BL-900.yaml')).outcome, 'seeded');
  assert.equal(results.find((r) => r.filePath.endsWith('BL-901.yaml')).outcome, 'seeded');
  assert.match(fs.readFileSync(path.join(targetPath, 'backlog', 'active', 'BL-900.yaml'), 'utf8'), /human_approval: pending/);
  assert.match(fs.readFileSync(path.join(targetPath, 'backlog', 'paused', 'BL-901.yaml'), 'utf8'), /human_approval: approved/);
});

test('never touches backlog/done - only active + paused are "live"', () => {
  const targetPath = mkTmp();
  const doneContentBefore = 'id: BL-902\ntitle: t\n\n# HUMAN APPROVAL: pending human review.\n';
  writeTicket(path.join(targetPath, 'backlog', 'done'), 'BL-902.yaml', doneContentBefore);

  runHumanApprovalBackfill(targetPath);

  assert.equal(fs.readFileSync(path.join(targetPath, 'backlog', 'done', 'BL-902.yaml'), 'utf8'), doneContentBefore);
});

test('running the backfill twice is a no-op the second time (idempotent) - no double-write, no clobbered value', () => {
  const targetPath = mkTmp();
  writeTicket(
    path.join(targetPath, 'backlog', 'active'),
    'BL-900.yaml',
    'id: BL-900\ntitle: t\n\n# HUMAN APPROVAL: pending human review.\n'
  );

  runHumanApprovalBackfill(targetPath);
  const afterFirst = fs.readFileSync(path.join(targetPath, 'backlog', 'active', 'BL-900.yaml'), 'utf8');
  const secondResults = runHumanApprovalBackfill(targetPath);
  const afterSecond = fs.readFileSync(path.join(targetPath, 'backlog', 'active', 'BL-900.yaml'), 'utf8');

  assert.equal(afterFirst, afterSecond, 'the file must be byte-identical after a second run');
  assert.equal(secondResults.find((r) => r.filePath.endsWith('BL-900.yaml')).outcome, 'already-set');
});

test('a missing active or paused folder is handled gracefully, never a crash', () => {
  const targetPath = mkTmp();
  assert.doesNotThrow(() => runHumanApprovalBackfill(targetPath));
});

// ── formatBackfillResultLine / formatBackfillReport / resolveTargetPath (pure) ──
// Hardener split (CRAP<=6 gate): pulled out of main() so the report text
// is exercised in-process, same "CLI main() run only via execFileSync is
// coverage-invisible" lesson this codebase's other CLI hardener passes
// already established.

test('formatBackfillResultLine includes the derived value in parens when present', () => {
  const line = formatBackfillResultLine({ filePath: '/x/BL-900.yaml', outcome: 'seeded', value: 'pending' });
  assert.equal(line, 'seeded (pending): /x/BL-900.yaml');
});

test('formatBackfillResultLine omits the parenthetical when no value was derived', () => {
  const line = formatBackfillResultLine({ filePath: '/x/BL-901.yaml', outcome: 'no-comment-found' });
  assert.equal(line, 'no-comment-found: /x/BL-901.yaml');
});

test('formatBackfillReport lists every result and a seeded/checked summary count', () => {
  const report = formatBackfillReport([
    { filePath: '/x/BL-900.yaml', outcome: 'seeded', value: 'pending' },
    { filePath: '/x/BL-901.yaml', outcome: 'already-set' },
  ]);
  assert.match(report, /seeded \(pending\): \/x\/BL-900\.yaml/);
  assert.match(report, /already-set: \/x\/BL-901\.yaml/);
  assert.match(report, /1 ticket\(s\) seeded, 2 checked\.$/);
});

test('formatBackfillReport summarizes 0 seeded for an empty result set, not an error', () => {
  assert.match(formatBackfillReport([]), /0 ticket\(s\) seeded, 0 checked\.$/);
});

test('resolveTargetPath uses the explicit argv[2] path when given', () => {
  assert.equal(resolveTargetPath(['node', 'backfill-human-approval.js', '/explicit/path']), '/explicit/path');
});

test('resolveTargetPath falls back to process.cwd() when no path argument is given', () => {
  assert.equal(resolveTargetPath(['node', 'backfill-human-approval.js']), process.cwd());
});

// ── end-to-end: the compiled CLI runs against a REAL fs fixture ──────────

function runCliSubprocess(cwd, extraArgs = []) {
  return execFileSync('node', [CLI, ...extraArgs], { cwd, encoding: 'utf8' });
}

// Runs the REAL main() in-process against a real fixture directory, so
// in-process coverage and mutation tooling can see the branches a
// subprocess-only smoke test cannot (the CLI main()-thin-wrapper rule;
// mirrors notifyDeadLettersCli.test.js's own identical seam). main() prints
// via console.log (not process.stdout.write directly), and Vitest's own
// console interception (globals: true) rewrites console.log independently
// of process.stdout - so console.log itself is overridden here to capture
// the report text. main() reads its target path from process.argv[2]
// (resolveTargetPath), so argv is set to mimic the exact subprocess shape
// and restored afterward.
async function runCli(cwd, extraArgs = []) {
  const originalCwd = process.cwd;
  const previousArgv = process.argv;
  const writes = [];
  const originalLog = console.log;
  console.log = (...args) => {
    writes.push(args.join(' '));
  };
  try {
    process.argv = ['node', CLI, ...extraArgs];
    process.cwd = () => cwd;
    await main();
  } finally {
    console.log = originalLog;
    process.cwd = originalCwd;
    process.argv = previousArgv;
  }
  return writes.join('\n') + '\n';
}

test('the compiled CLI backfills a real target path given as an argument and prints a summary', async () => {
  const targetPath = mkTmp();
  writeTicket(
    path.join(targetPath, 'backlog', 'active'),
    'BL-900.yaml',
    'id: BL-900\ntitle: t\n\n# HUMAN APPROVAL: pending human review.\n'
  );

  const output = await runCli(targetPath, [targetPath]);

  assert.match(output, /seeded \(pending\).*BL-900\.yaml/);
  assert.match(output, /1 ticket\(s\) seeded, 1 checked\./);
  assert.match(fs.readFileSync(path.join(targetPath, 'backlog', 'active', 'BL-900.yaml'), 'utf8'), /human_approval: pending/);
});

test('the compiled CLI defaults to process.cwd() when no target path argument is given', async () => {
  const targetPath = mkTmp();
  writeTicket(
    path.join(targetPath, 'backlog', 'paused'),
    'BL-901.yaml',
    'id: BL-901\ntitle: t\n\n# HUMAN APPROVAL: approved by operator.\n'
  );

  const output = await runCli(targetPath);

  assert.match(output, /seeded \(approved\).*BL-901\.yaml/);
});

// A single subprocess smoke test locks the compiled CLI's own wiring
// (require.main === module, real argv/cwd boundary) - an ADDITION to the
// in-process tests above, never the only cover for the real logic.
test('the compiled CLI runs standalone as a subprocess and produces the same result', () => {
  const targetPath = mkTmp();
  writeTicket(
    path.join(targetPath, 'backlog', 'active'),
    'BL-900.yaml',
    'id: BL-900\ntitle: t\n\n# HUMAN APPROVAL: pending human review.\n'
  );

  const output = runCliSubprocess(targetPath, [targetPath]);

  assert.match(output, /seeded \(pending\).*BL-900\.yaml/);
  assert.match(output, /1 ticket\(s\) seeded, 1 checked\./);
});
