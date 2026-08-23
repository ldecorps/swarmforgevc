'use strict';

// BL-973: step handlers for "bb fixture copy-lists follow the real load-file
// closure, and no test sits unrun".
//
// Two halves of one incident. Half 1: five fixture copy-lists named a bb
// script's dependencies by hand with nothing gating them, and drifted three
// times. Half 2: nothing ran swarmforge/scripts/test/ as a suite, so one of
// the resulting reds sat on main for days.
//
// Everything here drives the REAL artefacts: the real shell test, the real
// closure gate reading what each fixture ACTUALLY copies (never parsing its
// source for a literal - a grep would pass against a comment, which is the
// failure mode BL-897 names), and the real inventory CLI over a real scratch
// tree.
//
// Invariant (BL-968): module load is requires and pure constants only.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const { computeClosure } = require('./lib/operatorRuntimeBbClosure.js');
const { missingFromList, effectiveList, FIXTURES } = require('./lib/bbFixtureClosureGate.js');

const FEATURE =
  'BL-973 bb fixture copy-lists follow the real load-file closure, and no test sits unrun';

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const REAL_SCRIPTS = path.join(REPO_ROOT, 'swarmforge', 'scripts');

// The name the scratch edge introduces. Deliberately unlike any real file, so
// a guard reporting it cannot be reporting something else.
const SCRATCH_DEP = 'bl973_scratch_probe_lib.bb';

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(/^the bb test tree "([^"]+)"$/, (ctx, tree) => {
    ctx.treeDir = path.join(REPO_ROOT, tree);
    assert.ok(fs.existsSync(ctx.treeDir), `the bb test tree must exist: ${ctx.treeDir}`);
  });

  // ── 01: the red shell test runs green ────────────────────────────────────
  scoped(/^"([^"]+)" runs$/, (ctx, script) => {
    // spawnSync, not execFileSync piped through anything: a piped invocation
    // reports the tail's exit code, which is how this test's red went
    // unnoticed in the first place (the ticket's own QA note).
    const result = spawnSync('bash', [path.join(REPO_ROOT, script)], {
      encoding: 'utf8',
      env: { ...process.env, SWARMFORGE_CONFIG: undefined },
    });
    ctx.scriptExit = result.status;
    ctx.scriptOutput = `${result.stdout || ''}${result.stderr || ''}`;
  });

  scoped(/^it exits 0$/, (ctx) => {
    assert.equal(
      ctx.scriptExit,
      0,
      `expected exit 0, got ${ctx.scriptExit}:\n${(ctx.scriptOutput || '').slice(-2000)}`
    );
  });

  // ── 02: each list carries its own entry point's full closure ─────────────
  scoped(/^the fixture copy-list in "([^"]+)"$/, (ctx, file) => {
    assert.ok(FIXTURES[file], `the closure gate must know this fixture: ${file}`);
    ctx.fixtureFile = file;
  });

  scoped(
    /^the list is checked against the transitive load-file closure of "([^"]+)"$/,
    (ctx, entry) => {
      const result = missingFromList(REAL_SCRIPTS, ctx.fixtureFile);
      // The row's entry point is part of the claim, not decoration: a guard
      // pinned to the wrong script would green a fixture missing its own CLI's
      // direct dependency, which is the error the mint-time spec made.
      assert.equal(
        result.entry,
        entry,
        `${ctx.fixtureFile} is guarded against ${result.entry}, but this row is about ${entry}`
      );
      ctx.checkResult = result;
    }
  );

  scoped(/^no closure file is missing from the list$/, (ctx) => {
    assert.deepEqual(
      ctx.checkResult.missing,
      [],
      `${ctx.fixtureFile} would not copy: ${ctx.checkResult.missing.join(', ')}`
    );
    // Non-vacuity: a list of nothing would trivially be missing nothing.
    assert.ok(
      ctx.checkResult.files.length > 1,
      `${ctx.fixtureFile} produced ${ctx.checkResult.files.length} file(s) - too few for this check to mean anything`
    );
  });

  // ── 03: a new load-file edge upstream fails every guarded list loudly ────
  scoped(
    /^a scratch tree in which "([^"]+)" gains one new load-file edge$/,
    (ctx, upstream) => {
      // A real copy of the real scripts dir, with one real extra edge - the
      // exact event that produced this defect three times (BL-911, BL-967,
      // BL-1029).
      const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'bl973-edge-'));
      ctx.scratchScripts = path.join(scratch, 'scripts');
      ctx.scratchRoot = scratch;
      fs.mkdirSync(ctx.scratchScripts, { recursive: true });
      for (const f of fs.readdirSync(REAL_SCRIPTS)) {
        const src = path.join(REAL_SCRIPTS, f);
        if (fs.statSync(src).isFile()) fs.copyFileSync(src, path.join(ctx.scratchScripts, f));
      }
      fs.writeFileSync(path.join(ctx.scratchScripts, SCRATCH_DEP), '(ns bl973-scratch-probe-lib)\n');
      const upstreamPath = path.join(ctx.scratchScripts, upstream);
      fs.appendFileSync(
        upstreamPath,
        `\n(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "${SCRATCH_DEP}")))\n`
      );
      // The premise, asserted rather than assumed: the scratch closure really
      // does now contain the new name.
      assert.ok(
        computeClosure(ctx.scratchScripts, upstream).has(SCRATCH_DEP),
        'the scratch edge did not actually enter the closure - the scenario would be vacuous'
      );
    }
  );

  scoped(
    /^the fixture copy-list in "([^"]+)" is checked against its entry point's closure$/,
    (ctx, file) => {
      ctx.fixtureFile = file;
      // The fixture's list as it stands TODAY, frozen, then measured against
      // the scratch tree's larger closure. That is what a hand-maintained list
      // is - a snapshot - so this is the guard being shown to fire on the
      // event that has actually caused this defect three times, rather than a
      // guard that is merely present.
      const snapshot = effectiveList(REAL_SCRIPTS, file);
      const closure = computeClosure(ctx.scratchScripts, snapshot.entry);
      const have = new Set(snapshot.files);
      ctx.scratchMissing = [...closure].filter((f) => !have.has(f)).sort();
    }
  );

  scoped(/^the closure check fails naming the new dependency$/, (ctx) => {
    assert.deepEqual(
      ctx.scratchMissing,
      [SCRATCH_DEP],
      `expected the guard to name exactly ${SCRATCH_DEP}, got: ${ctx.scratchMissing.join(', ') || '(nothing - the guard did not fire)'}`
    );
    if (ctx.scratchRoot) fs.rmSync(ctx.scratchRoot, { recursive: true, force: true });
  });

  // ── 04/05: the suite-completeness inventory ──────────────────────────────
  scoped(
    /^a scratch bb test tree containing a test file named in neither the runner nor the exclusion manifest$/,
    (ctx) => {
      const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'bl973-inv-'));
      ctx.scratchTree = scratch;
      for (const f of ['suite_inventory_cli.bb', 'suite_inventory_lib.bb']) {
        fs.copyFileSync(path.join(ctx.treeDir, f), path.join(scratch, f));
      }
      fs.writeFileSync(path.join(scratch, 'suite-manifest.tsv'), 'test_listed.sh\tstanding\t\t\n');
      fs.writeFileSync(path.join(scratch, 'test_listed.sh'), '');
      // The runner's list IS the manifest's standing lane, so "in neither" is
      // one condition, not two.
      fs.writeFileSync(path.join(scratch, 'test_orphan.sh'), '');
      ctx.orphanName = 'test_orphan.sh';
    }
  );

  scoped(/^the standing suite inventory check runs over the bb test tree$/, (ctx) => {
    const dir = ctx.scratchTree || ctx.treeDir;
    const cli = path.join(dir, 'suite_inventory_cli.bb');
    const result = spawnSync('bb', [cli, dir], { encoding: 'utf8' });
    ctx.inventoryExit = result.status;
    ctx.inventoryOutput = `${result.stdout || ''}${result.stderr || ''}`;
  });

  scoped(
    /^every test file is either invoked by the standing suite entry point or listed with a dated reason in the exclusion manifest$/,
    (ctx) => {
      assert.equal(
        ctx.inventoryExit,
        0,
        `the real bb test tree is not fully accounted for:\n${ctx.inventoryOutput}`
      );
      // Non-vacuity: a check over an empty tree would pass and prove nothing.
      const counted = /ok - (\d+) test file/.exec(ctx.inventoryOutput);
      assert.ok(counted, `the inventory did not report a file count:\n${ctx.inventoryOutput}`);
      assert.ok(
        Number(counted[1]) > 100,
        `the inventory saw only ${counted[1]} test files - it is not looking at the real tree`
      );
      // The standing lane is the runner's list, so the two cannot disagree.
      const listed = execFileSync('bash', [path.join(ctx.treeDir, 'run_bb_suite.sh'), '--list'], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      })
        .split('\n')
        .filter(Boolean);
      assert.ok(
        listed.length > 100,
        `the standing suite entry point lists only ${listed.length} tests`
      );
    }
  );

  scoped(/^the inventory check fails naming that test file$/, (ctx) => {
    assert.equal(ctx.inventoryExit, 1, `expected the inventory to fail:\n${ctx.inventoryOutput}`);
    assert.match(
      ctx.inventoryOutput,
      new RegExp(`not in the manifest: ${ctx.orphanName}`),
      `the failure must name the unaccounted-for file:\n${ctx.inventoryOutput}`
    );
    fs.rmSync(ctx.scratchTree, { recursive: true, force: true });
  });
}

module.exports = { registerSteps };
