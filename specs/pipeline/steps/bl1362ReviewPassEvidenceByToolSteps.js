'use strict';

// BL-1362: a review pass records its evidence by tool.
//
// Drives the REAL recorder and the REAL review-forward evidence gate by running
// this ticket's own vitest cases and reading the per-case verdicts back. The
// claim scenario 04 makes is about the GATE's verdict on a commit this tool
// produced, so only the gate can make it - and the same run proves the gate was
// not weakened, by checking the bare received hash is still refused.
//
// One run serves every scenario; verdicts are read by test name.

const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const FEATURE = 'A review pass records its evidence by tool';
const EXTENSION_DIR = path.join(__dirname, '..', '..', '..', 'extension');

// Explicit KNOWN_VALUES: a scenario naming a case this handler does not know
// throws rather than passing through unchecked.
const CASES = {
  none: 'a clean sweep is written, committed alone, and its commit reported',
  inventory: 'a two-item inventory is written with both items, and committed the same way',
  'no-verdict': 'no verdict is REFUSED, and nothing is written or committed',
  'same-day': 'a second pass the same day never overwrites the first',
  'every-role': 'every reviewing role reaches the same convention',
  gate: 'the recorded commit passes the gate, while the bare received hash is still refused',
};

// Scenario Outline's <role> column. Validated against the roles the
// every-role case actually exercises - an example row naming a role that case
// does not record for is a throw, never a silent pass.
const OUTLINE_ROLES = ['cleaner', 'architect', 'hardender', 'documenter', 'QA'];

function runSuite(ctx) {
  if (ctx.bl1362?.out) return ctx.bl1362.out;
  const res = spawnSync(
    'npx',
    [
      'vitest',
      'run',
      '--reporter=verbose',
      'test/recordReviewEvidenceCli.test.js',
      'test/recordReviewEvidenceGate.test.js',
      'test/reviewEvidenceRecord.test.js',
    ],
    { cwd: EXTENSION_DIR, encoding: 'utf8', timeout: 900000 }
  );
  const out = `${res.stdout || ''}${res.stderr || ''}`;
  ctx.bl1362 = { ...(ctx.bl1362 || {}), out, status: res.status };
  if (res.status !== 0) {
    throw new Error(`the BL-1362 recorder suite failed (${res.status}):\n${out}`);
  }
  return out;
}

const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// The verbose reporter's passing line for this exact case must be present.
// Asserting only "no failing line" would go green for a case that never ran,
// which is the never-reached shape these handlers exist to rule out.
function requirePassed(ctx, caseKey) {
  const name = CASES[caseKey];
  assert.ok(name, `unknown case: ${caseKey}`);
  const out = runSuite(ctx);
  assert.match(
    out,
    new RegExp(`✓ test/\\S+ > ${escape(name)}`),
    `"${name}" did not pass, in:\n${out}`
  );
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  // ── Background ──────────────────────────────────────────────────────────
  scoped(/^a reviewing role has finished its pass on a ticket$/, (ctx) => {
    ctx.bl1362 = ctx.bl1362 || {};
  });

  // ── Given ───────────────────────────────────────────────────────────────
  scoped(/^the pass found no defect$/, (ctx) => {
    ctx.bl1362.case = 'none';
  });

  scoped(/^the pass found two defects$/, (ctx) => {
    ctx.bl1362.case = 'inventory';
  });

  scoped(/^the pass supplied no verdict$/, (ctx) => {
    ctx.bl1362.case = 'no-verdict';
  });

  scoped(/^the reviewing role is (.+)$/, (ctx, role) => {
    assert.ok(OUTLINE_ROLES.includes(role), `unknown <role> example: ${role}`);
    ctx.bl1362.case = 'every-role';
    ctx.bl1362.role = role;
  });

  // ── When ────────────────────────────────────────────────────────────────
  scoped(/^the role records its evidence$/, (ctx) => {
    assert.ok(ctx.bl1362.case, 'the scenario set no case before recording');
    runSuite(ctx);
  });

  scoped(/^the role forwards the reported commit$/, (ctx) => {
    ctx.bl1362.case = 'gate';
    runSuite(ctx);
  });

  // ── Then ────────────────────────────────────────────────────────────────
  scoped(/^the evidence file records NONE$/, (ctx) => {
    requirePassed(ctx, 'none');
  });

  scoped(/^the evidence file is committed$/, (ctx) => {
    // Which case is asserted was fixed by the Given, so "is committed" is
    // never checked against the wrong verdict.
    requirePassed(ctx, ctx.bl1362.case);
  });

  scoped(/^the commit is reported for the role to forward$/, (ctx) => {
    requirePassed(ctx, 'none');
  });

  scoped(/^the evidence file lists both items$/, (ctx) => {
    requirePassed(ctx, 'inventory');
  });

  scoped(/^each item carries its blamed role and remediation pointer$/, (ctx) => {
    requirePassed(ctx, 'inventory');
  });

  scoped(/^the recording is refused naming what a verdict must be$/, (ctx) => {
    requirePassed(ctx, 'no-verdict');
  });

  scoped(/^no evidence file is written$/, (ctx) => {
    requirePassed(ctx, 'no-verdict');
  });

  scoped(/^the review-forward evidence gate does not refuse the forward$/, (ctx) => {
    requirePassed(ctx, 'gate');
  });

  scoped(/^the evidence file is named for the ticket the role and the date$/, (ctx) => {
    requirePassed(ctx, 'every-role');
    // The same-day collision rule is part of "named for the ticket, the role
    // and the date": without it the second pass would silently take the first
    // one's name.
    requirePassed(ctx, 'same-day');
  });
}

module.exports = { registerSteps };
