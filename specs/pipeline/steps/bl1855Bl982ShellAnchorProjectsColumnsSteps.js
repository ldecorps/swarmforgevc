'use strict';

// BL-1855: step handlers for "The bl982 single-seat shell anchor compares
// the columns its pinned script wrote". Scenario 01 drives the REAL
// test_bl982_multi_seat_identity.sh end to end. Scenario 02 produces the
// pinned row from the REAL pinned blob (git cat-file, same sha case 7
// pins) run through the real swarmforge.sh/write_roles_file, derives the
// current row by the one named edit, and drives the REAL
// bl982_rows_match_pinned_shape (lib/bl982_pinned_shape.sh) - never a
// reimplementation of the projection.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { trackedTmpRoot } = require('./lib/fixtureReaper');

const FEATURE = "BL-1855 The bl982 single-seat shell anchor compares the columns its pinned script wrote";
const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const SCRIPTS_DIR = path.join(REPO_ROOT, 'swarmforge', 'scripts');
const SWARMFORGE_SH = path.join(SCRIPTS_DIR, 'swarmforge.sh');
const PINNED_SHAPE_LIB = path.join(SCRIPTS_DIR, 'test', 'lib', 'bl982_pinned_shape.sh');
const TEST_SH = path.join(SCRIPTS_DIR, 'test', 'test_bl982_multi_seat_identity.sh');
const PRE_BLOB = '2edd9a17ba9d40709c0f436d12395b638563c0ca';

const SINGLE_SEAT_CONF =
  'window specifier claude master --model claude-opus-5 --effort xhigh\n' +
  'window coder claude coder --model claude-sonnet-5 --effort xhigh\n';

function ensure(ctx) {
  if (!ctx.bl1855) {
    ctx.bl1855 = {};
  }
  return ctx.bl1855;
}

function mkConfRoot() {
  const root = trackedTmpRoot('bl1855-root-');
  fs.mkdirSync(path.join(root, 'swarmforge', 'roles'), { recursive: true });
  fs.mkdirSync(path.join(root, '.swarmforge'), { recursive: true });
  fs.copyFileSync(path.join(REPO_ROOT, 'swarmforge', 'constitution.prompt'), path.join(root, 'swarmforge', 'constitution.prompt'));
  for (const role of ['specifier', 'coder']) {
    fs.writeFileSync(path.join(root, 'swarmforge', 'roles', `${role}.prompt`), 'role prompt\n');
  }
  fs.writeFileSync(path.join(root, 'swarmforge', 'swarmforge.conf'), SINGLE_SEAT_CONF);
  return root;
}

// The pinned pre-change script, extracted from the exact blob case 7
// pins, run via a symlink farm so its SCRIPT_DIR-relative sourcing still
// resolves - the same shape case 7 itself sets up.
function writePinnedRow() {
  const preDir = trackedTmpRoot('bl1855-pre-');
  for (const entry of fs.readdirSync(SCRIPTS_DIR)) {
    fs.symlinkSync(path.join(SCRIPTS_DIR, entry), path.join(preDir, entry));
  }
  fs.rmSync(path.join(preDir, 'swarmforge.sh'));
  const cat = spawnSync('git', ['-C', REPO_ROOT, 'cat-file', 'blob', PRE_BLOB], { encoding: 'utf8' });
  assert.equal(cat.status, 0, `expected the pinned blob to be readable, got: ${cat.stderr}`);
  fs.writeFileSync(path.join(preDir, 'swarmforge.sh'), cat.stdout);

  const root = mkConfRoot();
  const r = spawnSync(
    'zsh',
    ['-c', `source '${path.join(preDir, 'swarmforge.sh')}' '${root}'; parse_config; write_roles_file`],
    { encoding: 'utf8', env: { ...process.env, PACK_STAFFING_SKIP_GATE: '1', XDG_RUNTIME_DIR: '/tmp' } }
  );
  assert.equal(r.status, 0, `expected the pinned script to write roles.tsv, got: ${r.stdout}${r.stderr}`);
  const lines = fs.readFileSync(path.join(root, '.swarmforge', 'roles.tsv'), 'utf8').split('\n').filter(Boolean);
  const coderLine = lines.find((l) => l.startsWith('coder\t'));
  assert.ok(coderLine, `expected a coder row in the pinned roles.tsv, got:\n${lines.join('\n')}`);
  return coderLine;
}

function applyDifference(row, difference) {
  const cols = row.split('\t');
  assert.equal(cols.length, 8, `expected the pinned row to have 8 columns, got ${cols.length}: ${row}`);
  if (difference === 'a ninth column "forward-only" appended') {
    return [...cols, 'forward-only'].join('\t');
  }
  if (difference === 'the seventh column "task" changed to "batch"') {
    assert.equal(cols[6], 'task', `expected column 7 to be "task", got "${cols[6]}" in: ${row}`);
    cols[6] = 'batch';
    return cols.join('\t');
  }
  if (difference === 'an extra column inserted before the eighth') {
    cols.splice(7, 0, 'inserted');
    return cols.join('\t');
  }
  throw new Error(`unrecognized difference: ${difference}`);
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  // ── Scenario 01: the real shell test, end to end ────────────────────────

  scoped(/^the current swarmforge\.sh writes "forward-only" as the ninth column of every roles\.tsv row$/, (ctx) => {
    const root = mkConfRoot();
    const r = spawnSync('zsh', ['-c', `source '${SWARMFORGE_SH}' '${root}'; parse_config; write_roles_file`], {
      encoding: 'utf8',
      env: { ...process.env, PACK_STAFFING_SKIP_GATE: '1', XDG_RUNTIME_DIR: '/tmp' },
    });
    assert.equal(r.status, 0, `expected write_roles_file to succeed, got: ${r.stdout}${r.stderr}`);
    const lines = fs.readFileSync(path.join(root, '.swarmforge', 'roles.tsv'), 'utf8').split('\n').filter(Boolean);
    assert.ok(lines.length > 0, 'expected at least one roles.tsv row');
    for (const line of lines) {
      const cols = line.split('\t');
      assert.equal(cols[8], 'forward-only', `expected column 9 "forward-only", got: ${line}`);
    }
  });

  scoped(/^test_bl982_multi_seat_identity\.sh runs$/, (ctx) => {
    const st = ensure(ctx);
    const r = spawnSync('bash', [TEST_SH], { encoding: 'utf8' });
    st.exitCode = r.status;
    st.out = `${r.stdout || ''}${r.stderr || ''}`;
  });

  scoped(/^it exits 0$/, (ctx) => {
    const st = ensure(ctx);
    assert.equal(st.exitCode, 0, `expected exit 0, got ${st.exitCode}: ${st.out}`);
  });

  scoped(/^its output carries a "([^"]+)" line$/, (ctx, needle) => {
    const st = ensure(ctx);
    assert.ok(st.out.includes(needle), `expected output to contain "${needle}", got:\n${st.out}`);
  });

  // ── Scenario 02: the projection over two rows ───────────────────────────

  scoped(/^a roles\.tsv row written by the pinned pre-change script$/, (ctx) => {
    ensure(ctx).pinnedRow = writePinnedRow();
  });

  scoped(/^a current row that is that row with (.+)$/, (ctx, difference) => {
    const st = ensure(ctx);
    st.currentRow = applyDifference(st.pinnedRow, difference);
  });

  scoped(/^case 7's single-seat comparison runs over the two rows$/, (ctx) => {
    const st = ensure(ctx);
    const dir = trackedTmpRoot('bl1855-rows-');
    const pinnedFile = path.join(dir, 'pinned.tsv');
    const currentFile = path.join(dir, 'current.tsv');
    fs.writeFileSync(pinnedFile, `${st.pinnedRow}\n`);
    fs.writeFileSync(currentFile, `${st.currentRow}\n`);
    const r = spawnSync(
      'bash',
      ['-c', `source '${PINNED_SHAPE_LIB}'; bl982_rows_match_pinned_shape '${pinnedFile}' '${currentFile}'`],
      { encoding: 'utf8' }
    );
    st.compareExitCode = r.status;
    st.compareOut = `${r.stdout || ''}${r.stderr || ''}`;
  });

  scoped(/^the comparison (passes|fails)$/, (ctx, verdict) => {
    const st = ensure(ctx);
    if (verdict === 'passes') {
      assert.equal(st.compareExitCode, 0, `expected the comparison to pass, got exit ${st.compareExitCode}: ${st.compareOut}`);
    } else {
      assert.notEqual(st.compareExitCode, 0, `expected the comparison to fail, got exit 0: ${st.compareOut}`);
    }
  });
}

module.exports = { registerSteps };
