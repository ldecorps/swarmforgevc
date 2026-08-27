'use strict';

// BL-1175: standing property-suite reds must not block unrelated green commits.
// Drives the REAL check_property_suite_drift.sh with injectable suite output.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const FEATURE = 'standing property-suite reds must not block unrelated green commits';
const REPO = path.join(__dirname, '..', '..', '..');
const GUARD = path.join(REPO, 'swarmforge', 'scripts', 'check_property_suite_drift.sh');
const ALLOWLIST_TSV = path.join(REPO, 'swarmforge', 'scripts', 'property_suite_standing_allowlist.tsv');
const CANARY_LIB = path.join(REPO, 'swarmforge', 'scripts', 'property_suite_shared_repo_guard.sh');

function git(cwd, args) {
  const r = spawnSync('git', ['-C', cwd, ...args], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr || r.stdout || args.join(' '));
  return r;
}

function ensure(ctx) {
  if (!ctx.bl1175) {
    ctx.bl1175 = {
      root: fs.mkdtempSync(path.join(os.tmpdir(), 'bl1175-')),
      out: '',
      status: null,
      inventory: [],
      suite: 'green',
      envSkip: false,
      beforeSnap: '',
      afterSnap: '',
    };
    git(ctx.bl1175.root, ['init', '-q', '-b', 'main']);
    git(ctx.bl1175.root, ['-c', 'user.email=test@test', '-c', 'user.name=test', 'commit', '-q', '--allow-empty', '-m', 'init']);
  }
  return ctx.bl1175;
}

function cleanup(ctx) {
  if (ctx.bl1175?.root) fs.rmSync(ctx.bl1175.root, { recursive: true, force: true });
  ctx.bl1175 = null;
}

function write(root, rel, body) {
  const full = path.join(root, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, body);
}

function readInventory() {
  return fs
    .readFileSync(ALLOWLIST_TSV, 'utf8')
    .trim()
    .split('\n')
    .slice(1)
    .map((line) => {
      const [file, disposition, rationale] = line.split('\t');
      return { file, disposition, rationale: rationale ?? '' };
    });
}

function runGuard(st) {
  const allowlisted = readInventory()[0]?.file ?? 'test/bl632CommitTimeGuardInvariants.property.test.js';
  const suiteByMode = {
    green: ['bash', '-c', 'exit 0'],
    allowlistedRed: [
      'bash',
      '-c',
      `printf '%s\\n' ' FAIL  ${allowlisted} > x' >&2; exit 1`,
    ],
    mixedRed: [
      'bash',
      '-c',
      `printf '%s\\n' ' FAIL  ${allowlisted} > x' ' FAIL  test/pipelineBoard.property.test.js > y' >&2; exit 1`,
    ],
    red: ['bash', '-c', 'echo "FAIL extension/test/pipelineBoard.property.test.js" >&2; exit 1'],
  };
  const env = { ...process.env };
  if (st.envSkip) env.SWARMFORGE_SKIP_PROPERTY_SUITE_GUARD = '1';
  else delete env.SWARMFORGE_SKIP_PROPERTY_SUITE_GUARD;
  const r = spawnSync('bash', [GUARD, ...(suiteByMode[st.suite] || suiteByMode.green)], {
    cwd: st.root,
    encoding: 'utf8',
    env,
  });
  st.status = r.status;
  st.out = `${r.stdout || ''}${r.stderr || ''}`;
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(/^the property-suite drift guard runs on commits that stage extension src or property tests$/, (ctx) => {
    const st = ensure(ctx);
    write(st.root, 'extension/src/pipelineBoard.ts', 'parcel\n');
    git(st.root, ['add', 'extension/src/pipelineBoard.ts']);
  });

  scoped(/^the property suite reports multiple failing files on a stock extension run$/, (ctx) => {
    ensure(ctx).inventory = readInventory();
    assert.ok(ctx.bl1175.inventory.length >= 20, 'expected multiple standing failures inventoried');
  });

  scoped(/^the standing-red inventory for this ticket is read$/, (ctx) => {
    ensure(ctx).inventory = readInventory();
  });

  scoped(/^each failing file is listed with a fix-or-allowlist disposition$/, (ctx) => {
    const rows = ensure(ctx).inventory.length ? ensure(ctx).inventory : readInventory();
    for (const row of rows) {
      assert.ok(['allowlist', 'fix'].includes(row.disposition), JSON.stringify(row));
      assert.ok(row.rationale.length > 0, JSON.stringify(row));
    }
  });

  scoped(/^no silent standing red remains without a named disposition$/, (ctx) => {
    const rows = ensure(ctx).inventory.length ? ensure(ctx).inventory : readInventory();
    assert.ok(rows.every((r) => r.disposition && r.file.endsWith('.property.test.js')));
  });

  scoped(/^BL-605 acceptance and its property tests are green$/, (ctx) => {
    ensure(ctx).suite = 'green';
  });

  scoped(/^the only staged suite-triggering paths belong to that green parcel$/, (ctx) => {
    const st = ensure(ctx);
    write(st.root, 'extension/src/pipelineBoard.ts', 'bl605-parcel\n');
    git(st.root, ['add', 'extension/src/pipelineBoard.ts']);
  });

  scoped(/^the coder commits without SWARMFORGE_SKIP_PROPERTY_SUITE_GUARD$/, (ctx) => {
    ensure(ctx).envSkip = false;
  });

  scoped(/^the property-suite guard does not refuse the commit for pre-existing unrelated reds$/, (ctx) => {
    const st = ensure(ctx);
    st.suite = 'allowlistedRed';
    runGuard(st);
    assert.equal(st.status, 0, st.out);
    assert.match(st.out, /allowlisted-standing-reds/);
    cleanup(ctx);
  });

  scoped(/^the property-suite guard documentation and behaviour are checked$/, (ctx) => {
    const src = fs.readFileSync(GUARD, 'utf8');
    assert.match(src, /recovery-only/);
    assert.match(src, /SWARMFORGE_SKIP_PROPERTY_SUITE_GUARD=1/);
  });

  scoped(/^SWARMFORGE_SKIP_PROPERTY_SUITE_GUARD is not the standing recipe for green parcels$/, (ctx) => {
    const st = ensure(ctx);
    st.suite = 'allowlistedRed';
    st.envSkip = false;
    runGuard(st);
    assert.equal(st.status, 0, st.out);
    assert.doesNotMatch(st.out, /overridden/i);
    assert.match(st.out, /allowlisted-standing-reds/);
  });

  scoped(/^ordinary commits that stage extension src still run the guard$/, (ctx) => {
    const st = ensure(ctx);
    st.suite = 'mixedRed';
    st.envSkip = false;
    runGuard(st);
    assert.notEqual(st.status, 0, st.out);
    cleanup(ctx);
  });

  scoped(/^a property suite run that does not intentionally mutate shared main$/, (ctx) => {
    const st = ensure(ctx);
    st.suite = 'green';
    st.beforeSnap = spawnSync('bash', ['-c', `source '${CANARY_LIB}'; bl1124_snapshot '${st.root}'`], {
      encoding: 'utf8',
    }).stdout.trim();
  });

  scoped(/^the suite completes$/, (ctx) => {
    runGuard(ensure(ctx));
  });

  scoped(/^the BL-1124 shared-repo canary does not refuse the commit$/, (ctx) => {
    assert.equal(ensure(ctx).status, 0, ensure(ctx).out);
    assert.doesNotMatch(ensure(ctx).out, /mutated the shared checkout/);
  });

  scoped(/^core\.bare and live refs remain unchanged$/, (ctx) => {
    const st = ensure(ctx);
    st.afterSnap = spawnSync('bash', ['-c', `source '${CANARY_LIB}'; bl1124_snapshot '${st.root}'`], {
      encoding: 'utf8',
    }).stdout.trim();
    assert.equal(st.afterSnap, st.beforeSnap);
    cleanup(ctx);
  });
}

module.exports = { registerSteps };
