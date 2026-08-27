'use strict';

// BL-463: step handlers for "the mutation cooldown gate ignores the current
// parcel's own commits". Drives the REAL mutation_cooldown_gate.bb CLI
// against a throwaway git fixture (never a hand-rolled substitute for the
// real git-plumbing/decision logic) - same fixture convention
// swarmMutationCostPrepassSteps.js already established for shelling a real
// swarm-tooling script under a temp root. Each fixture builds an actual
// `main` branch plus a separate in-flight "parcel" branch, mirroring how a
// real role worktree already carries its own just-committed change that has
// not yet reached `main` (QA lands it there only at the end).
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { execFileSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const GATE = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'mutation_cooldown_gate.bb');
const COOLDOWN_DAYS = 3;

function git(root, args, extraEnv = {}) {
  return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', env: { ...process.env, ...extraEnv } });
}

function makeRepo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aps-mutation-cooldown-'));
  git(root, ['init', '-q', '-b', 'main']);
  git(root, ['config', 'user.email', 'test@test']);
  git(root, ['config', 'user.name', 'test']);
  fs.mkdirSync(path.join(root, 'swarmforge'), { recursive: true });
  fs.writeFileSync(path.join(root, 'swarmforge', 'swarmforge.conf'), `config active_backlog_max_depth 5\nconfig mutation_cooldown_days ${COOLDOWN_DAYS}\n`);
  return root;
}

// A real, day-granularity relative date - the SAME accepted pattern
// test_mutation_cooldown_gate.sh already uses for this exact gate (the
// decision is inherently "age relative to right now", and day-level
// granularity swamps any cross-process clock skew many orders of magnitude).
function isoDaysAgo(days) {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

function commitAt(root, filePath, content, isoDate) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
  git(root, ['add', '-A']);
  git(root, ['commit', '-q', '-m', `commit at ${isoDate}`], { GIT_AUTHOR_DATE: isoDate, GIT_COMMITTER_DATE: isoDate });
}

function runGate(ctx) {
  ctx.stdout = execFileSync('bb', [GATE, ctx.root, ctx.file], { encoding: 'utf8', env: { ...process.env, ...(ctx.hostEnv || {}) } });
}

function registerSteps(registry) {
  // ── shared across all four scenarios ──────────────────────────────────
  registry.define(/^the host is quiet$/, (ctx) => {
    ctx.hostEnv = { SWARMFORGE_MUTATION_GATE_FORCE_LOAD_AVG: '0.1', SWARMFORGE_MUTATION_GATE_FORCE_CORES: '4' };
  });

  registry.define(/^the mutation cooldown gate runs for that file$/, (ctx) => {
    runGate(ctx);
  });

  registry.define(/^it decides to run mutation testing$/, (ctx) => {
    if (!/^DECISION: run$/m.test(ctx.stdout)) {
      throw new Error(`expected DECISION: run, got:\n${ctx.stdout}`);
    }
  });

  registry.define(/^it does not report skip-cooldown$/, (ctx) => {
    if (/^DECISION: skip-cooldown$/m.test(ctx.stdout)) {
      throw new Error(`expected NOT skip-cooldown, got:\n${ctx.stdout}`);
    }
  });

  registry.define(/^it reports skip-cooldown$/, (ctx) => {
    if (!/^DECISION: skip-cooldown$/m.test(ctx.stdout)) {
      throw new Error(`expected DECISION: skip-cooldown, got:\n${ctx.stdout}`);
    }
  });

  // ── cooldown-ignore-own-01 ─────────────────────────────────────────────
  registry.define(/^a file whose only recent commits are the current in-flight parcel's own commits$/, (ctx) => {
    ctx.root = makeRepo();
    ctx.file = path.join(ctx.root, 'src', 'thing.ts');
    commitAt(ctx.root, ctx.file, 'export const thing = 1;\n', isoDaysAgo(10));
    git(ctx.root, ['checkout', '-q', '-b', 'parcel-branch']);
    fs.writeFileSync(ctx.file, 'export const thing = 2; // the parcel\'s own in-flight change\n');
    git(ctx.root, ['add', '-A']);
    git(ctx.root, ['commit', '-q', '-m', "parcel's own fresh commit (not yet on main)"]);
  });

  registry.define(/^no commit already on the integration branch touched it within the cooldown window$/, (ctx) => {
    const out = git(ctx.root, ['log', '-1', '--format=%at', 'main', '--', ctx.file]).trim();
    const ageMs = Date.now() - Number(out) * 1000;
    if (ageMs < COOLDOWN_DAYS * 24 * 60 * 60 * 1000) {
      throw new Error("fixture bug: expected main's last touch to already be outside the cooldown window");
    }
  });

  // ── cooldown-ignore-own-02 ─────────────────────────────────────────────
  registry.define(
    /^a file last committed-touched on the integration branch within the cooldown window by earlier integrated work$/,
    (ctx) => {
      ctx.root = makeRepo();
      ctx.file = path.join(ctx.root, 'src', 'thing.ts');
      commitAt(ctx.root, ctx.file, 'export const thing = 1;\n', isoDaysAgo(1));
    }
  );

  // ── cooldown-ignore-own-03 ─────────────────────────────────────────────
  registry.define(/^a file last committed-touched on the integration branch before the cooldown window$/, (ctx) => {
    ctx.root = makeRepo();
    ctx.file = path.join(ctx.root, 'src', 'thing.ts');
    commitAt(ctx.root, ctx.file, 'export const thing = 1;\n', isoDaysAgo(10));
  });

  registry.define(/^no in-flight parcel commit resets its cooldown clock$/, (ctx) => {
    const branch = git(ctx.root, ['branch', '--show-current']).trim();
    if (branch !== 'main') {
      throw new Error(`fixture bug: expected no separate in-flight branch, still on main; got "${branch}"`);
    }
  });

  // ── cooldown-ignore-own-04 ─────────────────────────────────────────────
  registry.define(/^a file that the current parcel introduces with no prior integrated history$/, (ctx) => {
    ctx.root = makeRepo();
    // `main` needs at least one commit to be a resolvable ref, but that seed
    // commit must never touch the new file below.
    commitAt(ctx.root, path.join(ctx.root, 'README.md'), '# repo\n', isoDaysAgo(10));
    git(ctx.root, ['checkout', '-q', '-b', 'parcel-branch']);
    ctx.file = path.join(ctx.root, 'src', 'brand-new.ts');
    fs.mkdirSync(path.dirname(ctx.file), { recursive: true });
    fs.writeFileSync(ctx.file, 'export const x = 1;\n');
    git(ctx.root, ['add', '-A']);
    git(ctx.root, ['commit', '-q', '-m', 'introduce a brand-new file on the parcel branch']);
  });
}

module.exports = { registerSteps };
