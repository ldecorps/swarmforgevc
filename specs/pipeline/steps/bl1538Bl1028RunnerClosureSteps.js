'use strict';

// BL-1538 acceptance: bl1028_promotion_refusal_property_runner.bb derives
// its .bb copy set from the entry point it drives (promotion_gates_cli.bb)
// instead of hand-listing it, is enrolled in BL-973's closure guard through
// a new bb-authored kind, and is green with :control-commit reached - the
// fourth fixture of this surface to rot the same way (BL-1480 owns two,
// BL-1496 the third) and the first that is bb-authored rather than shell.
//
// Every verdict here comes from the REAL mechanisms - bbFixtureClosureGate's
// effectiveList/FIXTURES (BL-973/BL-1279/BL-1480/BL-1496), the runner's real
// `--copy-into` flag, and the standing fixture run as the standing suite
// runs it - never a restatement of what they should do.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const SCRIPTS = path.join(REPO_ROOT, 'swarmforge', 'scripts');
const { effectiveList, FIXTURES } = require('./lib/bbFixtureClosureGate.js');
const { computeClosure } = require('./lib/operatorRuntimeBbClosure.js');

const FEATURE_NAME = "BL-1538 The BL-1028 property runner's fixture carries its subject's bb closure";

const KNOWN_FIXTURE = 'swarmforge/scripts/test/bl1028_promotion_refusal_property_runner.bb';
const KNOWN_ENTRY = 'promotion_gates_cli.bb';
const KNOWN_REQUIRED = [
  'promotion_gates_lib.bb',
  'backlog_depth_lib.bb',
  'acceptance_pointer_gate_lib.bb',
  'headroom_cap_raise_lib.bb',
  'slice_size_envelope_gate_lib.bb',
];

// Scenario Outline placeholders are validated against explicit known values -
// an Examples row naming a file this ticket does not own must fail loudly
// rather than quietly exercise nothing.
function knownEntry(entry) {
  assert.equal(entry, KNOWN_ENTRY, `unknown entry example value "${entry}"`);
  return entry;
}

function knownRequired(file) {
  assert.ok(KNOWN_REQUIRED.includes(file), `unknown required example value "${file}"`);
  return file;
}

function bash(script, env) {
  return spawnSync('bash', ['-c', `set -uo pipefail\n${script}`], {
    encoding: 'utf8',
    cwd: REPO_ROOT,
    env: { ...process.env, ...(env || {}) },
  });
}

function mkTmp(ctx, prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  ctx.bl1538.roots.push(dir);
  return dir;
}

// No vitest sweep runs here, so every temp tree this file makes is removed by
// this file (BL-420/BL-971).
function discard(ctx) {
  while (ctx.bl1538.roots.length) {
    fs.rmSync(ctx.bl1538.roots.pop(), { recursive: true, force: true });
  }
}

function registerSteps(registry) {
  const scoped = (pattern, handler) => registry.defineScoped(pattern, handler, FEATURE_NAME);

  scoped(/^the fixture "(.+)" which copies \.bb files into a disposable root$/, (ctx, file) => {
    ctx.bl1538 = { roots: [] };
    assert.equal(file, KNOWN_FIXTURE, `unknown fixture example value "${file}"`);
    assert.ok(fs.existsSync(path.join(REPO_ROOT, file)), `missing fixture ${file}`);
    assert.ok(
      Object.prototype.hasOwnProperty.call(FIXTURES, file),
      `${file} is not enrolled in bbFixtureClosureGate's FIXTURES - an unenrolled fixture is exactly how this one rotted`
    );
    ctx.bl1538.file = file;
  });

  // ── 01 ────────────────────────────────────────────────────────────────
  scoped(/^the copy set the fixture builds is checked against the transitive load-file closure of "(.+)"$/, (ctx, entry) => {
    knownEntry(entry);
    // The fixture's EFFECTIVE copy set - what it actually copies, run
    // behaviourally via its real `--copy-into` flag, never parsed from
    // source - must be a superset of this entry point's own closure.
    const { files } = effectiveList(SCRIPTS, ctx.bl1538.file);
    const closure = computeClosure(SCRIPTS, entry);
    ctx.bl1538.entry = entry;
    ctx.bl1538.files = files;
    ctx.bl1538.missing = [...closure].filter((f) => !new Set(files).has(f)).sort();
  });

  scoped(/^no closure file is missing from the copy set$/, (ctx) => {
    const { entry, files, missing } = ctx.bl1538;
    assert.deepEqual(missing, [], `${ctx.bl1538.file} would not copy ${missing.join(', ')} for ${entry}`);
    assert.ok(files.length > 1, `the copy set for ${entry} is suspiciously short: ${files.join(', ')}`);
  });

  // ── 02 ────────────────────────────────────────────────────────────────
  // The derivation itself is pinned to a census: it must find the five
  // named files, not merely "something". A collapsed or empty derivation
  // would otherwise pass by finding nothing (ticket invariant 1's other
  // half).
  scoped(/^the transitive load-file closure of "(.+)" is derived$/, (ctx, entry) => {
    knownEntry(entry);
    ctx.bl1538.closure = [...computeClosure(SCRIPTS, entry)];
  });

  scoped(/^the derived closure contains "(.+)"$/, (ctx, required) => {
    knownRequired(required);
    assert.ok(
      ctx.bl1538.closure.includes(required),
      `the derived closure does not contain ${required}: ${ctx.bl1538.closure.join(', ')}`
    );
  });

  // ── 03 ────────────────────────────────────────────────────────────────
  scoped(/^a scratch tree in which "(.+)" gains one new load-file edge$/, (ctx, lib) => {
    assert.equal(lib, 'promotion_gates_lib.bb', `unknown lib example value "${lib}"`);
    const scratch = mkTmp(ctx, 'bl1538-scratch-');
    for (const name of fs.readdirSync(SCRIPTS)) {
      const from = path.join(SCRIPTS, name);
      if (fs.statSync(from).isFile()) {
        fs.copyFileSync(from, path.join(scratch, name));
      }
    }
    // The runner derives scripts-dir from its OWN location
    // (parent of parent), so the scratch copy must sit at the same depth
    // under the scratch tree as the real one does under swarmforge/scripts.
    fs.mkdirSync(path.join(scratch, 'test'), { recursive: true });
    fs.copyFileSync(
      path.join(SCRIPTS, 'test', 'bl1028_promotion_refusal_property_runner.bb'),
      path.join(scratch, 'test', 'bl1028_promotion_refusal_property_runner.bb')
    );
    const added = 'bl1538_new_edge_lib.bb';
    fs.writeFileSync(path.join(scratch, added), '(def bl1538-new-edge true)\n');
    const target = path.join(scratch, lib);
    const source = fs.readFileSync(target, 'utf8');
    const anchor =
      '(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "backlog_depth_lib.bb")))';
    assert.ok(source.includes(anchor), 'the load-file idiom this scenario extends has changed');
    fs.writeFileSync(
      target,
      source.replace(anchor, `${anchor}\n(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "${added}")))`)
    );
    ctx.bl1538.scratch = scratch;
    ctx.bl1538.added = added;
  });

  scoped(/^the fixture builds its disposable root$/, (ctx) => {
    // What the fixture DOES for its copy step is derive promotion-gate-deps
    // from promotion_gates_cli.bb's closure and copy exactly that - asserted
    // from source here (no hand list survives) - and the derivation is then
    // run concretely against the scratch tree via the real `--copy-into`
    // flag, which is precisely what proves it is live rather than a fresh
    // hand list (same posture as BL-1496's scenario of the same name).
    const source = fs.readFileSync(path.join(REPO_ROOT, ctx.bl1538.file), 'utf8');
    assert.ok(
      source.includes('bb-load-closure-lib/compute-closure scripts-dir bb-closure-entry'),
      `${ctx.bl1538.file} no longer derives its copy set from bb_load_closure_lib's compute-closure`
    );
    assert.ok(
      !/\["promotion_gates_cli\.bb" "promotion_gates_lib\.bb"/.test(source),
      `${ctx.bl1538.file} still hand-lists its .bb copies`
    );
    const dest = mkTmp(ctx, 'bl1538-root-');
    const runnerPath = path.join(ctx.bl1538.scratch, 'test', 'bl1028_promotion_refusal_property_runner.bb');
    const run = spawnSync('bb', [runnerPath, '--copy-into', dest], { encoding: 'utf8' });
    assert.equal(run.status, 0, `--copy-into failed: ${run.stderr}`);
    ctx.bl1538.built = dest;
  });

  scoped(/^the newly required file is copied into that root without any copy-list being edited$/, (ctx) => {
    const landed = fs.readdirSync(ctx.bl1538.built);
    assert.ok(
      landed.includes(ctx.bl1538.added),
      `${ctx.bl1538.added} was not derived into the fixture root; got ${landed.join(', ')}`
    );
    discard(ctx);
  });

  // ── 04 ────────────────────────────────────────────────────────────────
  scoped(/^the closure guard's watched fixtures are read$/, (ctx) => {
    ctx.bl1538.watched = Object.keys(FIXTURES);
  });

  scoped(/^the fixture is among them$/, (ctx) => {
    assert.ok(
      ctx.bl1538.watched.includes(ctx.bl1538.file),
      `${ctx.bl1538.file} is not among the closure guard's watched fixtures: ${ctx.bl1538.watched.join(', ')}`
    );
  });

  scoped(/^the guard's effective list for the fixture is obtained by running it, not by reading its source$/, (ctx) => {
    const abs = path.join(REPO_ROOT, ctx.bl1538.file);
    const original = fs.readFileSync;
    let sourceRead = false;
    fs.readFileSync = function patched(target, ...rest) {
      try {
        if (path.resolve(String(target)) === abs) sourceRead = true;
      } catch (e) {
        // not a path-like arg - fall through
      }
      return original.call(fs, target, ...rest);
    };
    let result;
    try {
      result = effectiveList(SCRIPTS, ctx.bl1538.file);
    } finally {
      fs.readFileSync = original;
    }
    assert.equal(sourceRead, false, `${ctx.bl1538.file}'s own source was read while deriving its effective copy set`);
    assert.ok(result.files.length > 0, 'the effective list came back empty');
  });

  // ── 05 ────────────────────────────────────────────────────────────────
  scoped(/^the standing suite runs the fixture$/, (ctx) => {
    ctx.bl1538.run = bash(`bb "${path.join(REPO_ROOT, ctx.bl1538.file)}"`);
  });

  scoped(/^the run exits zero and reports ALL PROPERTIES HOLD$/, (ctx) => {
    const { status, stdout, stderr } = ctx.bl1538.run;
    assert.equal(status, 0, `exited ${status}\n${stdout}\n${stderr}`);
    assert.ok(stdout.includes('ALL PROPERTIES HOLD'), `missing ALL PROPERTIES HOLD:\n${stdout}\n${stderr}`);
  });

  scoped(/^the coverage line shows control-commit reached at least once$/, (ctx) => {
    const { stdout } = ctx.bl1538.run;
    const match = stdout.match(/:control-commit (\d+)/);
    assert.ok(match, `no :control-commit count in coverage output:\n${stdout}`);
    assert.ok(Number(match[1]) >= 1, `:control-commit reached only ${match[1]} time(s)`);
  });
}

module.exports = { registerSteps };
