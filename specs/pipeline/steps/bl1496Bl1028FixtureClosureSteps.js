'use strict';

// BL-1496 acceptance: test_bl1028_promotion_obeys_integrity_refusal.sh
// derives its .bb copy set from the entry point it drives (promotion_gates_cli.bb)
// instead of hand-listing it, is enrolled in BL-973's closure guard, and is
// green - the third fixture of this surface to rot the same way (BL-1480
// owns the other two) and the only one that was unenrolled.
//
// Every verdict here comes from the REAL mechanisms - bbFixtureClosureGate's
// effectiveList/FIXTURES (BL-973/BL-1279/BL-1480), the real
// bb_closure_copy.sh helper, and the standing fixture run as the standing
// suite runs it - never a restatement of what they should do.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const SCRIPTS = path.join(REPO_ROOT, 'swarmforge', 'scripts');
const TEST_LIB = path.join(SCRIPTS, 'test', 'lib');
const { effectiveList, FIXTURES } = require('./lib/bbFixtureClosureGate.js');
const { computeClosure } = require('./lib/operatorRuntimeBbClosure.js');

const FEATURE_NAME = "BL-1496 The BL-1028 integrity-refusal fixture carries its subject's bb closure";

const KNOWN_FIXTURE = 'swarmforge/scripts/test/test_bl1028_promotion_obeys_integrity_refusal.sh';
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
  ctx.bl1496.roots.push(dir);
  return dir;
}

// No vitest sweep runs here, so every temp tree this file makes is removed by
// this file (BL-420/BL-971).
function discard(ctx) {
  while (ctx.bl1496.roots.length) {
    fs.rmSync(ctx.bl1496.roots.pop(), { recursive: true, force: true });
  }
}

function registerSteps(registry) {
  const scoped = (pattern, handler) => registry.defineScoped(pattern, handler, FEATURE_NAME);

  scoped(/^the fixture "(.+)" which copies \.bb files into a disposable root$/, (ctx, file) => {
    ctx.bl1496 = { roots: [] };
    assert.equal(file, KNOWN_FIXTURE, `unknown fixture example value "${file}"`);
    assert.ok(fs.existsSync(path.join(REPO_ROOT, file)), `missing fixture ${file}`);
    assert.ok(
      Object.prototype.hasOwnProperty.call(FIXTURES, file),
      `${file} is not enrolled in bbFixtureClosureGate's FIXTURES - an unenrolled fixture is exactly how this one rotted`
    );
    ctx.bl1496.file = file;
  });

  // ── 01 ────────────────────────────────────────────────────────────────
  scoped(/^the copy set the fixture builds is checked against the transitive load-file closure of "(.+)"$/, (ctx, entry) => {
    knownEntry(entry);
    // The fixture's EFFECTIVE copy set - what it actually copies, run
    // behaviourally via the real copy_bb_closure helper, never parsed from
    // source - must be a superset of this entry point's own closure.
    const { files } = effectiveList(SCRIPTS, ctx.bl1496.file);
    const closure = computeClosure(SCRIPTS, entry);
    ctx.bl1496.entry = entry;
    ctx.bl1496.files = files;
    ctx.bl1496.missing = [...closure].filter((f) => !new Set(files).has(f)).sort();
  });

  scoped(/^no closure file is missing from the copy set$/, (ctx) => {
    const { entry, files, missing } = ctx.bl1496;
    assert.deepEqual(missing, [], `${ctx.bl1496.file} would not copy ${missing.join(', ')} for ${entry}`);
    assert.ok(files.length > 1, `the copy set for ${entry} is suspiciously short: ${files.join(', ')}`);
  });

  // ── 02 ────────────────────────────────────────────────────────────────
  // The derivation itself is pinned to a census: it must find the five
  // named files, not merely "something". A collapsed or empty derivation
  // would otherwise pass by finding nothing (ticket invariant 2).
  scoped(/^the transitive load-file closure of "(.+)" is derived$/, (ctx, entry) => {
    knownEntry(entry);
    ctx.bl1496.closure = [...computeClosure(SCRIPTS, entry)];
  });

  scoped(/^the derived closure contains "(.+)"$/, (ctx, required) => {
    knownRequired(required);
    assert.ok(
      ctx.bl1496.closure.includes(required),
      `the derived closure does not contain ${required}: ${ctx.bl1496.closure.join(', ')}`
    );
  });

  // ── 03 ────────────────────────────────────────────────────────────────
  scoped(/^a scratch tree in which "(.+)" gains one new load-file edge$/, (ctx, lib) => {
    assert.equal(lib, 'promotion_gates_lib.bb', `unknown lib example value "${lib}"`);
    const scratch = mkTmp(ctx, 'bl1496-scratch-');
    for (const name of fs.readdirSync(SCRIPTS)) {
      const from = path.join(SCRIPTS, name);
      if (fs.statSync(from).isFile()) {
        fs.copyFileSync(from, path.join(scratch, name));
      }
    }
    const added = 'bl1496_new_edge_lib.bb';
    fs.writeFileSync(path.join(scratch, added), '(def bl1496-new-edge true)\n');
    const target = path.join(scratch, lib);
    const source = fs.readFileSync(target, 'utf8');
    const anchor =
      '(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "backlog_depth_lib.bb")))';
    assert.ok(source.includes(anchor), 'the load-file idiom this scenario extends has changed');
    fs.writeFileSync(
      target,
      source.replace(anchor, `${anchor}\n(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "${added}")))`)
    );
    ctx.bl1496.scratch = scratch;
    ctx.bl1496.added = added;
  });

  scoped(/^the fixture builds its disposable root$/, (ctx) => {
    // What the fixture DOES for its copy step is `copy_bb_closure "$SCRIPTS"
    // "$root/..." promotion_gates_cli.bb`. That delegation is asserted from
    // the fixture's source - the question here is whether it still delegates
    // - and the derivation itself is then run concretely against the
    // scratch tree, which is precisely what proves it is live rather than a
    // fresh hand list (same posture as BL-1480's scenario of the same name).
    const source = fs.readFileSync(path.join(REPO_ROOT, ctx.bl1496.file), 'utf8');
    assert.ok(
      source.includes('copy_bb_closure "$SCRIPTS" "$root/swarmforge/scripts" promotion_gates_cli.bb'),
      `${ctx.bl1496.file} no longer derives its copy set from copy_bb_closure`
    );
    assert.ok(!/cp "\$SCRIPTS\/.*\.bb"/.test(source), `${ctx.bl1496.file} still hand-lists its .bb copies`);
    const dest = mkTmp(ctx, 'bl1496-root-');
    const run = bash(
      `source "${path.join(TEST_LIB, 'bb_closure_copy.sh')}"\ncopy_bb_closure "$SRC" "$DEST" ${KNOWN_ENTRY}`,
      { SRC: ctx.bl1496.scratch, DEST: dest }
    );
    assert.equal(run.status, 0, `copy_bb_closure failed: ${run.stderr}`);
    ctx.bl1496.built = dest;
  });

  scoped(/^the newly required file is copied into that root without any copy-list being edited$/, (ctx) => {
    const landed = fs.readdirSync(ctx.bl1496.built);
    assert.ok(
      landed.includes(ctx.bl1496.added),
      `${ctx.bl1496.added} was not derived into the fixture root; got ${landed.join(', ')}`
    );
    discard(ctx);
  });

  // ── 04 ────────────────────────────────────────────────────────────────
  scoped(/^the closure guard's watched fixtures are read$/, (ctx) => {
    ctx.bl1496.watched = Object.keys(FIXTURES);
  });

  scoped(/^the fixture is among them$/, (ctx) => {
    assert.ok(
      ctx.bl1496.watched.includes(ctx.bl1496.file),
      `${ctx.bl1496.file} is not among the closure guard's watched fixtures: ${ctx.bl1496.watched.join(', ')}`
    );
  });

  // ── 05 ────────────────────────────────────────────────────────────────
  scoped(/^the standing suite runs the fixture$/, (ctx) => {
    ctx.bl1496.run = bash(`bash "${path.join(REPO_ROOT, ctx.bl1496.file)}"`);
  });

  scoped(/^the run exits zero and reports no failed check$/, (ctx) => {
    const { status, stdout, stderr } = ctx.bl1496.run;
    const failures = `${stdout}${stderr}`.split('\n').filter((l) => l.startsWith('FAIL'));
    assert.deepEqual(failures, [], `failed checks:\n${failures.join('\n')}`);
    assert.equal(status, 0, `exited ${status}\n${stdout}\n${stderr}`);
  });
}

module.exports = { registerSteps };
