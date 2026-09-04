'use strict';

// BL-1374: a sync merge is not credited with its passengers.
// Drives the REAL test_bl1374_sync_merge_passengers.sh, which drives the REAL
// land_step_lib.bb over real git fixtures - and, for the regression the ticket
// asks for, over the live history that produced the report. Calling the
// attribution helper in isolation would report green for a narrowing that is
// right and not reached by the decision that matters.
//
// The fixture's own shape is worth knowing when reading these: a merge that
// merely carries a passenger through is TREESAME to a parent on that path and
// git's walk already elides it, so a naive fixture shows no defect at all.
// The shape that bites is the clean auto-merge.

const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const FEATURE = 'A sync merge is not credited with its passengers';
const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const FIXTURE = path.join(
  REPO_ROOT,
  'swarmforge',
  'scripts',
  'test',
  'test_bl1374_sync_merge_passengers.sh'
);

function runFixture(ctx) {
  if (ctx.bl1374?.out) return ctx.bl1374.out;
  const res = spawnSync('bash', [FIXTURE], { encoding: 'utf8', timeout: 900000 });
  const out = `${res.stdout || ''}${res.stderr || ''}`;
  ctx.bl1374 = { ...(ctx.bl1374 || {}), out, status: res.status };
  if (res.status !== 0) {
    throw new Error(`test_bl1374_sync_merge_passengers.sh failed (${res.status}):\n${out}`);
  }
  return out;
}

function requirePass(ctx, marker) {
  const out = runFixture(ctx);
  assert.ok(out.includes(`ok   ${marker}`), `missing "ok   ${marker}" in:\n${out}`);
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  // ── Background ──────────────────────────────────────────────────────────
  scoped(/^a ticket's branch carries a sync merge of main$/, (ctx) => {
    ctx.bl1374 = ctx.bl1374 || {};
    ctx.bl1374.case = 'passenger';
  });

  // ── Given ───────────────────────────────────────────────────────────────
  scoped(/^the sync merge's subject names the ticket$/, (ctx) => {
    // The premise the whole defect turns on, and it is measured rather than
    // asserted in prose: the path-scoped walk really does reach this merge.
    requirePass(ctx, '01 premise: the path-scoped walk reaches the sync merge');
  });

  scoped(/^the sync carried another ticket's unlanded file$/, (ctx) => {
    ctx.bl1374.case = 'passenger';
    // ...and the merge wrote no line of its own, which is what makes crediting
    // it wrong rather than merely unlucky.
    requirePass(ctx, '01 premise: and the merge authored no line anywhere');
  });

  scoped(/^the ticket's own commits changed a file$/, (ctx) => {
    ctx.bl1374.case = 'own';
  });

  scoped(/^the ticket's own commits changed a file shared with an unlanded sibling$/, (ctx) => {
    ctx.bl1374.case = 'entangled';
  });

  // ── When ────────────────────────────────────────────────────────────────
  scoped(/^the replay computes the ticket's own paths$/, (ctx) => {
    runFixture(ctx);
  });

  scoped(/^the land step decides$/, (ctx) => {
    runFixture(ctx);
  });

  // ── Then ────────────────────────────────────────────────────────────────
  scoped(/^that other ticket's file is not among them$/, (ctx) => {
    requirePass(ctx, "01: the passenger file is not this ticket's own path");
    // Not being among them is only half the remedy: the land must also stop
    // being refused over it.
    requirePass(ctx, '01: so the land is not refused');
  });

  scoped(/^that file is among them$/, (ctx) => {
    requirePass(ctx, "02: and this ticket's own work still replays");
  });

  scoped(/^the land is refused naming that sibling$/, (ctx) => {
    requirePass(ctx, '03: the land is refused');
    // The SHARED-PATH refusal specifically: a fix that refused everything, or
    // that excluded every path and refused for that reason instead, would
    // satisfy a looser assertion while breaking the ticket.
    requirePass(ctx, '03: as the shared-path refusal, not some other one');
    requirePass(ctx, '03: naming the sibling');
    requirePass(ctx, '03: and naming the path');
  });

  scoped(/^that other ticket is still reported as unlanded$/, (ctx) => {
    requirePass(ctx, "04: the first passenger's ticket is still reported as unlanded");
    requirePass(ctx, "04: and the second passenger's");
    requirePass(ctx, '04: detection itself read cleanly');
  });
}

module.exports = { registerSteps };
