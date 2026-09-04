'use strict';

// BL-1363: closing a ticket is one command.
//
// Drives the REAL close_ticket.sh against real repositories and the REAL
// commit_integrity_cli.bb - including its close guard, which refuses a close
// with no QA approval on record. That guard is the point: the script commits
// THROUGH the integrity path and obeys its refusal rather than falling back to
// a raw commit, which is the specific failure BL-1028 recorded.
//
// One run serves every scenario; verdicts are read by the script's PASS lines.

const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const FEATURE = 'Closing a ticket is one command';
const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const E2E = path.join('swarmforge', 'scripts', 'test', 'test_bl1363_close_ticket.sh');

// Explicit KNOWN_VALUES: a scenario naming a claim this handler does not know
// throws rather than passing through unchecked.
const CLAIMS = {
  'in-milestone': 'the ticket file is in the done area for its milestone',
  'one-step': 'the move is committed in one step with a generated subject',
  'integrity-path': 'the commit went through the integrity CLI, whose output is passed through',
  'nothing-staged': 'nothing else was left staged or dirty',
  'refusal-stays': 'a refused close leaves the ticket in the active area',
  'refusal-clean': 'and nothing is left staged in the shared index (BL-1028)',
  'refusal-reported': 'and the refusal reason is reported',
  'both-closed': 'both tickets are in the done area for their milestone',
  'names-every-id': 'and the commit subject names EVERY id the approval satisfied',
  'no-partial': 'neither ticket moved when one of them could not be closed',
  'names-blocker': 'and the refusal names the ticket that blocked it',
  'no-promotion': 'no paused ticket was promoted by a close',
  'own-paths-only': "the close commit contains only its own ticket's paths (BL-506)",
};

function runE2e(ctx) {
  if (ctx.bl1363?.out) return ctx.bl1363.out;
  const res = spawnSync('bash', [E2E], { cwd: REPO_ROOT, encoding: 'utf8', timeout: 1800000 });
  const out = `${res.stdout || ''}${res.stderr || ''}`;
  ctx.bl1363 = { ...(ctx.bl1363 || {}), out, status: res.status };
  if (res.status !== 0) {
    throw new Error(`the BL-1363 close e2e failed (${res.status}):\n${out}`);
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
  scoped(/^QA has approved a ticket and the coordinator is doing bookkeeping$/, (ctx) => {
    ctx.bl1363 = ctx.bl1363 || {};
  });

  // ── Given ───────────────────────────────────────────────────────────────
  scoped(/^the integrity check will refuse the close$/, (ctx) => {
    ctx.bl1363.case = 'refused';
  });

  scoped(/^the approved commit satisfies two tickets$/, (ctx) => {
    ctx.bl1363.case = 'batch';
  });

  scoped(/^one of them cannot be closed$/, (ctx) => {
    ctx.bl1363.case = 'partial';
  });

  // ── When ────────────────────────────────────────────────────────────────
  scoped(/^the coordinator closes the (ticket|approval)$/, (ctx) => {
    runE2e(ctx);
  });

  // ── Then ────────────────────────────────────────────────────────────────
  scoped(/^the ticket file is in the done area for its milestone$/, (ctx) => {
    requirePassed(ctx, 'in-milestone');
  });

  scoped(/^the move is committed through the same integrity path promotion uses$/, (ctx) => {
    requirePassed(ctx, 'integrity-path');
    requirePassed(ctx, 'one-step');
    // Same path means the same scope discipline promotion has: only this
    // ticket's paths, never the shared checkout's other dirt (BL-506).
    requirePassed(ctx, 'own-paths-only');
  });

  scoped(/^the ticket file is still in the active area$/, (ctx) => {
    requirePassed(ctx, 'refusal-stays');
  });

  scoped(/^nothing is left staged$/, (ctx) => {
    requirePassed(ctx, 'refusal-clean');
  });

  scoped(/^the refusal reason is reported$/, (ctx) => {
    requirePassed(ctx, 'refusal-reported');
  });

  scoped(/^both ticket files are in the done area for their milestone$/, (ctx) => {
    requirePassed(ctx, 'both-closed');
    requirePassed(ctx, 'names-every-id');
  });

  scoped(/^neither ticket file has moved$/, (ctx) => {
    requirePassed(ctx, 'no-partial');
  });

  scoped(/^the refusal names the ticket that blocked it$/, (ctx) => {
    requirePassed(ctx, 'names-blocker');
  });

  scoped(/^no paused ticket has been promoted$/, (ctx) => {
    requirePassed(ctx, 'no-promotion');
  });
}

module.exports = { registerSteps };
