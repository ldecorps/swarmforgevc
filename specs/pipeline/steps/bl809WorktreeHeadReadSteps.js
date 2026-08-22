'use strict';

// BL-809: step handlers for "the claim-risk sweep can actually read a
// worktree's HEAD". Drives the REAL babysitter-assess-lib functions
// (worktree-head-commit-10, assess-one-claim) through
// bl809_claim_risk_sweep_harness.bb against a real git worktree — never a
// parallel reimplementation of the fix.
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const HARNESS = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'test', 'bl809_claim_risk_sweep_harness.bb');

const FEATURE = "the claim-risk sweep can actually read a worktree's HEAD";

// Scenario Outline KNOWN_VALUES — the Examples table is the single source of
// truth; any other example value is a spec error, not something to guess at.
const UNTRACKED_MODE_BY_EXAMPLE = {
  none: 'none',
  'ordinary untracked files': 'ordinary',
  'only fixture droppings': 'fixture-only',
};
const KNOWN_SEVERITIES = new Set(['watch', 'warn-uncommitted', 'warn-fixture-droppings']);
const STALL_SEVERITIES = KNOWN_SEVERITIES;

function scoped(registry, pattern, handler) {
  registry.defineScoped(pattern, handler, FEATURE);
}

function runHarness(subArgs) {
  const result = spawnSync('bb', [HARNESS, ...subArgs], {
    encoding: 'utf8',
    timeout: 30000,
    cwd: REPO_ROOT,
    env: process.env,
  });
  if (result.status !== 0) {
    throw new Error(
      `bl809 harness ${subArgs.join(' ')} exited ${result.status}:\n${result.stdout || ''}${result.stderr || ''}`
    );
  }
  const rawStdout = result.stdout || '';
  const lines = rawStdout.split('\n').filter((l) => l.trim().length > 0);
  let parsed;
  try {
    parsed = JSON.parse(lines[lines.length - 1] || '');
  } catch (err) {
    throw new Error(`bl809 harness ${subArgs.join(' ')} printed no parseable JSON:\n${rawStdout}`);
  }
  return { rawStdout, lineCount: lines.length, parsed };
}

function registerSteps(registry) {
  // ── Background ──────────────────────────────────────────────────────
  scoped(registry, /^a role worktree with a claim-progress sidecar$/, (ctx) => {
    ctx.bl809 = ctx.bl809 || {};
  });

  // ── head-read-returns-the-commit-01 ─────────────────────────────────
  scoped(registry, /^that worktree's git HEAD can be read$/, (ctx) => {
    ctx.bl809.claimCommitMode = 'current-head';
  });

  scoped(registry, /^the claim-risk sweep reads that worktree's HEAD$/, (ctx) => {
    ctx.bl809.result = runHarness(['head-read']);
  });

  scoped(registry, /^it yields the worktree's 10-character HEAD commit$/, (ctx) => {
    const { headCommit, expectedHeadCommit } = ctx.bl809.result.parsed;
    if (!/^[0-9a-f]{10}$/.test(headCommit)) {
      throw new Error(`expected a 10-char hex HEAD commit, got: ${JSON.stringify(headCommit)}`);
    }
    if (headCommit !== expectedHeadCommit) {
      throw new Error(`expected ${expectedHeadCommit}, got ${headCommit}`);
    }
  });

  // ── no-raw-git-output-on-stdout-02 ──────────────────────────────────
  scoped(registry, /^the claim-risk sweep runs$/, (ctx) => {
    const mode = ctx.bl809.claimCommitMode;
    if (mode === 'moved') {
      ctx.bl809.result = runHarness(['moved-head']);
    } else if (mode === 'unreadable') {
      ctx.bl809.result = runHarness(['unreadable-head']);
    } else if (mode === 'current-head' && ctx.bl809.untrackedMode) {
      ctx.bl809.result = runHarness(['severity', ctx.bl809.untrackedMode]);
    } else {
      ctx.bl809.result = runHarness(['head-read']);
    }
  });

  scoped(registry, /^no raw git command output appears on the daemon's stdout$/, (ctx) => {
    const { lineCount, rawStdout } = ctx.bl809.result;
    if (lineCount !== 1) {
      throw new Error(
        `expected exactly one line of output (the JSON result), got ${lineCount} lines:\n${rawStdout}`
      );
    }
  });

  // ── stall-severities-are-reachable-03 / untracked-files-are-actually-read-04 ─
  scoped(registry, /^the sidecar's claim commit equals the worktree's current HEAD$/, (ctx) => {
    ctx.bl809.claimCommitMode = 'current-head';
  });

  scoped(registry, /^the claim has aged past three quarters of its idle timeout$/, () => {
    // Non-behavioral marker: the harness always ages the claim to 80% of the
    // idle timeout, matching this precondition for every scenario that uses it.
  });

  scoped(registry, /^the worktree's untracked files are (.+)$/, (ctx, exampleValue) => {
    const mode = UNTRACKED_MODE_BY_EXAMPLE[exampleValue];
    if (!mode) {
      throw new Error(
        `unknown untracked-files example value ${JSON.stringify(exampleValue)}; expected one of: ${Object.keys(UNTRACKED_MODE_BY_EXAMPLE).join(', ')}`
      );
    }
    ctx.bl809.untrackedMode = mode;
  });

  scoped(registry, /^the assessment's severity is (.+)$/, (ctx, exampleValue) => {
    if (!KNOWN_SEVERITIES.has(exampleValue)) {
      throw new Error(
        `unknown severity example value ${JSON.stringify(exampleValue)}; expected one of: ${[...KNOWN_SEVERITIES].join(', ')}`
      );
    }
    const actual = ctx.bl809.result.parsed.severity;
    if (actual !== exampleValue) {
      throw new Error(`expected severity ${exampleValue}, got ${actual}`);
    }
  });

  scoped(registry, /^the assessment reports a non-zero untracked file count$/, (ctx) => {
    const count = ctx.bl809.result.parsed.untrackedFiles;
    if (!(count > 0)) {
      throw new Error(`expected a non-zero untracked file count, got ${JSON.stringify(count)}`);
    }
  });

  // ── moved-head-is-not-a-stall-05 ─────────────────────────────────────
  scoped(registry, /^the sidecar's claim commit differs from the worktree's current HEAD$/, (ctx) => {
    ctx.bl809.claimCommitMode = 'moved';
  });

  scoped(registry, /^no stall severity is reported for that claim$/, (ctx) => {
    const severity = ctx.bl809.result.parsed.severity;
    if (STALL_SEVERITIES.has(severity)) {
      throw new Error(`expected no stall severity for a moved HEAD, got ${JSON.stringify(severity)}`);
    }
  });

  // ── unreadable-head-degrades-06 ──────────────────────────────────────
  scoped(registry, /^that worktree's git HEAD cannot be read$/, (ctx) => {
    ctx.bl809.claimCommitMode = 'unreadable';
  });

  scoped(registry, /^that claim yields a blank head rather than raising$/, (ctx) => {
    const head = ctx.bl809.result.parsed.brokenHeadCommit;
    if (head !== '') {
      throw new Error(`expected a blank head for an unreadable worktree, got ${JSON.stringify(head)}`);
    }
  });

  scoped(registry, /^the sweep still assesses the remaining claims$/, (ctx) => {
    const severity = ctx.bl809.result.parsed.healthySeverity;
    if (!severity || typeof severity !== 'string') {
      throw new Error(
        `expected the healthy worktree's claim to still be assessed after the broken one, got: ${JSON.stringify(severity)}`
      );
    }
  });
}

module.exports = { registerSteps };
