'use strict';

// BL-1395: a landed daemon script is booted before it is published.
//
// Drives the REAL guard against REAL trees through this ticket's own e2e —
// including booting a real handoffd from the tree under test, which is the
// step that actually caught 2026-09-04's defect. A scenario that grepped for
// a label would be the very shape this ticket exists to end: the land whose
// whole verification was three greps put an unloadable daemon on main and
// crash-looped the swarm from 18:20Z.

const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const FEATURE = 'BL-1395 A landed daemon script is booted before it is published';
const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const E2E = path.join('swarmforge', 'scripts', 'test', 'test_bl1395_bb_scripts_load.sh');

// Explicit KNOWN_VALUES: a scenario naming a claim this handler does not know
// throws rather than passing through unchecked.
const CLAIMS = {
  forward: 'a forward reference is refused',
  named: 'and the refusal names the file, the line and the symbol',
  reordered: 'the same file passes once g is defined above f',
  missing: 'a call to a function defined nowhere is refused, naming the symbol',
  'runtime-require': "a runtime require whose alias is used at analysis time is refused (BL-1381's shape)",
  'daemon-refused': 'a daemon that cannot boot is refused, naming handoffd.bb',
  'daemon-boots': 'the healthy tip boots and passes',
  'tree-only': "a file that does not load on the TREE is refused, whatever the checker's worktree holds",
  'in-commit-chain': 'the guard is in the commit guard chain (a hand-splice on main meets it)',
  'in-land-guards': 'and in the land replay\'s tree-guard list (a replay meets it)',
  'load-analyses': 'load-file on the real handoffd.bb analyses without starting a daemon (guarded -main)',
  'no-daemon-starts': 'no daemon process starts when handoffd.bb is loaded as a file',
  'others-reported': 'the guard runs through run_guard, so every other guard\'s status is still reported',
};

// The Scenario Outlines' columns.
const DEFECTS = {
  'a call to a function defined later in the same file': 'forward',
  'a runtime require inside a function body': 'runtime-require',
  'a call to a function defined nowhere': 'missing',
};
const SHAPES = {
  'the landed shape with an undefined read-json': 'daemon-refused',
  'the QA tip shape with the block after its callee': 'daemon-boots',
};
const PATHS = {
  'the commit guards': 'in-commit-chain',
  'the land replay': 'in-land-guards',
};

// Module scope: the runtime gives each scenario its own ctx, so a per-ctx memo
// would re-run this whole suite once per scenario (BL-1390's storm multiplier).
let suiteRun = null;

function runE2e(ctx) {
  if (suiteRun) {
    ctx.bl1395 = { ...(ctx.bl1395 || {}), out: suiteRun.out, status: suiteRun.status };
    return suiteRun.out;
  }
  const res = spawnSync('bash', [E2E], { cwd: REPO_ROOT, encoding: 'utf8', timeout: 2400000 });
  const out = `${res.stdout || ''}${res.stderr || ''}`;
  suiteRun = { out, status: res.status };
  ctx.bl1395 = { ...(ctx.bl1395 || {}), out, status: res.status };
  if (res.status !== 0) {
    throw new Error(`the BL-1395 script-load e2e failed (${res.status}):\n${out}`);
  }
  return out;
}

function requirePassed(ctx, claimKey) {
  const claim = CLAIMS[claimKey];
  assert.ok(claim, `unknown claim: ${claimKey}`);
  const out = runE2e(ctx);
  assert.ok(out.includes(`PASS: ${claim}`), `"${claim}" did not pass, in:\n${out}`);
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  // ── Background ──────────────────────────────────────────────────────────
  scoped(/^a fixture tree with the swarmforge scripts and a bare origin$/, (ctx) => {
    ctx.bl1395 = ctx.bl1395 || {};
  });

  // ── Given ───────────────────────────────────────────────────────────────
  scoped(/^a Babashka library on the tree whose body has (.+)$/, (ctx, defect) => {
    const claim = DEFECTS[defect];
    assert.ok(claim, `unknown <defect> example: ${defect}`);
    ctx.bl1395.case = claim;
  });

  scoped(/^a Babashka library on the tree whose definitions are all in order$/, (ctx) => {
    ctx.bl1395.case = 'reordered';
  });

  scoped(/^handoffd on the tree is in (.+)$/, (ctx, shape) => {
    const claim = SHAPES[shape];
    assert.ok(claim, `unknown <shape> example: ${shape}`);
    ctx.bl1395.case = claim;
  });

  scoped(/^a Babashka library that names a symbol defined only in the checker's worktree$/, (ctx) => {
    ctx.bl1395.case = 'tree-only';
  });

  scoped(/^a change on the tree to a Babashka library that fails analysis$/, (ctx) => {
    ctx.bl1395.case = 'forward';
  });

  // ── When ────────────────────────────────────────────────────────────────
  scoped(/^the script load guard examines the tree$/, (ctx) => {
    runE2e(ctx);
  });

  scoped(/^the script load guard boots the daemon against a fixture root$/, (ctx) => {
    runE2e(ctx);
  });

  scoped(/^(.+) runs on that tree$/, (ctx, which) => {
    const claim = PATHS[which];
    assert.ok(claim, `unknown <path> example: ${which}`);
    ctx.bl1395.pathClaim = claim;
    runE2e(ctx);
  });

  // ── Then ────────────────────────────────────────────────────────────────
  scoped(/^the guard refuses$/, (ctx) => {
    requirePassed(ctx, ctx.bl1395.case);
  });

  scoped(/^its output names the file, the line and the unresolved symbol$/, (ctx) => {
    requirePassed(ctx, 'named');
  });

  scoped(/^the guard passes$/, (ctx) => {
    requirePassed(ctx, 'reordered');
    // The other half of "passes": the real daemon still analyses without
    // booting, which is what makes a load probe possible at all.
    requirePassed(ctx, 'load-analyses');
  });

  scoped(/^the guard (refuses naming handoffd|sees one heartbeat and passes) within its bound$/, (ctx) => {
    requirePassed(ctx, ctx.bl1395.case);
  });

  scoped(/^it refuses naming the library$/, (ctx) => {
    requirePassed(ctx, ctx.bl1395.pathClaim);
    requirePassed(ctx, 'forward');
  });

  scoped(/^every other guard's status is still reported$/, (ctx) => {
    requirePassed(ctx, 'others-reported');
  });

  // ── scenario 06: the guarded entry point ────────────────────────────────
  scoped(/^handoffd\.bb on the tree with its entry point guarded$/, (ctx) => {
    ctx.bl1395 = ctx.bl1395 || {};
  });

  scoped(/^handoffd\.bb is loaded as a file with no arguments$/, (ctx) => {
    runE2e(ctx);
  });

  scoped(/^no daemon process starts$/, (ctx) => {
    requirePassed(ctx, 'no-daemon-starts');
  });

  scoped(/^the load completes with no error$/, (ctx) => {
    requirePassed(ctx, 'load-analyses');
  });
}

module.exports = { registerSteps };
