const { mkTmpDir } = require('./helpers/tmpDir');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const {
  formatBounceLine,
  main,
  computeWindowStart,
  recordsAfter,
  computeSevenDayTrend,
  buildBounceWindowReport,
  formatBounceWindowLine,
  parseArgv,
} = require('../out/tools/qa-bounce-line');
const { appendQaBounceRecordIfNew, qaBouncesDir } = require('../out/metrics/qaBounceStore');
const { appendBounceRecordIfNew } = require('../out/metrics/bounceStore');
const { copySeededRepoInto } = require('./helpers/sharedRepoFixture');
const { claudeSettingsPath } = require('../out/swarm/claudeSettingsFile');

function inventoryItems(n) {
  return Array.from({ length: n }, (_, i) => ({ id: `D${i + 1}`, class: 'behavior', blamed: 'coder', pointer: `fixture.ts:${i + 1} fn()` }));
}

// BL-454/BL-635: the daily-briefing bounce line CLI briefing_email_lib.bb
// shells out to. Generalised (BL-635) from a QA-only tally to report who
// bounced as well as whose work bounced, reading the merged bounce log
// (legacy qa_bounces/ + the new bounces/ path).

const CLI = path.join(__dirname, '..', 'out', 'tools', 'qa-bounce-line.js');

function mkTmp(prefix) {
  return mkTmpDir(prefix);
}

function git(cwd, args, extraEnv) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, ...extraEnv } });
}

function initRepo(root) {
  copySeededRepoInto(root);
}

function writeRolesTsv(root) {
  fs.mkdirSync(path.join(root, '.swarmforge'), { recursive: true });
  fs.writeFileSync(path.join(root, '.swarmforge', 'roles.tsv'), `specifier\tmaster\t${root}\tsession\tSpecifier\tclaude\ttask\n`);
}

function commitAll(root, message) {
  git(root, ['add', '-A']);
  git(root, ['commit', '-q', '-m', message]);
}

function mkRepo() {
  const root = mkTmp('sfvc-qa-bounce-line-repo-');
  initRepo(root);
  writeRolesTsv(root);
  commitAll(root, 'seed roles.tsv');
  return root;
}

// ── formatBounceLine (pure) ────────────────────────────────────────────────

test('formats totals, by-bouncing-role, whose-work, and per-ticket-type breakdowns', () => {
  const byBouncingRole = [
    { role: 'architect', count: 2 },
    { role: 'QA', count: 1 },
  ];
  const tally = {
    total: 3,
    byRole: [
      { role: 'coder', count: 2 },
      { role: 'architect', count: 1 },
    ],
    byTicketType: { feature: 2, defect: 1 },
  };
  assert.equal(
    formatBounceLine(byBouncingRole, tally),
    'Bounces: 3 total - by bouncing role: architect x2, QA x1 - whose work: coder x2, architect x1 - by ticket type: feature x2, defect x1'
  );
});

// BL-635 (record-bounce-by-role-14): the line no longer frames every
// bounce as a QA bounce, and a legacy by-less record is shown unattributed.

test('does not frame every bounce as a QA bounce', () => {
  const line = formatBounceLine([{ role: 'architect', count: 1 }], { total: 1, byRole: [{ role: 'coder', count: 1 }], byTicketType: { defect: 1 } });
  assert.doesNotMatch(line, /^QA bounces/);
});

test('a legacy by-less record is shown as unattributed, not silently attributed to QA', () => {
  const line = formatBounceLine([{ role: 'unattributed', count: 1 }], { total: 1, byRole: [{ role: 'coder', count: 1 }], byTicketType: { defect: 1 } });
  assert.match(line, /unattributed x1/);
  assert.doesNotMatch(line, /QA x1/);
});

test('breaks a tied by-ticket-type count alphabetically', () => {
  const line = formatBounceLine([], { total: 2, byRole: [], byTicketType: { feature: 1, defect: 1 } });
  assert.match(line, /by ticket type: defect x1, feature x1/);
});

// ── BL-689: defectsPerBounce is an optional 3rd arg - omitted, the line is
// byte-for-byte what it was before this ticket (bl635/bl688's own step
// handlers call formatBounceLine with only 2 args and must keep working).

test('omitting defectsPerBounce prints exactly the pre-BL-689 line, no new segment', () => {
  const line = formatBounceLine([{ role: 'architect', count: 1 }], { total: 1, byRole: [{ role: 'coder', count: 1 }], byTicketType: { defect: 1 } });
  assert.equal(line, 'Bounces: 1 total - by bouncing role: architect x1 - whose work: coder x1 - by ticket type: defect x1');
});

test('passing defectsPerBounce inserts a "(N.N defects/bounce)" segment right after the total', () => {
  const line = formatBounceLine([{ role: 'architect', count: 1 }], { total: 1, byRole: [{ role: 'coder', count: 1 }], byTicketType: { defect: 1 } }, 2.5);
  assert.equal(line, 'Bounces: 1 total (2.5 defects/bounce) - by bouncing role: architect x1 - whose work: coder x1 - by ticket type: defect x1');
});

test('defectsPerBounce of 0 (an empty record set) still renders "0.0 defects/bounce", distinct from omitted', () => {
  const line = formatBounceLine([], { total: 0, byRole: [], byTicketType: {} }, 0);
  assert.match(line, /\(0\.0 defects\/bounce\)/);
});

// ── BL-689 end-to-end: main() wires computeDefectsPerBounce into the printed line ──

test('the end-to-end line reports the real defects-per-bounce figure from the durable log', async () => {
  const root = mkRepo();
  appendBounceRecordIfNew(root, {
    ticket: 'BL-689',
    producingRole: 'coder',
    ticketType: 'feature',
    failureClass: 'behavior',
    commit: 'aaaa111111',
    at: '2026-07-27T10:00:00.000Z',
    by: 'architect',
    items: inventoryItems(4),
    blocked: 0,
  });
  appendBounceRecordIfNew(root, {
    ticket: 'BL-689',
    producingRole: 'coder',
    ticketType: 'feature',
    failureClass: 'behavior',
    commit: 'bbbb222222',
    at: '2026-07-27T11:00:00.000Z',
    by: 'architect',
  });
  const output = await runCli(root);
  // BL-1880: defects-per-bounce moved into the all-time ticket-type
  // clause, and the printed line now leads with the window - the figure
  // this test is actually about is unaffected by where it sits.
  assert.match(output, /\(2\.5 defects\/bounce\)/);
  assert.match(output, /all-time total: 2$/);
});

// ── end-to-end: process.cwd stubbed, console.log mocked ───────────────────

async function runCli(root) {
  const originalCwd = process.cwd;
  const writes = [];
  const originalLog = console.log;
  console.log = (...args) => {
    writes.push(args.join(' '));
  };
  try {
    process.cwd = () => root;
    await main();
  } finally {
    console.log = originalLog;
    process.cwd = originalCwd;
  }
  return writes.join('\n');
}

function runCliSubprocess(root) {
  return execFileSync('node', [CLI], { cwd: root, encoding: 'utf8' });
}

test('prints nothing when there are no recorded bounces yet', async () => {
  const root = mkRepo();
  const output = await runCli(root);
  assert.equal(output, '');
});

test('prints the tally line once a generalised bounce is recorded', async () => {
  const root = mkRepo();
  appendBounceRecordIfNew(root, {
    ticket: 'BL-590',
    producingRole: 'coder',
    ticketType: 'defect',
    failureClass: 'behavior',
    commit: 'abc1234567',
    at: '2026-07-26T10:00:00.000Z',
    by: 'architect',
  });
  const output = await runCli(root);
  // BL-1880: the printed line leads with the window, not the all-time
  // total - this test is about the all-time breakdowns still being
  // present, which it is, just repositioned.
  assert.match(output, /all-time total: 1$/);
  assert.match(output, /architect x1/);
  assert.match(output, /defect x1/);
});

// BL-635 (record-bounce-by-role-06/14): a legacy QA-only record (no `by` on
// the JSONL line) still counts, attributed as unattributed rather than QA.

test('a legacy qa_bounces record with no `by` field is counted as unattributed', async () => {
  const root = mkRepo();
  appendQaBounceRecordIfNew(root, {
    ticket: 'BL-340',
    producingRole: 'coder',
    ticketType: 'feature',
    failureClass: 'behavior',
    commit: 'legacyaa11',
    at: '2026-07-14T10:00:00.000Z',
  });
  const output = await runCli(root);
  assert.match(output, /all-time total: 1$/);
  assert.match(output, /by bouncing role: unattributed x1/);
});

test('the compiled CLI runs standalone as a subprocess and produces the same empty-state result', () => {
  const root = mkRepo();
  const output = runCliSubprocess(root);
  assert.equal(output.trim(), '');
});

test('the compiled CLI runs standalone as a subprocess and reports recorded bounces', () => {
  const root = mkRepo();
  fs.mkdirSync(qaBouncesDir(root), { recursive: true });
  appendQaBounceRecordIfNew(root, {
    ticket: 'BL-340',
    producingRole: 'coder',
    ticketType: 'feature',
    failureClass: 'behavior',
    commit: 'abc1234567',
    at: '2026-07-14T10:00:00.000Z',
  });
  const output = runCliSubprocess(root);
  assert.match(output.trim(), /all-time total: 1$/);
});

// ── BL-1880: the window start ───────────────────────────────────────────

test('computeWindowStart uses the previous briefing time when given', () => {
  const result = computeWindowStart('2026-10-01T08:00:00.000Z', '2026-10-02T07:00:00.000Z');
  assert.equal(result.startIso, '2026-10-01T08:00:00.000Z');
  assert.equal(result.hadPreviousBriefing, true);
});

test('computeWindowStart falls back to 24 hours before now when there is no previous briefing', () => {
  const result = computeWindowStart(undefined, '2026-10-02T07:00:00.000Z');
  assert.equal(result.startIso, '2026-10-01T07:00:00.000Z');
  assert.equal(result.hadPreviousBriefing, false);
});

// ── BL-1880 invariant 2: strictly after, never at-or-equal ──────────────

test('recordsAfter excludes a record exactly at the window start', () => {
  const records = [
    { at: '2026-10-01T08:00:00.000Z', producingRole: 'coder' },
    { at: '2026-10-01T08:00:00.001Z', producingRole: 'coder' },
    { at: '2026-10-01T07:59:59.999Z', producingRole: 'coder' },
  ];
  const kept = recordsAfter(records, '2026-10-01T08:00:00.000Z');
  assert.deepEqual(
    kept.map((r) => r.at),
    ['2026-10-01T08:00:00.001Z']
  );
});

// ── BL-1880: the seven-day trend ─────────────────────────────────────────

test('computeSevenDayTrend buckets one count per day, oldest first', () => {
  const now = '2026-10-02T07:00:00.000Z';
  const nowMs = new Date(now).getTime();
  const counts = [1, 0, 2, 0, 3, 1, 4]; // oldest (day 1) .. newest (day 7)
  const records = [];
  counts.forEach((count, dayIndex) => {
    const offsetMs = (7 - dayIndex - 0.5) * 24 * 60 * 60 * 1000; // midpoint of that day's bucket
    for (let i = 0; i < count; i++) {
      records.push({ at: new Date(nowMs - offsetMs).toISOString(), producingRole: 'coder' });
    }
  });
  assert.deepEqual(computeSevenDayTrend(records, 'coder', now), counts);
});

test('computeSevenDayTrend ignores a record older than seven days and one from another role', () => {
  const now = '2026-10-02T07:00:00.000Z';
  const records = [
    { at: '2026-09-20T00:00:00.000Z', producingRole: 'coder' }, // far older than 7 days
    { at: '2026-10-02T06:00:00.000Z', producingRole: 'architect' }, // wrong role
  ];
  assert.deepEqual(computeSevenDayTrend(records, 'coder', now), [0, 0, 0, 0, 0, 0, 0]);
});

test('computeSevenDayTrend excludes a record exactly seven days old - the window is seven whole days, not eight', () => {
  const now = '2026-10-02T07:00:00.000Z';
  const nowMs = new Date(now).getTime();
  // Exactly 7*24h before now: daysBefore === TREND_DAYS (7), one bucket
  // past the oldest one this trend reports - must be excluded, not folded
  // into bucket 0.
  const records = [{ at: new Date(nowMs - 7 * 24 * 60 * 60 * 1000).toISOString(), producingRole: 'coder' }];
  assert.deepEqual(computeSevenDayTrend(records, 'coder', now), [0, 0, 0, 0, 0, 0, 0]);
});

test('computeSevenDayTrend excludes a record that is after nowIso - a future bounce never counts as "before"', () => {
  const now = '2026-10-02T07:00:00.000Z';
  const records = [{ at: '2026-10-02T08:00:00.000Z', producingRole: 'coder' }]; // one hour AFTER now
  assert.deepEqual(computeSevenDayTrend(records, 'coder', now), [0, 0, 0, 0, 0, 0, 0]);
});

// ── BL-1880: the full report, and the line built from it ───────────────

test('buildBounceWindowReport assembles the window, trend, model and all-time figures from one record set', () => {
  const now = '2026-10-02T07:00:00.000Z';
  const records = [
    { ticket: 'BL-1', producingRole: 'coder', ticketType: 'feature', failureClass: 'behavior', commit: 'aaaa111111', at: '2026-09-30T00:00:00.000Z', by: 'QA' }, // before window
    { ticket: 'BL-2', producingRole: 'coder', ticketType: 'defect', failureClass: 'behavior', commit: 'bbbb222222', at: '2026-10-01T09:00:00.000Z', by: 'architect' }, // after window
  ];
  const report = buildBounceWindowReport(records, '2026-10-01T08:00:00.000Z', now, (role) => `model-for-${role}`);
  assert.equal(report.windowStartIso, '2026-10-01T08:00:00.000Z');
  assert.equal(report.hadPreviousBriefing, true);
  assert.equal(report.windowTotal, 1);
  assert.deepEqual(report.windowByProducingRole, [
    { role: 'coder', windowCount: 1, trend: computeSevenDayTrend(records, 'coder', now), model: 'model-for-coder' },
  ]);
  assert.deepEqual(report.windowByBouncingRole, [{ role: 'architect', count: 1 }]);
  assert.equal(report.allTimeTotal, 2);
  assert.equal(report.allTimeByTicketType.feature, 1);
  assert.equal(report.allTimeByTicketType.defect, 1);
  assert.equal(report.allTimeDefectsPerBounce, 1);
});

test('formatBounceWindowLine names the window, every producing role entry, and ends with the all-time total', () => {
  const report = {
    windowStartIso: '2026-10-01T08:00:00.000Z',
    hadPreviousBriefing: true,
    windowTotal: 2,
    windowByProducingRole: [{ role: 'coder', windowCount: 2, trend: [1, 0, 2, 0, 3, 1, 4], model: 'Opus 5.5' }],
    windowByBouncingRole: [{ role: 'architect', count: 2 }],
    allTimeTotal: 5,
    allTimeByBouncingRole: [{ role: 'architect', count: 3 }, { role: 'QA', count: 2 }],
    allTimeByTicketType: { feature: 3, defect: 2 },
    allTimeDefectsPerBounce: 1.2,
  };
  const line = formatBounceWindowLine(report);
  assert.match(line, /^Bounces since 2026-10-01T08:00:00\.000Z: 2/);
  assert.match(line, /coder x2 \(trend 1 0 2 0 3 1 4, now Opus 5\.5\)/);
  assert.match(line, /\(1\.2 defects\/bounce\)/);
  assert.match(line, /all-time total: 5$/);
});

test('formatBounceWindowLine names the 24-hour fallback and "none" when no role bounced in the window', () => {
  const line = formatBounceWindowLine({
    windowStartIso: '2026-10-01T07:00:00.000Z',
    hadPreviousBriefing: false,
    windowTotal: 0,
    windowByProducingRole: [],
    windowByBouncingRole: [],
    allTimeTotal: 0,
    allTimeByBouncingRole: [],
    allTimeByTicketType: {},
    allTimeDefectsPerBounce: 0,
  });
  assert.match(line, /^Bounces in the last 24 hours \(no previous briefing was found\): 0/);
  assert.match(line, /by producing role: none/);
  assert.match(line, /all-time total: 0$/);
});

function baseReport(overrides) {
  return {
    windowStartIso: '2026-10-01T08:00:00.000Z',
    hadPreviousBriefing: true,
    windowTotal: 0,
    windowByProducingRole: [],
    windowByBouncingRole: [],
    allTimeTotal: 0,
    allTimeByBouncingRole: [],
    allTimeByTicketType: {},
    allTimeDefectsPerBounce: 0,
    ...overrides,
  };
}

test('formatBounceWindowLine orders the ticket-type breakdown by count descending', () => {
  const line = formatBounceWindowLine(baseReport({ allTimeByTicketType: { chore: 1, defect: 5, feature: 3 } }));
  assert.match(line, /by ticket type: defect x5, feature x3, chore x1 /);
});

test('formatBounceWindowLine breaks a ticket-type count tie alphabetically, never by the tied magnitude', () => {
  // Two types tied at the SAME count: the sort's tie-break only engages
  // when the primary comparison is 0 - a mutant weakening the `||` to
  // `&&` (or the `-` to `+`) changes the ORDER of unequal entries too, so
  // pairing a tie with an unequal third entry catches both shapes in one
  // assertion.
  const line = formatBounceWindowLine(baseReport({ allTimeByTicketType: { feature: 2, bug: 2, chore: 5 } }));
  assert.match(line, /by ticket type: chore x5, bug x2, feature x2 /);
});

// ── BL-1880: argv parsing ────────────────────────────────────────────────

test('parseArgv reads --target, --at and --json in any order', () => {
  assert.deepEqual(parseArgv(['--target', '/x', '--at', '2026-10-02T07:00:00Z', '--json']), {
    target: '/x',
    at: '2026-10-02T07:00:00Z',
    json: true,
  });
  assert.deepEqual(parseArgv([]), {});
});

test('parseArgv does not set json when --json is absent, even with other flags present', () => {
  assert.deepEqual(parseArgv(['--target', '/x', '--at', '2026-10-02T07:00:00Z']), {
    target: '/x',
    at: '2026-10-02T07:00:00Z',
  });
});

test('parseArgv ignores a trailing flag with no value, and an unrecognized flag', () => {
  assert.deepEqual(parseArgv(['--target']), {});
  assert.deepEqual(parseArgv(['--bogus', 'x']), {});
});

// ── BL-1880 end-to-end: main() with an injected clock, a real previous
// briefing commit, a real configured model, and --json ──────────────────

function commitBriefingFile(root, dayKey, atIso) {
  const dir = path.join(root, 'docs', 'briefings');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${dayKey}.md`), `# Briefing ${dayKey}\n`);
  git(root, ['add', `docs/briefings/${dayKey}.md`]);
  git(root, ['commit', '-q', '-m', `briefing: record sent marker ${dayKey}`, '--date', atIso], {
    GIT_AUTHOR_DATE: atIso,
    GIT_COMMITTER_DATE: atIso,
  });
}

test('main() with --at and a real previous-briefing commit prints the window leading the line', async () => {
  const root = mkRepo();
  commitBriefingFile(root, '2026-10-01', '2026-10-01T08:00:00+00:00');
  appendBounceRecordIfNew(root, {
    ticket: 'BL-1880',
    producingRole: 'coder',
    ticketType: 'feature',
    failureClass: 'behavior',
    commit: 'cccc333333',
    at: '2026-10-01T09:00:00.000Z',
    by: 'architect',
  });
  const originalCwd = process.cwd;
  const writes = [];
  const originalLog = console.log;
  console.log = (...args) => writes.push(args.join(' '));
  try {
    process.cwd = () => root;
    main({ at: '2026-10-02T07:00:00.000Z' });
  } finally {
    console.log = originalLog;
    process.cwd = originalCwd;
  }
  const output = writes.join('\n');
  assert.match(output, /^Bounces since 2026-10-01T08:00:00/);
  assert.match(output, /: 1 - by producing role: coder x1/);
});

test('main() with --json prints the same figures the line reports, including a configured model', async () => {
  const root = mkRepo();
  const settingsPath = claudeSettingsPath(root, 'coder');
  fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
  fs.writeFileSync(settingsPath, JSON.stringify({ model: 'claude-opus-5-5' }));
  appendBounceRecordIfNew(root, {
    ticket: 'BL-1880',
    producingRole: 'coder',
    ticketType: 'feature',
    failureClass: 'behavior',
    commit: 'dddd444444',
    at: '2026-10-02T06:00:00.000Z',
    by: 'architect',
  });
  const originalCwd = process.cwd;
  const writes = [];
  const originalWrite = process.stdout.write;
  process.stdout.write = (chunk) => {
    writes.push(chunk);
    return true;
  };
  try {
    process.cwd = () => root;
    main({ at: '2026-10-02T07:00:00.000Z', json: true });
  } finally {
    process.stdout.write = originalWrite;
    process.cwd = originalCwd;
  }
  const report = JSON.parse(writes.join(''));
  assert.equal(report.windowTotal, 1);
  assert.equal(report.allTimeTotal, 1);
  assert.equal(report.windowByProducingRole[0].role, 'coder');
  assert.equal(report.windowByProducingRole[0].windowCount, report.windowTotal);
  assert.equal(report.windowByProducingRole[0].model, 'Opus 5.5');
});

test('main() reports "model unknown" for a producing role with no configured model', () => {
  const root = mkRepo();
  appendBounceRecordIfNew(root, {
    ticket: 'BL-1880',
    producingRole: 'cleaner',
    ticketType: 'feature',
    failureClass: 'behavior',
    commit: 'ffff666666',
    at: '2026-10-01T09:00:00.000Z',
    by: 'architect',
  });
  const originalCwd = process.cwd;
  const writes = [];
  const originalWrite = process.stdout.write;
  process.stdout.write = (chunk) => {
    writes.push(chunk);
    return true;
  };
  try {
    process.cwd = () => root;
    main({ at: '2026-10-02T07:00:00.000Z', json: true });
  } finally {
    process.stdout.write = originalWrite;
    process.cwd = originalCwd;
  }
  const report = JSON.parse(writes.join(''));
  assert.equal(report.windowByProducingRole[0].role, 'cleaner');
  assert.equal(report.windowByProducingRole[0].model, 'model unknown');
});

function runMainCapturingLine(root, atIso, targetOverride) {
  const originalCwd = process.cwd;
  const writes = [];
  const originalLog = console.log;
  console.log = (...args) => writes.push(args.join(' '));
  try {
    process.cwd = () => root;
    main(targetOverride ? { at: atIso, target: targetOverride } : { at: atIso });
  } finally {
    console.log = originalLog;
    process.cwd = originalCwd;
  }
  return writes.join('\n');
}

test('findPreviousBriefingFile picks the LATEST day strictly before today, skipping a non-matching filename and today\'s own file', () => {
  const root = mkRepo();
  // Earlier day, a non-matching filename alongside it (must be ignored by
  // the anchored DAY_KEY_PATTERN, not merely sorted after it), a LATER day
  // that is still strictly before "today", and today's own file (which
  // must never be picked - the CLI runs to feed content INTO it).
  commitBriefingFile(root, '2026-09-28', '2026-09-28T08:00:00+00:00');
  commitBriefingFile(root, '2026-10-01', '2026-10-01T08:00:00+00:00');
  const dir = path.join(root, 'docs', 'briefings');
  fs.writeFileSync(path.join(dir, 'notes-2026-10-01.md'), 'not a day-key file');
  fs.writeFileSync(path.join(dir, '2026-10-02.md'), '# today, must never be picked\n');
  git(root, ['add', '-A']);
  git(root, ['commit', '-q', '-m', 'stray + today files'], {
    GIT_AUTHOR_DATE: '2026-10-02T06:00:00+00:00',
    GIT_COMMITTER_DATE: '2026-10-02T06:00:00+00:00',
  });
  appendBounceRecordIfNew(root, {
    ticket: 'BL-1880',
    producingRole: 'coder',
    ticketType: 'feature',
    failureClass: 'behavior',
    commit: 'eeee555555',
    at: '2026-10-01T09:00:00.000Z',
    by: 'architect',
  });
  const output = runMainCapturingLine(root, '2026-10-02T07:00:00.000Z');
  // Picked 2026-10-01 (the latest day BEFORE today), never 2026-09-28 (an
  // earlier day that would also match "before today") and never
  // 2026-10-02 (today's own file).
  assert.match(output, /^Bounces since 2026-10-01T08:00:00/);
});

test('findPreviousBriefingSentAtIso reads the OLDEST commit touching the briefing file, not the newest', () => {
  const root = mkRepo();
  const dir = path.join(root, 'docs', 'briefings');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, '2026-10-01.md'), '# Briefing 2026-10-01\n');
  git(root, ['add', 'docs/briefings/2026-10-01.md']);
  git(root, ['commit', '-q', '-m', 'briefing: record sent marker 2026-10-01', '--date', '2026-10-01T08:00:00+00:00'], {
    GIT_AUTHOR_DATE: '2026-10-01T08:00:00+00:00',
    GIT_COMMITTER_DATE: '2026-10-01T08:00:00+00:00',
  });
  // A LATER commit amending the same file - a real briefing file is never
  // amended, but the function's own comment says it reads the oldest
  // commit "even if that ever changes"; this proves it actually does.
  fs.writeFileSync(path.join(dir, '2026-10-01.md'), '# Briefing 2026-10-01 (amended)\n');
  git(root, ['add', 'docs/briefings/2026-10-01.md']);
  git(root, ['commit', '-q', '-m', 'amend briefing 2026-10-01', '--date', '2026-10-01T23:00:00+00:00'], {
    GIT_AUTHOR_DATE: '2026-10-01T23:00:00+00:00',
    GIT_COMMITTER_DATE: '2026-10-01T23:00:00+00:00',
  });
  appendBounceRecordIfNew(root, {
    ticket: 'BL-1880',
    producingRole: 'coder',
    ticketType: 'feature',
    failureClass: 'behavior',
    commit: 'eeee555555',
    at: '2026-10-01T09:00:00.000Z',
    by: 'architect',
  });
  const output = runMainCapturingLine(root, '2026-10-02T07:00:00.000Z');
  assert.match(output, /^Bounces since 2026-10-01T08:00:00/, `expected the OLDEST commit's time, got: ${output}`);
});

test('a previous-day briefing file that was never committed falls back to the 24-hour window, never a crash', () => {
  const root = mkRepo();
  const dir = path.join(root, 'docs', 'briefings');
  fs.mkdirSync(dir, { recursive: true });
  // Written but never `git add`/`git commit` - findPreviousBriefingFile
  // finds it on disk, but `git log --follow` has no history for it, so
  // gitLog's own output is empty and findPreviousBriefingSentAtIso must
  // fall back to undefined rather than throwing or returning garbage.
  appendBounceRecordIfNew(root, {
    ticket: 'BL-1880',
    producingRole: 'coder',
    ticketType: 'feature',
    failureClass: 'behavior',
    commit: 'eeee555555',
    at: '2026-10-01T09:00:00.000Z',
    by: 'architect',
  });
  fs.writeFileSync(path.join(dir, '2026-10-01.md'), '# Briefing 2026-10-01 (never committed)\n');
  const output = runMainCapturingLine(root, '2026-10-02T07:00:00.000Z');
  assert.match(output, /^Bounces in the last 24 hours \(no previous briefing was found\)/);
});

test('no docs/briefings directory at all falls back to the 24-hour window', () => {
  const root = mkRepo();
  appendBounceRecordIfNew(root, {
    ticket: 'BL-1880',
    producingRole: 'coder',
    ticketType: 'feature',
    failureClass: 'behavior',
    commit: 'eeee555555',
    at: '2026-10-01T09:00:00.000Z',
    by: 'architect',
  });
  const output = runMainCapturingLine(root, '2026-10-02T07:00:00.000Z');
  assert.match(output, /^Bounces in the last 24 hours \(no previous briefing was found\)/);
});

test('DAY_KEY_PATTERN is anchored at both ends - a prefixed or suffixed near-miss filename is never mistaken for a day-key file', () => {
  const root = mkRepo();
  commitBriefingFile(root, '2026-09-28', '2026-09-28T08:00:00+00:00');
  const dir = path.join(root, 'docs', 'briefings');
  // Neither of these is ever committed, on purpose: if the ^ or $ anchor
  // were lost, DAY_KEY_PATTERN would match the "2026-10-01" substring
  // inside one of these names and findPreviousBriefingFile would
  // construct the LITERAL path "2026-10-01.md" - a file that does not
  // exist here - so gitLog would find no history for it and the window
  // would silently fall back to the last 24 hours instead of naming
  // 2026-09-28's real commit time.
  fs.writeFileSync(path.join(dir, 'prefix-2026-10-01.md'), 'would match without the ^ anchor');
  appendBounceRecordIfNew(root, {
    ticket: 'BL-1880',
    producingRole: 'coder',
    ticketType: 'feature',
    failureClass: 'behavior',
    commit: 'eeee555555',
    at: '2026-10-01T09:00:00.000Z',
    by: 'architect',
  });
  fs.writeFileSync(path.join(dir, '2026-10-01.md.disabled'), 'would match without the $ anchor');
  const output = runMainCapturingLine(root, '2026-10-02T07:00:00.000Z');
  assert.match(output, /^Bounces since 2026-09-28T08:00:00/, `expected the real 2026-09-28 commit, got: ${output}`);
});

test('a committed file for TODAY is excluded by the filter, not merely sorted before an earlier valid day', () => {
  // No non-matching junk filename here, on purpose: a stray name maps to a
  // real JS `undefined`, which Array.prototype.sort() ALWAYS moves to the
  // end regardless of the comparator - that would mask a dropped filter
  // (it would make dayKeys[dayKeys.length - 1] read undefined either way).
  // With only real, committed day-key files, dropping the `day < todayKey`
  // filter has nowhere to hide: today's own file would sort last for real.
  const root = mkRepo();
  commitBriefingFile(root, '2026-09-28', '2026-09-28T08:00:00+00:00');
  const dir = path.join(root, 'docs', 'briefings');
  fs.writeFileSync(path.join(dir, '2026-10-02.md'), '# today, must never be picked\n');
  git(root, ['add', '-A']);
  git(root, ['commit', '-q', '-m', "today's own file"], {
    GIT_AUTHOR_DATE: '2026-10-02T06:00:00+00:00',
    GIT_COMMITTER_DATE: '2026-10-02T06:00:00+00:00',
  });
  appendBounceRecordIfNew(root, {
    ticket: 'BL-1880',
    producingRole: 'coder',
    ticketType: 'feature',
    failureClass: 'behavior',
    commit: 'eeee555555',
    at: '2026-10-01T09:00:00.000Z',
    by: 'architect',
  });
  const output = runMainCapturingLine(root, '2026-10-02T07:00:00.000Z');
  assert.match(output, /^Bounces since 2026-09-28T08:00:00/, `expected 2026-09-28, not today's own file: ${output}`);
});

test('a docs/briefings directory that exists but has no day-key files falls back to the 24-hour window', () => {
  const root = mkRepo();
  const dir = path.join(root, 'docs', 'briefings');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'README.md'), 'not a day-key file');
  appendBounceRecordIfNew(root, {
    ticket: 'BL-1880',
    producingRole: 'coder',
    ticketType: 'feature',
    failureClass: 'behavior',
    commit: 'eeee555555',
    at: '2026-10-01T09:00:00.000Z',
    by: 'architect',
  });
  const output = runMainCapturingLine(root, '2026-10-02T07:00:00.000Z');
  assert.match(output, /^Bounces in the last 24 hours \(no previous briefing was found\)/);
});

test('a previous-day briefing file in a target that is not a git repository at all falls back to the 24-hour window', () => {
  // cwd stays a real repo (mkRepo) so resolveCliMainWorktreeContext() can
  // find .swarmforge/roles.tsv the usual way; the business-logic target
  // (readBounceRecords, findPreviousBriefingSentAtIso's gitLog call) is a
  // separate, plain non-git directory, passed explicitly via --target -
  // the two are independent inputs and this is the only way to make
  // `git log` genuinely throw (ENOTGITREPO) without main() itself failing.
  const cwdRoot = mkRepo();
  const target = mkTmp('sfvc-qa-bounce-line-nogit-');
  const dir = path.join(target, 'docs', 'briefings');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, '2026-10-01.md'), '# Briefing 2026-10-01\n');
  appendBounceRecordIfNew(target, {
    ticket: 'BL-1880',
    producingRole: 'coder',
    ticketType: 'feature',
    failureClass: 'behavior',
    commit: 'eeee555555',
    at: '2026-10-01T09:00:00.000Z',
    by: 'architect',
  });
  const output = runMainCapturingLine(cwdRoot, '2026-10-02T07:00:00.000Z', target);
  assert.match(output, /^Bounces in the last 24 hours \(no previous briefing was found\)/);
});
