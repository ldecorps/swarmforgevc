'use strict';

// BL-1489: proves BL-982's single-seat comparison
// (bl982SecondSeatSteps.js's compareSingleSeatRolesTsv) checks only the
// fields its own scenario names - session, worktree, launch script and
// prompt paths - and tolerates any other roles.tsv column, so a column a
// later ticket adds (like 44d2d42591's reverse-hop mode) can never turn it
// red again. Scenario 01 drives the REAL run_acceptance.sh against BL-982's
// REAL feature file - never a JS restatement of it. Scenarios 02/03 drive
// the REAL comparison function against a live root and a seam root, the
// seam built from the same real provisioning bl982SecondSeatSteps.js uses
// and then patched (never a hand-authored roles.tsv) to differ in exactly
// the one way each scenario names.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const {
  SINGLE_SEAT_CONF,
  mkRoot,
  cleanupRoots,
  zshSource,
  compareSingleSeatRolesTsv,
} = require('./bl982SecondSeatSteps');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const RUN_ACCEPTANCE = path.join(REPO_ROOT, 'specs', 'pipeline', 'scripts', 'run_acceptance.sh');
const BL982_FEATURE = path.join(
  REPO_ROOT,
  'specs',
  'features',
  'BL-982-second-seat-of-a-stage-boots-with-its-own-model.feature'
);
const SWARMFORGE_SH = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'swarmforge.sh');

const FEATURE = "BL-1489 The BL-982 single-seat handler compares the fields its scenario names, not the whole roles.tsv line";

function scoped(registry, pattern, handler) {
  registry.defineScoped(pattern, handler, FEATURE);
}

function rolesTsvPath(root) {
  return path.join(root, '.swarmforge', 'roles.tsv');
}

function provisionSingleSeat(ctx) {
  const root = mkRoot(ctx, SINGLE_SEAT_CONF);
  const r = zshSource(
    root,
    SWARMFORGE_SH,
    'parse_config; write_roles_file; generate_dormant_role_launch_artifacts $(( ${ROLE_INDEX[coder]} + 1 ))'
  );
  assert.equal(r.status, 0, `provisioning failed: ${r.stderr}`);
  return root;
}

// A seam roles.tsv is the same provisioned rows with one deliberate
// difference the scenario names, applied to the file on disk - never a
// hand-patched swarmforge.sh, which would risk drifting from what the real
// launcher actually writes.
function withExtraColumnOnEveryRow(root) {
  const tsvPath = rolesTsvPath(root);
  const patched = fs
    .readFileSync(tsvPath, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => `${line}\tseam-extra-column`)
    .join('\n');
  fs.writeFileSync(tsvPath, `${patched}\n`);
}

function withDifferentFieldForCoderRow(root, field) {
  const index = field === 'worktree' ? 2 : 3;
  const tsvPath = rolesTsvPath(root);
  const patched = fs
    .readFileSync(tsvPath, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const cols = line.split('\t');
      if (cols[0] === 'coder') {
        cols[index] = `seam-different-${field}`;
      }
      return cols.join('\t');
    })
    .join('\n');
  fs.writeFileSync(tsvPath, `${patched}\n`);
}

function registerSteps(registry) {
  // ── scenario 01 ─────────────────────────────────────────────────────
  scoped(
    registry,
    /^the launcher as it stands on the tree, with the reverse-hop column in roles\.tsv$/,
    (ctx) => {
      // Prove the fixture's own premise: the live launcher really does write
      // the ninth column today (44d2d42591) - otherwise this scenario would
      // pass trivially for the wrong reason.
      const probe = mkRoot(ctx, SINGLE_SEAT_CONF);
      const r = zshSource(probe, SWARMFORGE_SH, 'parse_config; write_roles_file');
      assert.equal(r.status, 0, `probe provisioning failed: ${r.stderr}`);
      const row = fs.readFileSync(rolesTsvPath(probe), 'utf8').split('\n')[0].split('\t');
      assert.equal(row.length, 9, `expected today's launcher to write 9 roles.tsv columns, got ${row.length}`);
      assert.equal(row[8], 'forward-only', `expected the ninth column to be the reverse-hop mode, got '${row[8]}'`);
      cleanupRoots(ctx);
    }
  );

  scoped(registry, /^the BL-982 second-seat feature runs$/, (ctx) => {
    // BL-1318's gate: decide the hatch here, never inherit the pane's own
    // export (BL-1486) - belt-and-braces alongside the imported zshSource's
    // own decision (bl982SecondSeatSteps.js).
    const r = spawnSync('bash', [RUN_ACCEPTANCE, BL982_FEATURE], {
      encoding: 'utf8',
      env: { ...process.env, PACK_STAFFING_SKIP_GATE: '1' },
    });
    ctx.result = { status: r.status, out: `${r.stdout || ''}${r.stderr || ''}` };
  });

  scoped(registry, /^it passes every scenario$/, (ctx) => {
    assert.equal(ctx.result.status, 0, `expected BL-982's feature to pass:\n${ctx.result.out}`);
    assert.match(ctx.result.out, /# pass 6/, `expected all six scenario rows to pass:\n${ctx.result.out}`);
    assert.match(ctx.result.out, /# fail 0/, `expected no failing rows:\n${ctx.result.out}`);
  });

  // ── scenario 02 ─────────────────────────────────────────────────────
  scoped(registry, /^a seam launcher that writes one more column on every roles\.tsv row$/, (ctx) => {
    ctx.liveRoot = provisionSingleSeat(ctx);
    ctx.seamRoot = provisionSingleSeat(ctx);
    withExtraColumnOnEveryRow(ctx.seamRoot);
  });

  scoped(registry, /^BL-982's single-seat comparison runs against the seam$/, (ctx) => {
    try {
      compareSingleSeatRolesTsv(ctx.liveRoot, ctx.seamRoot);
      ctx.comparisonError = null;
    } catch (err) {
      ctx.comparisonError = err;
    }
  });

  scoped(registry, /^it passes$/, (ctx) => {
    try {
      assert.equal(
        ctx.comparisonError,
        null,
        `expected the comparison to pass: ${ctx.comparisonError && ctx.comparisonError.message}`
      );
    } finally {
      cleanupRoots(ctx);
    }
  });

  // ── scenario 03 (outline: session | worktree) ───────────────────────
  scoped(
    registry,
    /^a seam launcher that writes a different (session|worktree) for the coder row$/,
    (ctx, field) => {
      ctx.liveRoot = provisionSingleSeat(ctx);
      ctx.seamRoot = provisionSingleSeat(ctx);
      withDifferentFieldForCoderRow(ctx.seamRoot, field);
    }
  );

  scoped(registry, /^it fails naming the (session|worktree)$/, (ctx, field) => {
    try {
      assert.ok(ctx.comparisonError, 'expected the comparison to fail');
      assert.match(
        ctx.comparisonError.message,
        new RegExp(`\\b${field}\\b.*role 'coder'`),
        `expected the failure to name the ${field}: ${ctx.comparisonError.message}`
      );
    } finally {
      cleanupRoots(ctx);
    }
  });
}

module.exports = { registerSteps };
