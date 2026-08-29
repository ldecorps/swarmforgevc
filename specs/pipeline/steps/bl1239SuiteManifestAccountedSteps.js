'use strict';

// BL-1239: swarmforge/scripts/test/run_bb_suite.sh refused to run at all while
// any file under the test tree was absent from suite-manifest.tsv - 45 were, so
// the ONLY gate wired for Babashka and shell code ran nothing. Three of the
// manifest's own rows carried a ticket id where the filename belongs and so
// registered nothing while looking like a registration.
//
// These steps drive the REAL suite_inventory_cli.bb and the REAL
// run_bb_suite.sh against the REAL test tree - never a reimplementation of the
// inventory verdict, which is the thing under test.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const TEST_DIR = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'test');
const INVENTORY_CLI = path.join(TEST_DIR, 'suite_inventory_cli.bb');
const SUITE_RUNNER = path.join(TEST_DIR, 'run_bb_suite.sh');
const MANIFEST = path.join(TEST_DIR, 'suite-manifest.tsv');

const FEATURE_NAME = 'The Babashka suite runs because every test file is accounted for';
const FIXTURE_PREFIX = 'bl1239-manifest-';

// Scenario Outline rows are validated against these explicit values rather
// than passed through: an Outline whose handler accepts whatever the table
// says asserts nothing (engineering rules, Acceptance Pipeline).
const KNOWN_LANES = new Set(['standing', 'excluded']);
const KNOWN_FIELDS = new Map([
  ['an empty date and reason', 'standing'],
  ['both a date and a reason', 'excluded'],
]);

function sweepStaleFixtures() {
  const tmp = os.tmpdir();
  for (const name of fs.readdirSync(tmp)) {
    if (name.startsWith(FIXTURE_PREFIX)) {
      fs.rmSync(path.join(tmp, name), { recursive: true, force: true });
    }
  }
}

function isTestFile(name) {
  return (name.startsWith('test_') && name.endsWith('.sh')) || name.endsWith('_test_runner.bb');
}

function discoverTestFiles(dir) {
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile())
    .map((e) => e.name)
    .filter(isTestFile)
    .sort();
}

function parseManifest(text) {
  return text
    .split('\n')
    .filter((line) => line.trim() !== '' && !line.trim().startsWith('#'))
    .map((line) => {
      const [file = '', lane = '', date = '', reason = ''] = line.split('\t');
      return { file: file.trim(), lane: lane.trim(), date: date.trim(), reason: reason.trim(), raw: line };
    });
}

function runInventory(dir) {
  const res = spawnSync('bb', [INVENTORY_CLI, dir], { encoding: 'utf8', timeout: 120_000 });
  return { status: res.status, out: `${res.stdout || ''}${res.stderr || ''}` };
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE_NAME);

  scoped(/^every file under the test directory$/, (ctx) => {
    ctx.dir = TEST_DIR;
    ctx.discovered = discoverTestFiles(TEST_DIR);
    if (ctx.discovered.length === 0) {
      throw new Error(`no test files discovered under ${TEST_DIR} - the fixture cannot prove anything`);
    }
  });

  scoped(/^a manifest row whose first column is not a file under the test directory$/, (ctx) => {
    sweepStaleFixtures();
    ctx.dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), FIXTURE_PREFIX)));
    // A tree that is otherwise in perfect agreement with its manifest, so the
    // only thing the check can complain about is the malformed row.
    fs.writeFileSync(path.join(ctx.dir, 'test_real.sh'), '#!/usr/bin/env bash\nexit 0\n');
    ctx.malformedRow = 'BL-780';
    fs.writeFileSync(
      path.join(ctx.dir, 'suite-manifest.tsv'),
      '# fixture\ntest_real.sh\tstanding\t\t\n'
        + `${ctx.malformedRow}\tbl780_rotation_actionability_ordering\ttest_bl780_rotation_actionability_ordering.sh\tunit\n`,
    );
  });

  scoped(/^the suite runner performs its inventory check$/, (ctx) => {
    ctx.result = runInventory(ctx.dir);
  });

  scoped(/^no file is reported as absent from the manifest$/, (ctx) => {
    if (ctx.result.out.includes('not in the manifest:')) {
      throw new Error(`the inventory check still reports files absent from the manifest:\n${ctx.result.out}`);
    }
    if (ctx.result.status !== 0) {
      throw new Error(`the inventory check failed (exit ${ctx.result.status}):\n${ctx.result.out}`);
    }
  });

  scoped(/^the suite proceeds to run its tests$/, (ctx) => {
    // --list gets past the inventory gate (which runs first and
    // unconditionally) and prints exactly what the suite would run. A suite
    // that could not get past the gate prints nothing and exits 1.
    const env = { ...process.env };
    delete env.TMUX;
    const res = spawnSync('bash', [SUITE_RUNNER, '--list'], { encoding: 'utf8', env, timeout: 120_000 });
    if (res.status !== 0) {
      throw new Error(`run_bb_suite.sh --list did not get past the inventory gate (exit ${res.status}):\n${res.stdout || ''}${res.stderr || ''}`);
    }
    const listed = (res.stdout || '').split('\n').filter((l) => l.trim() !== '');
    if (listed.length === 0) {
      throw new Error('run_bb_suite.sh --list named no tests - the suite would run nothing');
    }
    for (const f of listed) {
      if (!fs.existsSync(path.join(TEST_DIR, f))) {
        throw new Error(`the suite would try to run a file that does not exist: ${f}`);
      }
    }
    ctx.listed = listed;
  });

  scoped(/^a manifest row in the (\S+) lane$/, (ctx, lane) => {
    if (!KNOWN_LANES.has(lane)) {
      throw new Error(`unknown lane ${JSON.stringify(lane)} - the manifest declares only ${[...KNOWN_LANES].join(', ')}`);
    }
    ctx.lane = lane;
    ctx.rows = parseManifest(fs.readFileSync(MANIFEST, 'utf8')).filter((r) => r.lane === lane);
    if (ctx.rows.length === 0) {
      throw new Error(`no rows in the ${lane} lane - the assertion below would be vacuous`);
    }
  });

  scoped(/^the row names a file that exists under the test directory$/, (ctx) => {
    for (const row of ctx.rows) {
      if (!isTestFile(row.file)) {
        throw new Error(`row's first column is not a test file name: ${JSON.stringify(row.raw)}`);
      }
      if (!fs.existsSync(path.join(TEST_DIR, row.file))) {
        throw new Error(`row names a file that does not exist: ${row.file}`);
      }
    }
  });

  scoped(/^the row carries (.+) for that lane$/, (ctx, fields) => {
    const expectedLane = KNOWN_FIELDS.get(fields);
    if (expectedLane === undefined) {
      throw new Error(`unknown field expectation ${JSON.stringify(fields)} - known: ${[...KNOWN_FIELDS.keys()].join(' | ')}`);
    }
    if (expectedLane !== ctx.lane) {
      throw new Error(`field expectation ${JSON.stringify(fields)} belongs to the ${expectedLane} lane, not ${ctx.lane}`);
    }
    for (const row of ctx.rows) {
      if (ctx.lane === 'standing') {
        if (row.date !== '' || row.reason !== '') {
          throw new Error(`a standing row carries a date or reason: ${JSON.stringify(row.raw)}`);
        }
      } else {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(row.date)) {
          throw new Error(`an excluded row has no YYYY-MM-DD date: ${JSON.stringify(row.raw)}`);
        }
        if (row.reason === '') {
          throw new Error(`an excluded row has no reason: ${JSON.stringify(row.raw)}`);
        }
        // "It is failing" is explicitly NOT a reason to exclude.
        if (/fail|red|broken/i.test(row.reason)) {
          throw new Error(`an exclusion reason may not be that the test fails: ${JSON.stringify(row.raw)}`);
        }
      }
    }
  });

  scoped(/^the check fails and names that row$/, (ctx) => {
    try {
      if (ctx.result.status === 0) {
        throw new Error(`the inventory check passed a manifest carrying a malformed row:\n${ctx.result.out}`);
      }
      if (!ctx.result.out.includes(ctx.malformedRow)) {
        throw new Error(`the inventory check failed without naming the malformed row ${ctx.malformedRow}:\n${ctx.result.out}`);
      }
      if (!ctx.result.out.includes('first column is not a test file name')) {
        throw new Error(`the malformed row was not reported as malformed:\n${ctx.result.out}`);
      }
    } finally {
      // BL-971: in a finally, so a failed assertion cannot leak the fixture.
      fs.rmSync(ctx.dir, { recursive: true, force: true });
    }
  });
}

module.exports = { registerSteps };
