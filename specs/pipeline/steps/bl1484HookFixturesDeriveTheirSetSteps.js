'use strict';

// BL-1484: four shell fixtures that install the real git hooks stop pinning
// their copy set with a hand-typed `cp` list and read it, at run time,
// through BL-1398's helper (extended here to recognise commit-msg's
// direct-call line shape). Every scenario drives the REAL fixture files
// against either the live chain or a scratch seam this handler builds -
// nothing greps a label, since the defect being closed is precisely a list
// that had quietly stopped agreeing with the chain it was supposed to
// mirror (BL-1408's own posture, extended to the two fixtures its grep for
// check_feature_handler_registration.sh could not see, and to commit-msg).
//
// Scenarios 02-04 all drive the ticket-deletion fixture, per the feature's
// own text - it is the one fixture that installs BOTH chains (pre-commit
// AND commit-msg), so one seam tree exercises whichever chain a scenario's
// Given spliced, with the other chain's own file on the seam left exactly
// as it stands on the tree.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const FEATURE = 'BL-1484 The hook-installing fixtures derive their guard set from the hooks they install';

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const TEST_DIR = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'test');

const FIXTURE_SCRIPTS = {
  'test_ticket_deletion_guard.sh': path.join(TEST_DIR, 'test_ticket_deletion_guard.sh'),
  'test_commit_size_guard.sh': path.join(TEST_DIR, 'test_commit_size_guard.sh'),
  'test_merge_deletion_guard.sh': path.join(TEST_DIR, 'test_merge_deletion_guard.sh'),
  'test_retirement_readdition_guard.sh': path.join(TEST_DIR, 'test_retirement_readdition_guard.sh'),
};
const KNOWN_FIXTURES = Object.keys(FIXTURE_SCRIPTS);

const TICKET_DELETION_FIXTURE = FIXTURE_SCRIPTS['test_ticket_deletion_guard.sh'];
const EXTRA_GUARD = 'check_bl1484_probe.sh';

function run(scriptPath, args) {
  const res = spawnSync('bash', [scriptPath, ...args], { encoding: 'utf8', timeout: 300000 });
  return { status: res.status, out: `${res.stdout || ''}${res.stderr || ''}` };
}

function insertBeforeMarker(text, marker, extraLine) {
  const lines = text.split('\n');
  const idx = lines.findIndex((l) => l.includes(marker));
  assert.ok(idx >= 0, `marker "${marker}" not found while building a seam`);
  lines.splice(idx, 0, extraLine);
  return lines.join('\n');
}

function mkScratchRoot(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function withScratchRoot(prefix, fn) {
  const root = mkScratchRoot(prefix);
  try {
    return fn(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

// A copy of the live swarmforge/scripts and swarmforge/git-hooks trees - the
// same "a copy of swarmforge/scripts/ and swarmforge/git-hooks/ plus the
// planted guard" shape the ticket's own direction names. Read-only: nothing
// here is a git repository, and nothing derives from it runs a git command
// against it - only the ticket-deletion fixture's own throwaway repo (built
// separately, by the fixture itself) ever gets a `git init` or a commit.
function copySwarmforgeTree(root) {
  fs.cpSync(path.join(REPO_ROOT, 'swarmforge', 'scripts'), path.join(root, 'swarmforge', 'scripts'), {
    recursive: true,
  });
  fs.cpSync(path.join(REPO_ROOT, 'swarmforge', 'git-hooks'), path.join(root, 'swarmforge', 'git-hooks'), {
    recursive: true,
  });
}

function plantGuard(root, name) {
  fs.writeFileSync(path.join(root, 'swarmforge', 'scripts', name), '#!/usr/bin/env bash\nexit 0\n', { mode: 0o755 });
}

// A seam tree whose RUNNER names an additional guard present beside it
// (scenario 02) - inserted before the tier-1 refusal check so a clean
// commit always reaches it. commit-msg on the seam is left untouched.
function buildRunnerSeam(root) {
  copySwarmforgeTree(root);
  const runnerPath = path.join(root, 'swarmforge', 'scripts', 'run_commit_guards.sh');
  const withExtra = insertBeforeMarker(fs.readFileSync(runnerPath, 'utf8'), 'if guard_chain_has_refusal', `run_guard ${EXTRA_GUARD}`);
  fs.writeFileSync(runnerPath, withExtra);
  fs.chmodSync(runnerPath, 0o755);
  plantGuard(root, EXTRA_GUARD);
  return root;
}

// A seam tree whose COMMIT-MSG hook calls an additional guard - present
// beside it (scenario 03) or absent (scenario 04) - in the same direct-call
// shape production's commit-msg uses, inserted before the final
// `exit "$status"` so it always runs. The runner on the seam is untouched.
function buildCommitMsgSeam(root, { plant }) {
  copySwarmforgeTree(root);
  const hookPath = path.join(root, 'swarmforge', 'git-hooks', 'commit-msg');
  const extraLine = `"$REPO_ROOT/swarmforge/scripts/${EXTRA_GUARD}" "$1" || status=$?`;
  const withExtra = insertBeforeMarker(fs.readFileSync(hookPath, 'utf8'), 'exit "$status"', extraLine);
  fs.writeFileSync(hookPath, withExtra);
  fs.chmodSync(hookPath, 0o755);
  if (plant) plantGuard(root, EXTRA_GUARD);
  return root;
}

// Module scope, not per-ctx: the runtime gives each scenario its own ctx, so
// a per-ctx memo would re-run a shell fixture once per scenario that shares
// it (BL-1408's own fixture handler notes the same shape).
const memo = {};
function once(key, fn) {
  if (!(key in memo)) memo[key] = fn();
  return memo[key];
}

function realFixtureResult(fixture) {
  return once(`real:${fixture}`, () => run(FIXTURE_SCRIPTS[fixture], []));
}

function runnerSeamResult() {
  return once('runnerSeam', () => withScratchRoot('sfvc-bl1484-runner-seam-', (root) => run(TICKET_DELETION_FIXTURE, [buildRunnerSeam(root)])));
}

function commitMsgSeamResult(plant) {
  return once(`commitMsgSeam:${plant}`, () =>
    withScratchRoot('sfvc-bl1484-commitmsg-seam-', (root) => run(TICKET_DELETION_FIXTURE, [buildCommitMsgSeam(root, { plant })]))
  );
}

function derivedCopySetLine(out) {
  return out.split('\n').find((l) => l.startsWith('derived copy set:'));
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  // ── Given ───────────────────────────────────────────────────────────────
  scoped(/^the real pre-commit and commit-msg hooks and the runner they exec, as they stand on the tree$/, (ctx) => {
    ctx.bl1484 = ctx.bl1484 || {};
  });

  scoped(/^a seam tree whose runner names an additional guard present beside it$/, (ctx) => {
    ctx.bl1484 = ctx.bl1484 || {};
    ctx.bl1484.seamKind = 'runner';
  });

  scoped(/^a seam tree whose commit-msg hook calls an additional guard present beside it$/, (ctx) => {
    ctx.bl1484 = ctx.bl1484 || {};
    ctx.bl1484.seamKind = 'commitMsg';
    ctx.bl1484.plant = true;
  });

  scoped(/^a seam tree whose commit-msg hook calls a guard that is absent beside it$/, (ctx) => {
    ctx.bl1484 = ctx.bl1484 || {};
    ctx.bl1484.seamKind = 'commitMsg';
    ctx.bl1484.plant = false;
  });

  // ── When ────────────────────────────────────────────────────────────────
  scoped(/^the hook fixture (\S+) runs against the live repository$/, (ctx, fixture) => {
    assert.ok(KNOWN_FIXTURES.includes(fixture), `unknown fixture example value: ${fixture}`);
    ctx.bl1484.fixture = fixture;
    ctx.bl1484.result = realFixtureResult(fixture);
  });

  // Shared by scenarios 02, 03 and 04 (one fixture, one seam argument, three
  // seam contents) - the Given above already decided which chain and
  // whether the extra guard was planted.
  scoped(/^the ticket-deletion hook fixture runs against the seam$/, (ctx) => {
    ctx.bl1484.result = ctx.bl1484.seamKind === 'runner' ? runnerSeamResult() : commitMsgSeamResult(ctx.bl1484.plant);
  });

  // ── Then ────────────────────────────────────────────────────────────────
  scoped(/^the fixture passes every case$/, (ctx) => {
    const { status, out } = ctx.bl1484.result;
    assert.equal(status, 0, `expected exit 0, got ${status}:\n${out}`);
    assert.ok(/^ALL PASS$/m.test(out), `expected "ALL PASS" in:\n${out}`);
    assert.ok(!/^FAIL:/m.test(out), `expected no FAIL lines:\n${out}`);
  });

  scoped(/^it reports the copy set it derived$/, (ctx) => {
    const { out } = ctx.bl1484.result;
    assert.ok(derivedCopySetLine(out), `expected a "derived copy set:" line in:\n${out}`);
  });

  scoped(/^it reports the additional guard among the files it derived$/, (ctx) => {
    const { out } = ctx.bl1484.result;
    const line = derivedCopySetLine(out);
    assert.ok(line, `expected a "derived copy set:" line in:\n${out}`);
    assert.ok(line.includes(EXTRA_GUARD), `expected the derived set to name ${EXTRA_GUARD}, got: ${line}`);
  });

  scoped(/^the fixture fails naming the absent guard$/, (ctx) => {
    const { status, out } = ctx.bl1484.result;
    assert.notEqual(status, 0, `expected a non-zero exit when the derivation names a guard the tree lacks, got 0:\n${out}`);
    assert.ok(out.includes(EXTRA_GUARD), `expected the failure to name ${EXTRA_GUARD}, got:\n${out}`);
  });

  // The ticket-deletion fixture's cases 01-07 exercise check_ticket_deletion.sh
  // standalone, before hooks are ever installed - those legitimately pass.
  // The seam derivation happens only in case 08's own setup, so the claim
  // is that no case FROM 08 ON is ever reported passed once it throws.
  scoped(/^no case is reported as passed after the failure$/, (ctx) => {
    const { out } = ctx.bl1484.result;
    assert.ok(!/^ALL PASS$/m.test(out), `expected no "ALL PASS" - the derivation must fail before the suite completes:\n${out}`);
    assert.ok(!/^PASS: (0[8-9]|[1-9][0-9])/m.test(out), `expected no case 08 or later to pass once the derivation fails:\n${out}`);
  });
}

module.exports = { registerSteps };
