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
  const kept = recordsAfter(records, '2026-10-01T08:00:00.000Z', '2026-10-02T00:00:00.000Z');
  assert.deepEqual(
    kept.map((r) => r.at),
    ['2026-10-01T08:00:00.001Z']
  );
});

// QA bounce 2026-10-07 D4: the window has an upper bound too - a record
// after the render time (nowIso) must never count, even though it is
// strictly after the start.
test('recordsAfter excludes a record exactly at, and after, the render time', () => {
  const records = [
    { at: '2026-10-01T09:00:00.000Z', producingRole: 'coder' },
    { at: '2026-10-01T10:00:00.000Z', producingRole: 'coder' },
    { at: '2026-10-01T10:00:00.001Z', producingRole: 'coder' },
  ];
  const kept = recordsAfter(records, '2026-10-01T08:00:00.000Z', '2026-10-01T10:00:00.000Z');
  assert.deepEqual(
    kept.map((r) => r.at),
    ['2026-10-01T09:00:00.000Z', '2026-10-01T10:00:00.000Z']
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
  // QA bounce 2026-10-07 D1: the window's OWN bouncing-role split (2,
  // architect-only) must appear, distinct from the all-time split (5,
  // architect x3 + QA x2) - and the all-time clauses are explicitly
  // labelled, never printed as if they were a breakdown of the window
  // total above them.
  assert.match(line, /by bouncing role: architect x2 - all-time by bouncing role: architect x3, QA x2/);
  assert.match(line, /all-time by ticket type: .*\(1\.2 defects\/bounce\)/);
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
// briefing sent-at record, a real configured model, and --json ──────────

// QA bounce 2026-10-07 D1 (2nd pass): neither the previous briefing file's
// own commit (1st-pass D3) nor the commit that adds a day key to
// .sent.json (this bounce) is the real send - a commit can lag the send by
// days (measured 2026-10-06T01:43Z: four days' markers landed in one later
// commit). The real send instant now lives in .sent.json's own "sent-at"
// map (briefing_email_lib.bb's record-briefing-sent!), read straight off
// disk - no git involved at all. These fixtures write that map directly.
function writeSentAt(root, entries) {
  const dir = path.join(root, 'docs', 'briefings');
  fs.mkdirSync(dir, { recursive: true });
  const sentPath = path.join(dir, '.sent.json');
  let state = {};
  try {
    state = JSON.parse(fs.readFileSync(sentPath, 'utf8'));
  } catch {
    state = {};
  }
  const sentAt = { ...(state['sent-at'] || {}), ...entries };
  const sent = Array.from(new Set([...(state.sent || []), ...Object.keys(entries)]));
  fs.writeFileSync(sentPath, JSON.stringify({ sent, 'sent-at': sentAt }));
}

test('main() with --at and a real previous-briefing sent-at record prints the window leading the line', async () => {
  const root = mkRepo();
  writeSentAt(root, { '2026-10-01.md': '2026-10-01T08:00:00+00:00' });
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

test('findPreviousBriefingSentAtIso picks the MOST RECENT sent-at strictly before now, across several recorded sends', () => {
  const root = mkRepo();
  writeSentAt(root, {
    '2026-09-28.md': '2026-09-28T08:00:00+00:00',
    '2026-10-01.md': '2026-10-01T08:00:00+00:00',
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
  // Picked 2026-10-01 (the most recent sent-at before the render), never
  // 2026-09-28 (an earlier send that would also be "before now").
  assert.match(output, /^Bounces since 2026-10-01T08:00:00/);
});

test('findPreviousBriefingSentAtIso picks the most recent sent-at by VALUE, not by insertion order in the map', () => {
  const root = mkRepo();
  // The chronologically LATER entry is inserted FIRST, and the earlier
  // one SECOND - the reverse of Object.values' iteration order a naive
  // "last one wins" walk would rely on. Only a genuine ms > bestMs
  // comparison picks the later date here.
  writeSentAt(root, {
    '2026-10-01.md': '2026-10-01T08:00:00+00:00',
    '2026-09-28.md': '2026-09-28T08:00:00+00:00',
  });
  appendBounceRecordIfNew(root, {
    ticket: 'BL-1880',
    producingRole: 'coder',
    ticketType: 'feature',
    failureClass: 'behavior',
    commit: 'eeee555556',
    at: '2026-10-01T09:00:00.000Z',
    by: 'architect',
  });
  const output = runMainCapturingLine(root, '2026-10-02T07:00:00.000Z');
  assert.match(
    output,
    /^Bounces since 2026-10-01T08:00:00/,
    `expected the chronologically later sent-at, got: ${output}`
  );
});

// QA bounce 2026-10-07 D1 (2nd pass), the defect's own remediation
// pointer: "refuse a window start at or after the render time (fall back
// to 24 h, saying so)". A sent-at entry recorded AFTER the moment this CLI
// is asked to render for (a clock skew between hosts, or --at rendering
// for a past moment) must never produce a backwards or zero-length
// window - it is treated as if absent entirely.
test('a sent-at recorded AT OR AFTER the render time is never used - falls back to the 24-hour window', () => {
  const root = mkRepo();
  writeSentAt(root, { '2026-10-02.md': '2026-10-02T07:00:00.000Z' });
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
  assert.match(output, /^Bounces in the last 24 hours \(no previous briefing was found\)/, `expected the 24h fallback, got: ${output}`);
});

test('a strictly-later sent-at still loses to the render-time guard even with an earlier, usable sent-at also on record', () => {
  const root = mkRepo();
  writeSentAt(root, {
    '2026-10-01.md': '2026-10-01T08:00:00+00:00',
    '2026-10-02.md': '2026-10-02T08:00:00.000Z', // after the render time below
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
  assert.match(output, /^Bounces since 2026-10-01T08:00:00/, `expected the earlier, usable sent-at, got: ${output}`);
});

test('a .sent.json with no "sent-at" key at all (pre-BL-1880 shape) falls back to the 24-hour window, never a crash', () => {
  const root = mkRepo();
  const dir = path.join(root, 'docs', 'briefings');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, '.sent.json'), JSON.stringify({ sent: ['2026-10-01.md'] }));
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

test('a malformed .sent.json (invalid JSON) falls back to the 24-hour window, never a crash', () => {
  const root = mkRepo();
  const dir = path.join(root, 'docs', 'briefings');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, '.sent.json'), '{ not valid json');
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
