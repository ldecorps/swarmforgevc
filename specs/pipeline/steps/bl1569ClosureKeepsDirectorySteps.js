'use strict';

// BL-1569: step handlers for "the closure walker keeps the directory of a
// load-filed lib". Everything here drives the REAL artefacts: the real bb
// CLI and the real JS module for the two walkers, the real
// copy_bb_closure shell helper against a real scratch tree, and the real
// standing shell fixture that was red on main - never a synthetic stand-in
// for any of them.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { computeClosure, directLoadFileDeps } = require('./lib/operatorRuntimeBbClosure.js');

const FEATURE = 'BL-1569 The closure walker keeps the directory of a load-filed lib';

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const REAL_SCRIPTS = path.join(REPO_ROOT, 'swarmforge', 'scripts');

function mkdtemp(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function bbClosure(scriptsDir, entry) {
  const result = spawnSync('bb', [path.join(scriptsDir, 'bb_load_closure_cli.bb'), scriptsDir, entry], {
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, `bb_load_closure_cli.bb failed for ${entry}: ${result.stderr}`);
  return new Set(result.stdout.split('\n').map((s) => s.trim()).filter(Boolean));
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  // ── scenario 01/02: both walkers report the directory-qualified path ────
  scoped(
    /^the (.+) computes the load-file closure of (\S+) under (\S+)$/,
    (ctx, walker, entry, scriptsDirRel) => {
      const scriptsDir = path.join(REPO_ROOT, scriptsDirRel);
      if (walker.startsWith('bb CLI')) {
        ctx.bl1569 = { closure: bbClosure(scriptsDir, entry) };
      } else if (walker.startsWith('JS twin')) {
        ctx.bl1569 = { closure: computeClosure(scriptsDir, entry) };
      } else {
        throw new Error(`BL-1569: unknown walker "${walker}"`);
      }
    }
  );

  scoped(/^the closure names (\S+)$/, (ctx, name) => {
    assert.ok(
      ctx.bl1569.closure.has(name),
      `expected the closure to name ${name}, got: ${[...ctx.bl1569.closure].sort().join(', ')}`
    );
  });

  scoped(/^the closure names no bare (\S+)$/, (ctx, name) => {
    assert.ok(
      !ctx.bl1569.closure.has(name),
      `expected the closure NOT to name the bare ${name} (only its directory-qualified form)`
    );
  });

  scoped(/^no entry other than (\S+) contains a slash$/, (ctx, exception) => {
    const withSlash = [...ctx.bl1569.closure].filter((f) => f !== exception && f.includes('/'));
    assert.deepEqual(
      withSlash,
      [],
      `expected only ${exception} to contain a slash, also found: ${withSlash.join(', ')}`
    );
  });

  // ── scenario 03: a copy places each member at its relative path ─────────
  scoped(
    /^copy_bb_closure copies the closure of (\S+) from (\S+) into an empty directory$/,
    (ctx, entry, scriptsDirRel) => {
      const src = path.join(REPO_ROOT, scriptsDirRel);
      const dest = mkdtemp('bl1569-copy-');
      const result = spawnSync(
        'bash',
        [
          '-c',
          `set -euo pipefail\nsource "${path.join(REAL_SCRIPTS, 'test', 'lib', 'bb_closure_copy.sh')}"\ncopy_bb_closure "$1" "$2" "$3"`,
          'bash',
          src,
          dest,
          entry,
        ],
        { encoding: 'utf8' }
      );
      ctx.bl1569 = { copyDest: dest, copyExit: result.status, copyStderr: result.stderr || '' };
      assert.equal(result.status, 0, `expected the copy to succeed: ${result.stderr}`);
    }
  );

  scoped(/^the directory holds (\S+)$/, (ctx, relPath) => {
    assert.ok(
      fs.existsSync(path.join(ctx.bl1569.copyDest, relPath)),
      `expected ${relPath} to exist under ${ctx.bl1569.copyDest}`
    );
  });

  scoped(/^loading the copied (\S+) in bb succeeds$/, (ctx, name) => {
    const target = path.join(ctx.bl1569.copyDest, name);
    const result = spawnSync('bb', ['-e', `(load-file "${target}")`], { encoding: 'utf8' });
    assert.equal(result.status, 0, `expected loading ${target} to succeed: ${result.stderr}`);
    fs.rmSync(ctx.bl1569.copyDest, { recursive: true, force: true });
  });

  // ── scenario 04: a copy whose closure names a missing file fails loud ───
  scoped(
    /^a scratch scripts directory whose (\S+) load-files "([^"]+)" "([^"]+)" and no such file exists$/,
    (ctx, entryFile, dirSeg, nameSeg) => {
      const scratch = mkdtemp('bl1569-scratch-');
      // copy_bb_closure derives the copy list by shelling to the real CLI,
      // which in turn load-files the real lib - both must be present beside
      // the scratch entry point for that derivation itself to succeed.
      for (const f of ['bb_load_closure_cli.bb', 'bb_load_closure_lib.bb']) {
        fs.copyFileSync(path.join(REAL_SCRIPTS, f), path.join(scratch, f));
      }
      fs.writeFileSync(
        path.join(scratch, entryFile),
        `(ns bl1569-scratch)\n(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "${dirSeg}" "${nameSeg}")))\n`
      );
      assert.ok(
        !fs.existsSync(path.join(scratch, dirSeg, nameSeg)),
        `${dirSeg}/${nameSeg} must genuinely be absent for this scenario to mean anything`
      );
      ctx.bl1569 = { scratchDir: scratch, entryFile };
    }
  );

  // BL-1569 hardening: a scratch closure with only ONE member (the missing
  // one) cannot discriminate the explicit fail-loud check from copy_bb_closure
  // simply inheriting cp's own nonzero exit as the last command it ran - and
  // the scenario below already runs the copy under `set -e`, where ANY
  // mid-loop failure aborts immediately regardless of position, so a check
  // that did nothing would still "pass" this scenario. At least one real
  // production caller (test_bl1028_promotion_obeys_integrity_refusal.sh) has
  // no `set -e` at all, and there a missing dependency that is not the LAST
  // one bash's while-loop happens to process would silently produce exit 0 -
  // the exact silent-skip defect this ticket exists to close - unless the
  // explicit `[[ ! -f ... ]] && return 1` check is the thing catching it.
  // Verified by hand before landing this hardening: with that check removed
  // and this same two-member, no-`set -e` shape, copy_bb_closure returned 0
  // and silently copied only the present member.
  scoped(
    /^(\S+) also load-files a second, present file that sorts after the missing one$/,
    (ctx, entryFile) => {
      assert.equal(entryFile, ctx.bl1569.entryFile);
      const secondName = 'zz_present.bb';
      fs.copyFileSync(
        path.join(REAL_SCRIPTS, 'bb_load_closure_lib.bb'),
        path.join(ctx.bl1569.scratchDir, secondName)
      );
      const entryPath = path.join(ctx.bl1569.scratchDir, entryFile);
      fs.appendFileSync(
        entryPath,
        `(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "${secondName}")))\n`
      );
    }
  );

  scoped(
    /^copy_bb_closure, run with no "set -e" in its caller, copies the closure of (\S+) from that directory into an empty directory$/,
    (ctx, entry) => {
      assert.equal(entry, ctx.bl1569.entryFile);
      const dest = mkdtemp('bl1569-copy-fail-');
      const result = spawnSync(
        'bash',
        [
          '-c',
          // No -e: matches test_bl1028_promotion_obeys_integrity_refusal.sh's
          // real `set -uo pipefail` shape, so a mid-loop cp failure that is
          // not the loop's LAST command does not itself abort the script -
          // only the explicit fail-loud check inside copy_bb_closure can.
          `set -uo pipefail\nsource "${path.join(REAL_SCRIPTS, 'test', 'lib', 'bb_closure_copy.sh')}"\ncopy_bb_closure "$1" "$2" "$3"`,
          'bash',
          ctx.bl1569.scratchDir,
          dest,
          entry,
        ],
        { encoding: 'utf8' }
      );
      ctx.bl1569.copyExit = result.status;
      ctx.bl1569.copyStderr = result.stderr || '';
      fs.rmSync(ctx.bl1569.scratchDir, { recursive: true, force: true });
      fs.rmSync(dest, { recursive: true, force: true });
    }
  );

  scoped(/^it exits non-zero$/, (ctx) => {
    assert.notEqual(ctx.bl1569.copyExit, 0, `expected a non-zero exit, got 0:\n${ctx.bl1569.copyStderr}`);
  });

  scoped(/^its error names (\S+)$/, (ctx, name) => {
    assert.ok(
      ctx.bl1569.copyStderr.includes(name),
      `expected the error to name ${name}, got: ${ctx.bl1569.copyStderr}`
    );
  });

  // ── scenario 05: the twins still agree and the red fixture is green ─────
  scoped(/^(swarmforge\/scripts\/\S+) runs$/, (ctx, script) => {
    const abs = path.join(REPO_ROOT, script);
    const result = script.endsWith('.bb')
      ? spawnSync('bb', [abs], { encoding: 'utf8' })
      : spawnSync('bash', [abs], { encoding: 'utf8' });
    ctx.bl1569 = {
      runExit: result.status,
      runOutput: `${result.stdout || ''}${result.stderr || ''}`,
    };
  });

  scoped(/^it exits zero$/, (ctx) => {
    assert.equal(ctx.bl1569.runExit, 0, `expected exit 0:\n${(ctx.bl1569.runOutput || '').slice(-2000)}`);
  });

  scoped(/^it prints ALL CHECKS PASSED and exits zero$/, (ctx) => {
    assert.equal(ctx.bl1569.runExit, 0, `expected exit 0:\n${(ctx.bl1569.runOutput || '').slice(-2000)}`);
    assert.match(
      ctx.bl1569.runOutput,
      /ALL CHECKS PASSED/,
      `expected ALL CHECKS PASSED in the output:\n${(ctx.bl1569.runOutput || '').slice(-2000)}`
    );
  });

  // ── scenario 06: the census matches what the ticket counted ─────────────
  scoped(
    /^every load-file form under swarmforge\/scripts whose fs\/path carries more than one string after the parent is listed$/,
    (ctx) => {
      // Flat, non-recursive: swarmforge/scripts/test/ holds test infrastructure
      // whose own load-file forms resolve relative to THAT directory (a
      // different, unrelated set of loading files), not production entry
      // points this walker ever reaches - see swarmforge/scripts/test/lib/
      // bb_closure_copy.sh's own callers, none of which is under test/.
      const multiSegmentFiles = [];
      for (const name of fs.readdirSync(REAL_SCRIPTS)) {
        const full = path.join(REAL_SCRIPTS, name);
        if (!name.endsWith('.bb') || !fs.statSync(full).isFile()) continue;
        const deps = directLoadFileDeps(fs.readFileSync(full, 'utf8'));
        if (deps.some((d) => d.includes('/'))) {
          multiSegmentFiles.push(`swarmforge/scripts/${name}`);
        }
      }
      ctx.bl1569 = { census: multiSegmentFiles };
    }
  );

  scoped(/^the list names (\S+)$/, (ctx, name) => {
    assert.ok(
      ctx.bl1569.census.includes(name),
      `expected the census to name ${name}, got: ${ctx.bl1569.census.join(', ')}`
    );
  });

  scoped(/^the list has one entry$/, (ctx) => {
    assert.equal(
      ctx.bl1569.census.length,
      1,
      `expected exactly one entry, got: ${ctx.bl1569.census.join(', ')}`
    );
  });
}

module.exports = { registerSteps };
