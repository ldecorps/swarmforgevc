'use strict';

// BL-1944 (BL-544 stamp-off): step handlers for "the specifier keeps every
// new backlog item epic-bound and every new epic milestone-bound". Drives
// the REAL swarmforge/scripts/specifier_backlog_hygiene_gate.bb against a
// fixture ticket file under a tracked mkdtemp root, with
// BACKLOG_HYGIENE_ROOT/BACKLOG_HYGIENE_PUBLISHED_ROOT seams (the bl1105
// pattern) pointed at empty fixture dirs so the gate never reads this
// checkout's own backlog or git (BL-1390).

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const { trackedTmpRoot } = require('./lib/fixtureReaper');

const FEATURE = 'the specifier keeps every new backlog item epic-bound and every new epic milestone-bound';

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const GATE_BB = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'specifier_backlog_hygiene_gate.bb');

function mkdirp(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function runGate(ticketPath, hygieneRoot, publishedRoot) {
  return spawnSync('bb', [GATE_BB, ticketPath], {
    encoding: 'utf8',
    timeout: 60000,
    env: {
      ...process.env,
      BACKLOG_HYGIENE_ROOT: hygieneRoot,
      BACKLOG_HYGIENE_PUBLISHED_ROOT: publishedRoot,
    },
  });
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  // ── Background ───────────────────────────────────────────────────────
  scoped(/^the specifier is writing a paused backlog item into backlog\/paused\/$/, (ctx) => {
    const root = trackedTmpRoot('sfvc-bl544-hygiene-');
    const hygieneRoot = path.join(root, 'backlog');
    const publishedRoot = path.join(root, 'published-backlog');
    mkdirp(path.join(hygieneRoot, 'paused'));
    mkdirp(publishedRoot);
    ctx.bl544 = { root, hygieneRoot, publishedRoot };
  });

  // ── Scenario 01 ──────────────────────────────────────────────────────
  scoped(/^the specifier is speccing a non-epic backlog item$/, (ctx) => {
    ctx.bl544.id = 'BL-9501';
    ctx.bl544.ticketPath = path.join(ctx.bl544.hygieneRoot, 'paused', `${ctx.bl544.id}.yaml`);
  });

  scoped(/^the resulting YAML has no epic field$/, (ctx) => {
    fs.writeFileSync(ctx.bl544.ticketPath, `id: ${ctx.bl544.id}\ntitle: "fixture slice"\nstatus: todo\n`);
  });

  scoped(/^the specifier assigns a non-empty epic to the item$/, (ctx) => {
    const text = fs.readFileSync(ctx.bl544.ticketPath, 'utf8');
    fs.writeFileSync(ctx.bl544.ticketPath, `${text}epic: fixture-epic\n`);
  });

  // ── Scenario 02 ──────────────────────────────────────────────────────
  scoped(/^the specifier is creating a type epic tracker$/, (ctx) => {
    ctx.bl544.id = 'BL-9502';
    ctx.bl544.ticketPath = path.join(ctx.bl544.hygieneRoot, 'paused', `${ctx.bl544.id}.yaml`);
  });

  scoped(/^the resulting YAML has no milestone field$/, (ctx) => {
    // epic: is self-declared here (type: epic's own distinct violation,
    // not this scenario's concern) so the gate's only remaining
    // complaint is the missing milestone.
    fs.writeFileSync(
      ctx.bl544.ticketPath,
      `id: ${ctx.bl544.id}\ntitle: "fixture epic tracker"\nstatus: todo\ntype: epic\nepic: ${ctx.bl544.id}\n`
    );
  });

  scoped(/^the specifier sets a non-empty milestone on the epic tracker$/, (ctx) => {
    const text = fs.readFileSync(ctx.bl544.ticketPath, 'utf8');
    fs.writeFileSync(ctx.bl544.ticketPath, `${text}milestone: M9\n`);
  });

  // ── shared When/Then ─────────────────────────────────────────────────
  scoped(/^the specifier runs the backlog hygiene gate on that item$/, (ctx) => {
    ctx.bl544.result = runGate(ctx.bl544.ticketPath, ctx.bl544.hygieneRoot, ctx.bl544.publishedRoot);
  });

  scoped(/^runs the backlog hygiene gate again$/, (ctx) => {
    ctx.bl544.result = runGate(ctx.bl544.ticketPath, ctx.bl544.hygieneRoot, ctx.bl544.publishedRoot);
  });

  scoped(/^the gate fails and names the missing epic$/, (ctx) => {
    const { status, stdout } = ctx.bl544.result;
    assert.notEqual(status, 0, `expected the gate to fail, got:\n${stdout}`);
    assert.match(stdout, /MISSING-EPIC/, `expected a MISSING-EPIC line, got:\n${stdout}`);
    assert.match(stdout, new RegExp(ctx.bl544.id), `expected the violation to name ${ctx.bl544.id}, got:\n${stdout}`);
  });

  scoped(/^the gate fails and names the missing milestone$/, (ctx) => {
    const { status, stdout } = ctx.bl544.result;
    assert.notEqual(status, 0, `expected the gate to fail, got:\n${stdout}`);
    assert.match(stdout, /MISSING-MILESTONE/, `expected a MISSING-MILESTONE line, got:\n${stdout}`);
    assert.match(stdout, new RegExp(ctx.bl544.id), `expected the violation to name ${ctx.bl544.id}, got:\n${stdout}`);
  });

  scoped(/^the gate passes$/, (ctx) => {
    const { status, stdout } = ctx.bl544.result;
    assert.equal(status, 0, `expected the gate to pass, got:\n${stdout}`);
  });
}

module.exports = { registerSteps };
