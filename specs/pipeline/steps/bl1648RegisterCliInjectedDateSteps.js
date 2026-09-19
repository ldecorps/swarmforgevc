'use strict';

// BL-1648: step handlers for "The register CLI takes an injected date so
// an age scenario is never a time bomb"
// (specs/features/BL-1648-the-register-cli-takes-an-injected-date.feature).
// Drives the REAL standing_red_register_cli.bb against a real mkdtemp
// fixture root (BL-1390) - never a reimplementation of the register's own
// join/ownership/age logic. Root creation goes through fixtureReaper's
// trackedTmpRoot() (BL-1636's own standing unregistered-mkdtemp guard) -
// a bare fs.mkdtempSync here would leak the root on a thrown assertion.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { trackedTmpRoot } = require('./lib/fixtureReaper');

const FEATURE = "BL-1648 The register CLI takes an injected date so an age scenario is never a time bomb";

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const CLI = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'standing_red_register_cli.bb');
const OLDEST_ROW_FIRST_SEEN = '2026-08-01';

function write(root, relPath, content) {
  const full = path.join(root, relPath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
}

function buildFixture(firstSeen) {
  const root = trackedTmpRoot('bl1648-fixture-');
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

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(
    /^a fixture root with a standing-red register whose oldest row was first seen 2026-08-01 and a backlog holding an open ticket for it$/,
    (ctx) => {
      ctx.bl1648 = { root: buildFixture(OLDEST_ROW_FIRST_SEEN) };
    }
  );

  // ── Scenario 01 ───────────────────────────────────────────────────────
  scoped(/^the register CLI reads the fixture root as of (\d{4}-\d{2}-\d{2})$/, (ctx, asOf) => {
    ctx.bl1648.result = runCli(ctx.bl1648.root, asOf);
  });

  scoped(/^the report's oldest age in days is (\d+)$/, (ctx, expected) => {
    assert.equal(ctx.bl1648.result.status, 0, `expected the CLI to succeed:\n${ctx.bl1648.result.stderr}`);
    const report = JSON.parse(ctx.bl1648.result.stdout.trim());
    assert.equal(report.oldest_age_days, Number(expected));
  });

  // ── Scenario 02 ───────────────────────────────────────────────────────
  scoped(/^a register row first seen on the current date$/, (ctx) => {
    ctx.bl1648.root = buildFixture(todayIso());
  });

  scoped(/^the register CLI reads the fixture root with no date given$/, (ctx) => {
    ctx.bl1648.result = runCli(ctx.bl1648.root, null);
  });

  scoped(/^that row's age in days is (\d+)$/, (ctx, expected) => {
    assert.equal(ctx.bl1648.result.status, 0, `expected the CLI to succeed:\n${ctx.bl1648.result.stderr}`);
    const report = JSON.parse(ctx.bl1648.result.stdout.trim());
    const row = report.rows.find((r) => r.ticket === 'BL-9001');
    assert.ok(row, `expected the BL-9001 row: ${JSON.stringify(report.rows)}`);
    assert.equal(row.age_days, Number(expected));
  });

  // ── Scenario 03 ───────────────────────────────────────────────────────
  scoped(/^the register CLI reads the fixture root as of (\d{4}-\d{2}-\d{2}) and again as of (\d{4}-\d{2}-\d{2})$/, (ctx, first, second) => {
    ctx.bl1648.reportA = JSON.parse(runCli(ctx.bl1648.root, first).stdout.trim());
    ctx.bl1648.reportB = JSON.parse(runCli(ctx.bl1648.root, second).stdout.trim());
  });

  scoped(/^both reports list the same rows with the same owners and the same owned flags$/, (ctx) => {
    const strip = (rows) => rows.map(({ age_days, ...rest }) => rest);
    assert.deepEqual(strip(ctx.bl1648.reportA.rows), strip(ctx.bl1648.reportB.rows));
  });

  scoped(/^only the ages differ$/, (ctx) => {
    const agesA = ctx.bl1648.reportA.rows.map((r) => r.age_days);
    const agesB = ctx.bl1648.reportB.rows.map((r) => r.age_days);
    assert.notDeepEqual(agesA, agesB, 'expected the two pinned dates to produce different ages');
  });

  // ── Scenario 04 ───────────────────────────────────────────────────────
  scoped(/^the register CLI reads the fixture root as of "([^"]+)"$/, (ctx, malformed) => {
    ctx.bl1648.result = runCli(ctx.bl1648.root, malformed);
  });

  scoped(/^it exits non-zero naming the date argument$/, (ctx) => {
    assert.notEqual(ctx.bl1648.result.status, 0);
    assert.match(ctx.bl1648.result.stderr, /--now/, `expected the refusal to name the argument: ${ctx.bl1648.result.stderr}`);
  });

  scoped(/^it prints no report$/, (ctx) => {
    assert.equal(ctx.bl1648.result.stdout.trim(), '');
  });
}

module.exports = { registerSteps };
