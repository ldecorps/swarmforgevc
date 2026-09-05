'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

// BL-1175: standing property-suite reds must not block unrelated green commits.
// Runs ONLY via npm run test:properties.

const REPO_ROOT = path.join(__dirname, '..', '..');
const GUARD = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'check_property_suite_drift.sh');
const ALLOWLIST_TSV = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'property_suite_standing_allowlist.tsv');
const ALLOWLIST_LIB = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'property_suite_standing_allowlist_lib.sh');
const CANARY_LIB = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'property_suite_shared_repo_guard.sh');

function runGuard(cwd, suiteArgv, env = {}) {
  const merged = { ...process.env, ...env };
  if (!Object.prototype.hasOwnProperty.call(env, 'SWARMFORGE_SKIP_PROPERTY_SUITE_GUARD')) {
    delete merged.SWARMFORGE_SKIP_PROPERTY_SUITE_GUARD;
  }
  return spawnSync('bash', [GUARD, ...suiteArgv], { cwd, encoding: 'utf8', env: merged });
}

function readInventory() {
  const rows = fs.readFileSync(ALLOWLIST_TSV, 'utf8').trim().split('\n').slice(1);
  return rows.map((line) => {
    const [file, disposition, rationale] = line.split('\t');
    return { file, disposition, rationale: rationale ?? '' };
  });
}

function bashExtractFailures(output) {
  const r = spawnSync('bash', ['-c', `source '${ALLOWLIST_LIB}'; ps_suite_extract_failing_files "$(cat)"`], {
    input: output,
    encoding: 'utf8',
  });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout.trim().split('\n').filter(Boolean);
}

test('BL-1175 invariant 1: every standing-red inventory row has fix-or-allowlist disposition', () => {
  const inventory = readInventory();
  // BL-1430: not a fixed floor - this file's whole purpose is to shrink as
  // reds get fixed (BL-1428 pruned 25->20; BL-1430 fixed two more ->18), so
  // a hardcoded count breaks on every legitimate reduction. The structural
  // checks below (per-row shape, disposition, rationale) are the actual
  // invariant; this only guards against the inventory going silently empty.
  assert.ok(inventory.length > 0, `expected a non-empty standing inventory, got ${inventory.length} rows`);
  for (const row of inventory) {
    assert.match(row.file, /^test\/.*\.property\.test\.js$/, JSON.stringify(row));
    assert.ok(['allowlist', 'fix'].includes(row.disposition), JSON.stringify(row));
    assert.ok(row.rationale.length > 0, JSON.stringify(row));
  }
  const failSample = ' FAIL  test/not-in-inventory.property.test.js > x\n';
  const parsed = bashExtractFailures(failSample);
  assert.deepEqual(parsed, ['test/not-in-inventory.property.test.js']);
});

test('BL-1175 invariant 2: all-allowlisted suite red allows; non-allowlisted red refuses without SKIP', () => {
  const allowlisted = readInventory()[0].file;
  const allowlistedOnly = [
    'bash',
    '-c',
    `printf '%s\\n' ' FAIL  ${allowlisted} > x' >&2; exit 1`,
  ];
  const mixed = [
    'bash',
    '-c',
    `printf '%s\\n' ' FAIL  ${allowlisted} > x' ' FAIL  test/pipelineBoard.property.test.js > y' >&2; exit 1`,
  ];
  const tmp = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'bl1175-prop-'));
  try {
    spawnSync('git', ['init', '-q', '-b', 'main'], { cwd: tmp });
    spawnSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'init'], { cwd: tmp });
    fs.mkdirSync(path.join(tmp, 'extension', 'src'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'extension', 'src', 'a.ts'), 'x\n');
    spawnSync('git', ['add', 'extension/src/a.ts'], { cwd: tmp });

    const ok = runGuard(tmp, allowlistedOnly);
    assert.equal(ok.status, 0, `${ok.stdout}\n${ok.stderr}`);
    assert.match(`${ok.stdout}\n${ok.stderr}`, /allowlisted-standing-reds/);

    const bad = runGuard(tmp, mixed);
    assert.notEqual(bad.status, 0, `${bad.stdout}\n${bad.stderr}`);
    assert.match(`${bad.stdout}\n${bad.stderr}`, /pipelineBoard\.property\.test\.js/);
    assert.doesNotMatch(`${bad.stdout}\n${bad.stderr}`, /overridden/i);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('BL-1175 invariant 3: SKIP stays recovery-only; stock green suite keeps BL-1124 canary path', () => {
  const guardSrc = fs.readFileSync(GUARD, 'utf8');
  assert.match(guardSrc, /SWARMFORGE_SKIP_PROPERTY_SUITE_GUARD=1.*recovery-only/s);
  assert.match(guardSrc, /bl1124_snapshot/);
  assert.match(guardSrc, /bl1124_assert_unchanged/);
  const skipIdx = guardSrc.indexOf('SWARMFORGE_SKIP_PROPERTY_SUITE_GUARD');
  const allowlistIdx = guardSrc.indexOf('allowlisted-standing-reds');
  assert.ok(skipIdx >= 0 && allowlistIdx >= 0 && skipIdx < allowlistIdx);
  assert.match(guardSrc, /never the standing recipe/);

  const canarySrc = fs.readFileSync(CANARY_LIB, 'utf8');
  assert.match(canarySrc, /bl1124_assert_unchanged/);

  const tmp = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'bl1175-canary-'));
  try {
    spawnSync('git', ['init', '-q', '-b', 'main'], { cwd: tmp });
    spawnSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'init'], { cwd: tmp });
    fs.mkdirSync(path.join(tmp, 'extension', 'src'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'extension', 'src', 'a.ts'), 'x\n');
    spawnSync('git', ['add', 'extension/src/a.ts'], { cwd: tmp });
    const before = spawnSync('bash', ['-c', `source '${CANARY_LIB}'; bl1124_snapshot '${tmp}'`], { encoding: 'utf8' });
    assert.equal(before.status, 0);
    const green = runGuard(tmp, ['bash', '-c', 'exit 0']);
    assert.equal(green.status, 0, `${green.stdout}\n${green.stderr}`);
    const after = spawnSync('bash', ['-c', `source '${CANARY_LIB}'; bl1124_snapshot '${tmp}'`], { encoding: 'utf8' });
    assert.equal(after.stdout.trim(), before.stdout.trim());

    const skip = runGuard(tmp, ['bash', '-c', 'exit 1'], { SWARMFORGE_SKIP_PROPERTY_SUITE_GUARD: '1' });
    assert.equal(skip.status, 0);
    assert.match(`${skip.stdout}\n${skip.stderr}`, /overridden/i);
    assert.doesNotMatch(`${skip.stdout}\n${skip.stderr}`, /allowlisted-standing-reds/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
