'use strict';

// BL-1683: step handlers for "The merge-drop guard maps renames and judges
// a renamed path by its content at the new path". Drives the REAL
// merge_drop_guard_lib.bb (findings-between) against a real fixture git
// repo. Same convention bl1576MergeDropGuardSteps.js already established:
// the merge commit under test is built with `git commit-tree` directly
// (parents [sender, received], an EXACT tree) rather than through a real
// `git merge` - deterministic control over what the merge resolution kept
// or dropped, never at the mercy of git's own merge heuristics for this
// content shape.
//
// Fixture shape (deliberately more than the feature's own prose): a
// shared STUB base ("S1".."S6", large enough for git's own -M rename
// heuristic to fire at all - too small a file and git never attempts
// rename detection) with received and sender diverging from it
// INDEPENDENTLY (received is never an ancestor of sender, or vice versa -
// the real incident's own shape: the sender's promotion reaches main
// through a lineage the received commit never touches). Received replaces
// the FIRST stub line with the real twenty lines; the sender's own
// promotion (rename, plus the one appended line) touches only the LAST
// stub line - the two edits sit at disjoint base positions so the guard's
// own contested-hunk check (BL-1576 invariant 2) never conflates the
// sender's rename-time edit with received's own content, which a
// coincident insertion point would (verified empirically while writing
// this fixture: an earlier draft appended at the SAME base position
// received inserted at, and the guard correctly, if unhelpfully for this
// fixture, read the two as CONTESTING each other).

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { mkSocketFixtureRoot } = require('./lib/socketFixtureRoot');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const LIB = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'merge_drop_guard_lib.bb');

const FEATURE = 'BL-1683 The merge-drop guard maps renames and judges a renamed path by its content at the new path';
const OLD_PATH = 'backlog/paused/BL-0001-ticket.yaml';
const NEW_PATH = 'backlog/active/BL-0001-ticket.yaml';
const STUB = ['S1', 'S2', 'S3', 'S4', 'S5', 'S6'];

function twentyLines() {
  return Array.from({ length: 20 }, (_, i) => `line ${i + 1}`);
}

function git(cwd, args) {
  execFileSync('git', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
}

function gitOut(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

function head(cwd) {
  return gitOut(cwd, ['rev-parse', 'HEAD']);
}

function commit(cwd, message) {
  git(cwd, ['add', '-A']);
  git(cwd, ['commit', '-q', '-m', message]);
}

function writeLines(root, relPath, lines) {
  fs.mkdirSync(path.dirname(path.join(root, relPath)), { recursive: true });
  fs.writeFileSync(path.join(root, relPath), `${lines.join('\n')}\n`);
}

function findingsBetween(root, received, forwarded) {
  const out = execFileSync('bb', [LIB, root, received, forwarded], { encoding: 'utf8' }).trim();
  if (!out) return [];
  return out.split('\n').filter(Boolean).map((line) => JSON.parse(line));
}

// Rebuilds the merge (parents [sender, received]) with `activeLines` as the
// exact content at NEW_PATH - `git commit-tree` directly, per the
// established convention, so this scenario's own "dropped 3 lines" Given
// can rebuild the SAME merge shape the Background already built, minus
// three of received's own lines.
function buildMerge(ctx, activeLines) {
  git(ctx.root, ['checkout', '-q', 'mainpromote']);
  writeLines(ctx.root, NEW_PATH, activeLines);
  git(ctx.root, ['add', '-A']);
  const treeSha = gitOut(ctx.root, ['write-tree']);
  const mergeSha = gitOut(ctx.root, [
    'commit-tree', treeSha,
    '-p', ctx.senderSha,
    '-p', ctx.receivedSha,
    '-m', 'Merge received into forwarding.',
  ]);
  git(ctx.root, ['update-ref', 'refs/heads/forwarding', mergeSha]);
  git(ctx.root, ['checkout', '-q', 'forwarding']);
  ctx.forwardingSha = head(ctx.root);
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(/^a fixture repository with a main branch, a received branch and a forwarding branch$/, (ctx) => {
    ctx.root = mkSocketFixtureRoot('bl1683-merge-drop-');
    git(ctx.root, ['init', '-q', '-b', 'main', '.']);
    git(ctx.root, ['config', 'user.email', 'bl1683@example.com']);
    git(ctx.root, ['config', 'user.name', 'bl1683']);
    git(ctx.root, ['config', 'commit.gpgsign', 'false']);
    writeLines(ctx.root, OLD_PATH, STUB);
    commit(ctx.root, 'stub base');
    ctx.baseSha = head(ctx.root);
  });

  scoped(/^the received branch adds "([^"]+)" with twenty lines$/, (ctx, relPath) => {
    assert.equal(relPath, OLD_PATH, `unexpected path in feature text: ${relPath}`);
    git(ctx.root, ['checkout', '-q', '-b', 'received', ctx.baseSha]);
    // Replaces ONLY the first stub line (base position 1) - the stub's
    // remaining five lines stay, at the END, so the sender's own edit
    // below (at the LAST stub line) never lands at the same base
    // position as this one.
    writeLines(ctx.root, OLD_PATH, [...twentyLines(), ...STUB.slice(1)]);
    commit(ctx.root, 'BL-0001: add ticket content');
    ctx.receivedSha = head(ctx.root);
  });

  scoped(/^main promotes that file to "([^"]+)" appending one line$/, (ctx, relPath) => {
    assert.equal(relPath, NEW_PATH, `unexpected path in feature text: ${relPath}`);
    // Built from the SAME stub base, never from `received` - the real
    // incident's own shape: main's promotion reaches the forward through
    // a lineage that never saw the received branch's own content.
    git(ctx.root, ['checkout', '-q', '-b', 'mainpromote', ctx.baseSha]);
    // `git mv` (2.43.0) does not create the destination directory itself.
    fs.mkdirSync(path.dirname(path.join(ctx.root, NEW_PATH)), { recursive: true });
    git(ctx.root, ['mv', OLD_PATH, NEW_PATH]);
    writeLines(ctx.root, NEW_PATH, [...STUB, 'line 21']);
    commit(ctx.root, 'Promote BL-0001: paused -> active');
    ctx.senderSha = head(ctx.root);
  });

  scoped(/^the forwarding branch merges main and then merges the received branch$/, (ctx) => {
    // The tree BL-1683's own invariant 1 says is correct: every one of
    // received's twenty lines survives at the new path, plus the stub's
    // own untouched tail and the promotion's appended line.
    buildMerge(ctx, [...twentyLines(), ...STUB.slice(1), 'line 21']);
  });

  // ── Scenario 02's own Given ──────────────────────────────────────────
  scoped(/^the forwarding branch's merge also dropped three of the received side's twenty lines from the active copy$/, (ctx) => {
    const dropped = twentyLines().filter((_, i) => ![5, 10, 15].includes(i + 1));
    assert.equal(dropped.length, 17, 'expected exactly 3 of the 20 lines dropped');
    buildMerge(ctx, [...dropped, ...STUB.slice(1), 'line 21']);
  });

  scoped(/^the merge-drop guard judges a forward of the merged tip against the received tip$/, (ctx) => {
    ctx.findings = findingsBetween(ctx.root, ctx.receivedSha, ctx.forwardingSha);
  });

  scoped(/^it reports no blocking finding$/, (ctx) => {
    const blocking = ctx.findings.filter((f) => !f.excused);
    assert.deepEqual(blocking, [], `expected no blocking finding, got: ${JSON.stringify(ctx.findings)}`);
  });

  scoped(/^the send is not refused$/, (ctx) => {
    const blocking = ctx.findings.filter((f) => !f.excused);
    assert.equal(blocking.length, 0, `expected the send allowed (no blocking findings), got: ${JSON.stringify(ctx.findings)}`);
  });

  scoped(/^it reports one blocking finding of three lines$/, (ctx) => {
    const blocking = ctx.findings.filter((f) => !f.excused);
    assert.equal(blocking.length, 1, `expected exactly one blocking finding, got: ${JSON.stringify(ctx.findings)}`);
    assert.equal(blocking[0].lines, 3, `expected 3 lines lost, got: ${JSON.stringify(blocking[0])}`);
  });

  scoped(/^the finding names "([^"]+)"$/, (ctx, expectedPath) => {
    const blocking = ctx.findings.filter((f) => !f.excused);
    assert.equal(blocking[0].path, expectedPath, `expected the finding to name ${expectedPath}, got: ${JSON.stringify(blocking[0])}`);
  });
}

module.exports = { registerSteps };
