'use strict';

// BL-1258: step handlers for "A retired ticket's artefacts cannot come
// back through a merge" - the addition-side twin of BL-1242. Drives the
// REAL check_retirement_readdition.sh and retirement_registry_cli.bb
// against a real git fixture, real merges - never a reimplementation of
// either.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const SCRIPTS_DIR = path.join(REPO_ROOT, 'swarmforge', 'scripts');
const GUARD = path.join(SCRIPTS_DIR, 'check_retirement_readdition.sh');
const REGISTRY_CLI = path.join(SCRIPTS_DIR, 'retirement_registry_cli.bb');
const FEATURE = "A retired ticket's artefacts cannot come back through a merge";

const TICKET_ID = 'BL-retired';
const ARTEFACTS = ['backlog/active/BL-retired-fixture.yaml', 'specs/features/BL-retired-fixture.feature'];

function git(cwd, args) {
  execFileSync('git', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
}

function gitOut(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

function gitCommit(cwd, message) {
  git(cwd, ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', message]);
}

function register(root, ticketId, paths) {
  execFileSync('bb', [REGISTRY_CLI, root, 'register', ticketId, ...paths], { encoding: 'utf8' });
}

function readPaths(root) {
  const out = execFileSync('bb', [REGISTRY_CLI, root, 'paths'], { encoding: 'utf8' });
  return out
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [p, id] = line.split('\t');
      return { path: p, ticketId: id };
    });
}

function runGuard(root, msgFile) {
  const res = spawnSync('bash', [GUARD, msgFile], { cwd: root, encoding: 'utf8' });
  return { status: res.status, out: `${res.stdout || ''}${res.stderr || ''}` };
}

function writeArtefacts(root) {
  for (const p of ARTEFACTS) {
    const full = path.join(root, p);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, `id: ${TICKET_ID}\n`);
  }
  git(root, ['add', '-A']);
  gitCommit(root, `${TICKET_ID}: mint`);
}

function mkRoot(ctx) {
  if (ctx.bl1258?.root) return ctx.bl1258.root;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bl1258-'));
  git(root, ['init', '-q', '-b', 'main']);
  git(root, ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'seed']);
  ctx.bl1258 = { root };
  return root;
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  // ── Background ───────────────────────────────────────────────────────
  scoped(/^a ticket id "BL-retired" that has been retired$/, (ctx) => {
    const root = mkRoot(ctx);
    // The artefacts mint on a "branch" ref (never on main - main's own
    // retirement, per the real incident, needs no forward deletion commit
    // of its own to be valid: it can equally be "never took the mint",
    // both routes are exercised explicitly in scenario 04 below).
    git(root, ['checkout', '-q', '-b', 'branch']);
    writeArtefacts(root);
    ctx.bl1258.branchTip = gitOut(root, ['rev-parse', '--short=10', 'HEAD']);
    git(root, ['checkout', '-q', 'main']);
    register(root, TICKET_ID, ARTEFACTS);
  });

  scoped(/^a branch that still carries the artefacts minted under "BL-retired"$/, () => {
    // No-op: the Background Given above already built exactly that branch.
  });

  // ── Scenario 01 ──────────────────────────────────────────────────────
  scoped(/^the retired artefacts are absent from the merge target$/, (ctx) => {
    // No-op: main never took the mint at all in this fixture - already
    // absent, matching this scenario's own precondition.
    mkRoot(ctx);
  });

  scoped(/^the merge is refused$/, (ctx) => {
    assert.notEqual(ctx.bl1258.guardResult.status, 0, ctx.bl1258.guardResult.out);
  });

  scoped(/^the refusal names each artefact path belonging to "BL-retired"$/, (ctx) => {
    const { out } = ctx.bl1258.guardResult;
    for (const p of ARTEFACTS) {
      assert.match(out, new RegExp(p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), out);
    }
  });

  // ── Scenario 02 ──────────────────────────────────────────────────────
  scoped(
    /^a branch adding files owned by a ticket that has not been retired, which the merge target does not yet have$/,
    (ctx) => {
      const root = mkRoot(ctx);
      git(root, ['checkout', '-q', 'main']);
      git(root, ['checkout', '-q', '-b', 'live-branch']);
      const p = 'specs/features/BL-live-fixture.feature';
      fs.mkdirSync(path.join(root, path.dirname(p)), { recursive: true });
      fs.writeFileSync(path.join(root, p), 'Feature: BL-live fixture\n');
      git(root, ['add', '-A']);
      gitCommit(root, 'BL-live: mint (never retired)');
      ctx.bl1258.liveBranchTip = gitOut(root, ['rev-parse', '--short=10', 'HEAD']);
    },
  );

  scoped(/^that branch is merged toward the target$/, (ctx) => {
    const { root, liveBranchTip, branchTip } = ctx.bl1258;
    const target = liveBranchTip || branchTip;
    git(root, ['checkout', '-q', 'main']);
    spawnSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'merge', '--no-ff', '--no-commit', target], { cwd: root, encoding: 'utf8' });
    const msgFile = path.join(root, '.msg');
    fs.writeFileSync(msgFile, 'merge branch into main\n');
    ctx.bl1258.guardResult = runGuard(root, msgFile);
  });

  scoped(/^the merge is allowed$/, (ctx) => {
    assert.equal(ctx.bl1258.guardResult.status, 0, ctx.bl1258.guardResult.out);
  });

  // ── Scenario 03 ──────────────────────────────────────────────────────
  scoped(/^"BL-retired" is retired$/, (ctx) => {
    const root = mkRoot(ctx);
    register(root, TICKET_ID, ARTEFACTS);
  });

  scoped(/^the retirement record names every artefact path retired with it$/, (ctx) => {
    const rows = readPaths(ctx.bl1258.root).filter((r) => r.ticketId === TICKET_ID);
    const paths = rows.map((r) => r.path).sort();
    assert.deepEqual(paths, [...ARTEFACTS].sort());
  });

  scoped(/^the record is readable from a branch that never carried the artefacts$/, (ctx) => {
    const { root } = ctx.bl1258;
    const wt = `${root}-wt-never-carried`;
    git(root, ['worktree', 'add', '-q', '-b', 'never-carried-branch', wt]);
    const rows = readPaths(wt).filter((r) => r.ticketId === TICKET_ID);
    assert.ok(rows.length > 0, 'expected the registry to be readable from a worktree that never merged the retirement record');
  });

  // ── Scenario 04 (outline) ────────────────────────────────────────────
  scoped(/^the artefacts of "BL-retired" reached the merge target's history by "(.+)"$/, (ctx, route) => {
    const root = mkRoot(ctx);
    git(root, ['checkout', '-q', 'main']);
    if (route === 'landed-then-deleted-on-the-target') {
      // Mirrors the real incident: a RESET (not a forward delete commit)
      // erases the mint from the target's own ancestry - a forward
      // delete commit alone would let git's ordinary 3-way merge resolve
      // "deleted vs unchanged" as the deletion winning, for free, proving
      // nothing about THIS guard. A reset is exactly how the real
      // BL-1247 incident's own "reconcile reset" erased its mint.
      writeArtefacts(root);
      const preReset = gitOut(root, ['rev-parse', 'HEAD^']);
      git(root, ['reset', '-q', '--hard', preReset]);
    } else if (route === 'never-landed-on-the-target') {
      // No-op: main never merges the mint at all in this fixture already.
    } else {
      throw new Error(`unrecognized route: "${route}"`);
    }
    register(root, TICKET_ID, ARTEFACTS);
  });

  scoped(/^a branch still carrying those artefacts is merged toward the target$/, (ctx) => {
    const { root, branchTip } = ctx.bl1258;
    git(root, ['checkout', '-q', 'main']);
    spawnSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'merge', '--no-ff', '--no-commit', branchTip], { cwd: root, encoding: 'utf8' });
    const msgFile = path.join(root, '.msg');
    fs.writeFileSync(msgFile, 'merge branch into main\n');
    ctx.bl1258.guardResult = runGuard(root, msgFile);
  });
}

module.exports = { registerSteps };
