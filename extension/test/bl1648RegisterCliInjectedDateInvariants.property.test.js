'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { mkTmpDir } = require('./helpers/tmpDir');

// BL-1648's two declared invariants (property authorship rests with the
// coder, first pass - BL-654). Runs ONLY via `npm run test:properties`
// (vitest.properties.config.mjs).

const REPO_ROOT = path.join(__dirname, '..', '..');
const CLI = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'standing_red_register_cli.bb');

// BL-1766: standing_red_register_cli.bb with no --now reads the JVM's
// LOCAL day (java.time.LocalDate/now), not UTC - Date#toISOString() is
// always UTC, so a UTC-day "today" is wrong from local midnight to UTC
// midnight (a whole hour during BST). Node's own local getters (which
// respect TZ, exactly like the JVM does) give the same day the CLI reads.
function localDay(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function write(root, relPath, content) {
  const full = path.join(root, relPath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
}

function buildFixture(firstSeen) {
  const root = mkTmpDir('sfvc-bl1648-prop-');
  write(root, 'backlog/active/BL-9001-x.yaml', 'id: BL-9001\nstatus: todo\n');
  write(root, 'swarmforge/scripts/property_suite_standing_allowlist.tsv', 'file\tdisposition\trationale\n');
  write(
    root,
    'backlog/standing-reds.tsv',
    `# header\nunit\textension/test/old.test.js\tBL-9001\t${firstSeen}\toldest row for this fixture\n`
  );
  write(root, 'backlog/hardening-debt-ledger.yaml', '# ledger\n');
  return root;
}

function runCli(root, now) {
  const args = [CLI, root, ...(now ? ['--now', now] : [])];
  const result = spawnSync('bb', args, { encoding: 'utf8', timeout: 30000 });
  return { status: result.status, stdout: result.stdout || '', stderr: result.stderr || '' };
}

// ── Invariant 2: "The register CLI with no date argument reads today's
// date; an injected date changes only the age arithmetic, never which
// rows exist or who owns them." ─────────────────────────────────────────
//
// Generalizes past the acceptance feature's two fixed dates
// (2026-09-05/2026-12-01) via a spread of (firstSeen, injectedDate) pairs
// spanning both "the injected date is after first-seen" (a real positive
// age) and "before it" (a real negative age, e.g. a mistyped historical
// pin) - the CLI's own age-days arithmetic never special-cases either
// direction, so both must be reachable, not just the ordinary one.
const DATE_PAIRS = [
  ['2026-08-01', '2026-09-05', 35],
  ['2026-08-01', '2026-08-01', 0],
  ['2026-01-01', '2026-12-31', 364],
  ['2026-09-05', '2026-08-01', -35], // injected date BEFORE first-seen
  ['2026-03-01', '2026-03-02', 1],
];

test('property (BL-1648 invariant 2): an injected date changes only the age arithmetic - never rows, tickets or owned flags - and the age equals the exact day difference', () => {
  for (const [firstSeen, injected, expectedAge] of DATE_PAIRS) {
    const root = buildFixture(firstSeen);
    try {
      const reportA = JSON.parse(runCli(root, injected).stdout.trim());
      assert.equal(
        reportA.rows[0].age_days,
        expectedAge,
        `firstSeen=${firstSeen} now=${injected}: expected age ${expectedAge}, got ${reportA.rows[0].age_days}`
      );

      // Injecting a SECOND, different date changes only the age - every
      // other field (lane/file/ticket/first_seen/owned) is byte-identical.
      const otherDate = injected === '2026-01-01' ? '2026-06-15' : '2026-01-01';
      const reportB = JSON.parse(runCli(root, otherDate).stdout.trim());
      const strip = (rows) => rows.map(({ age_days, ...rest }) => rest);
      assert.deepEqual(strip(reportA.rows), strip(reportB.rows), 'rows/tickets/owned must not depend on which date was injected');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  }
});

test('property (BL-1648 invariant 2) non-vacuity: distinct injected dates really do produce distinct ages', () => {
  const root = buildFixture('2026-08-01');
  try {
    const a = JSON.parse(runCli(root, '2026-08-01').stdout.trim()).rows[0].age_days;
    const b = JSON.parse(runCli(root, '2026-09-05').stdout.trim()).rows[0].age_days;
    assert.notEqual(a, b);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('property (BL-1648 invariant 2): no date argument reads today (age 0 for a row first seen today)', () => {
  // Reads the local day before AND after the CLI call: a local midnight
  // that falls inside this test's own run (the CLI now reads the next
  // local day) is accepted as age 1, never a flake or a retry - anything
  // else is a real invariant-2 violation.
  const dayBefore = localDay();
  const root = buildFixture(dayBefore);
  try {
    const report = JSON.parse(runCli(root, null).stdout.trim());
    const dayAfter = localDay();
    const crossedMidnight = dayAfter !== dayBefore;
    const expectedAge = crossedMidnight ? 1 : 0;
    assert.equal(report.rows[0].age_days, expectedAge);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// ── Invariant 1: "No acceptance scenario asserts a value that depends on
// the real clock: any age, deadline or 'today' a scenario checks is
// computed from a date the scenario itself pins." ──────────────────────
//
// A codebase-wide audit claim, NOT executable as a source-text scan the
// way it first looks: BL-1428's own now-FIXED handler still reads
// `assert.equal(report.oldest_age_days, 35, ...)` at
// specs/pipeline/steps/bl1428StandingRedRegisterSteps.js:78 - the literal
// 35 is now correct and stable BECAUSE the `report` it compares against
// was itself produced from a pinned date (`run('report', '2026-09-05')`),
// not because the number is absent. Whether an age assertion is a "time
// bomb" depends on how its INPUT was produced (did the date reaching the
// CLI trace to a real clock read or a fixture-pinned literal?), which is
// a data-flow question a regex over the assertion line alone cannot
// answer without false-positiving on exactly the file this ticket just
// fixed - the "quantifies over process, not a pure testable module"
// exemption (BL-654) applies. The practical, executable verification
// this ticket actually used is the grep-and-inspect audit in
// backlog/evidence/BL-1648-coder-clock-bound-assertion-grep-20260919.md
// (every `Date.now()`/`LocalDate/now`-using handler and every
// age/days-shaped hardcoded assertion in specs/pipeline/steps/*.js,
// read by hand) - not repeated here as a second, unreliable copy.
