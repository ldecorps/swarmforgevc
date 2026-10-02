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
const SCRIPTS = path.join(REPO, 'swarmforge', 'scripts');
const GUARD = path.join(SCRIPTS, 'check_property_suite_drift.sh');
const CANARY_LIB = path.join(SCRIPTS, 'property_suite_shared_repo_guard.sh');
// The fixture owns its allowlist (the BL-1448 shape): the guard reads the
// TSV beside itself, so it runs from a copy with a one-row list. Reading the
// live list made scenarios 02 and 03 red once every standing red was fixed
// and the live list emptied (1035192e8c, 2026-09-18).
const GUARD_FILES = [
  'check_property_suite_drift.sh',
  'property_suite_shared_repo_guard.sh',
  'incoming_merge_parent_lib.sh',
  'property_suite_standing_allowlist_lib.sh',
];
const ALLOWLISTED_RED = 'test/bl632CommitTimeGuardInvariants.property.test.js';

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

function installFixtureGuard(st) {
  const dir = path.join(st.root, '.fixture-guard');
  fs.mkdirSync(dir, { recursive: true });
  for (const name of GUARD_FILES) {
    fs.copyFileSync(path.join(SCRIPTS, name), path.join(dir, name));
  }
  fs.writeFileSync(
    path.join(dir, 'property_suite_standing_allowlist.tsv'),
    `file\tdisposition\trationale\n${ALLOWLISTED_RED}\tallowlist\tfixture standing red\n`
  );
  return path.join(dir, 'check_property_suite_drift.sh');
}

function runGuard(st) {
  const allowlisted = ALLOWLISTED_RED;
  const guard = installFixtureGuard(st);
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
  const r = spawnSync('bash', [guard, ...(suiteByMode[st.suite] || suiteByMode.green)], {
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
