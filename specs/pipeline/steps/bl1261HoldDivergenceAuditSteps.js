'use strict';

// BL-1261: audit for divergence between backlog/hold/ and live parcels.
// Drives the REAL hold_divergence_audit_cli.bb against fixture backlogs.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const AUDIT_CLI = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'hold_divergence_audit_cli.bb');
const FEATURE = 'A ticket held in backlog/hold/ while its parcel is still moving is reported';

const KNOWN_POOLS = new Set(['paused', 'active', 'hold', 'done']);

function writeTicket(root, pool, id) {
  const full = path.join(root, 'backlog', pool, `${id}.yaml`);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, [`id: ${id}`, 'title: "fixture"', 'status: todo', ''].join('\n'));
  return full;
}

function writeParcel(root, role, subdir, id, filename) {
  const dir = path.join(root, '.swarmforge', 'handoffs', role, 'inbox', subdir);
  fs.mkdirSync(dir, { recursive: true });
  const full = path.join(dir, filename);
  fs.writeFileSync(full, [`type: git_handoff`, `task: ${id}-test`, ''].join('\n'));
  return full;
}

function writeBatchParcel(root, role, subdir, batchDir, id, filename) {
  const dir = path.join(root, '.swarmforge', 'handoffs', role, 'inbox', subdir, batchDir);
  fs.mkdirSync(dir, { recursive: true });
  const full = path.join(dir, filename);
  fs.writeFileSync(full, [`type: git_handoff`, `task: ${id}-test`, ''].join('\n'));
  return full;
}

function runAudit(root) {
  const result = spawnSync('bb', [AUDIT_CLI, root], {
    encoding: 'utf8',
  });
  return {
    status: result.status,
    output: `${result.stdout || ''}${result.stderr || ''}`,
  };
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  // ── Background ──────────────────────────────────────────────────────
  scoped(/^a backlog with pools active, paused, hold and done$/, (ctx) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bl1261-backlog-'));
    for (const pool of KNOWN_POOLS) {
      fs.mkdirSync(path.join(root, 'backlog', pool), { recursive: true });
    }
    ctx.bl1261 = { root, ticketId: null, parcelRole: null, parcelSubdir: null };
  });

  scoped(/^role mailboxes that may hold parcels$/, (ctx) => {
    // Create mailbox structure for common roles
    for (const role of ['coder', 'cleaner', 'QA']) {
      fs.mkdirSync(path.join(ctx.bl1261.root, '.swarmforge', 'handoffs', role, 'inbox', 'new'), { recursive: true });
      fs.mkdirSync(path.join(ctx.bl1261.root, '.swarmforge', 'handoffs', role, 'inbox', 'in_process'), { recursive: true });
    }
  });

  // ── Givens ──────────────────────────────────────────────────────────
  scoped(/^ticket (BL-\d+) is in backlog\/(active|paused|hold|done)\/$/, (ctx, id, pool) => {
    if (!KNOWN_POOLS.has(pool)) {
      throw new Error(`BL-1261: unrecognized pool "${pool}" — not in KNOWN_VALUES`);
    }
    writeTicket(ctx.bl1261.root, pool, id);
    ctx.bl1261.ticketId = id;
    ctx.bl1261.ticketPool = pool;
  });

  scoped(/^a parcel naming (BL-\d+) is in a role's inbox$/, (ctx, id) => {
    const role = 'coder';
    const subdir = 'new';
    writeParcel(ctx.bl1261.root, role, subdir, id, 'test.handoff');
    ctx.bl1261.parcelRole = role;
    ctx.bl1261.parcelSubdir = subdir;
  });

  scoped(/^a parcel naming (BL-\d+) is inside a batch subdirectory of a role's inbox$/, (ctx, id) => {
    const role = 'cleaner';
    const subdir = 'in_process';
    const batchDir = 'batch_001';
    writeBatchParcel(ctx.bl1261.root, role, subdir, batchDir, id, 'test.handoff');
    ctx.bl1261.parcelRole = role;
    ctx.bl1261.parcelSubdir = `${subdir}/${batchDir}`;
  });

  scoped(/^the ticket has a live parcel$/, (ctx) => {
    // Write a parcel for the ticket that was set up in the "ticket BL-NNNN is in backlog/..." step
    if (!ctx.bl1261.ticketId) {
      throw new Error('BL-1261: ticket ID must be set before "the ticket has a live parcel"');
    }
    const role = 'coder';
    const subdir = 'new';
    writeParcel(ctx.bl1261.root, role, subdir, ctx.bl1261.ticketId, 'test.handoff');
    ctx.bl1261.parcelRole = role;
    ctx.bl1261.parcelSubdir = subdir;
  });

  scoped(/^the ticket has no parcel anywhere$/, (ctx) => {
    // No parcel written - this is the non-divergent state
  });

  scoped(/^one role's inbox cannot be read$/, (ctx) => {
    const role = 'QA';
    const inboxDir = path.join(ctx.bl1261.root, '.swarmforge', 'handoffs', role, 'inbox', 'new');
    fs.chmodSync(inboxDir, 0o000);
    ctx.bl1261.unreadableInbox = inboxDir;
  });

  // ── Whens ───────────────────────────────────────────────────────────
  scoped(/^the audit runs$/, (ctx) => {
    ctx.bl1261.result = runAudit(ctx.bl1261.root);
  });

  // ── Thens ───────────────────────────────────────────────────────────
  scoped(/^the audit reports (BL-\d+) as held-with-a-live-parcel$/, (ctx, id) => {
    assert.match(ctx.bl1261.result.output, new RegExp(`DIVERGENCE[\\s\\S]*${id}`));
  });

  scoped(/^the report names the mailbox the parcel was found in$/, (ctx) => {
    assert.ok(ctx.bl1261.parcelRole, 'parcel role must be set');
    assert.match(ctx.bl1261.result.output, new RegExp(ctx.bl1261.parcelRole));
  });

  scoped(/^the audit reports a divergence$/, (ctx) => {
    assert.match(ctx.bl1261.result.output, /DIVERGENCE/);
    assert.notEqual(ctx.bl1261.result.status, 0, 'audit must exit non-zero on divergence');
  });

  scoped(/^the audit reports no divergence$/, (ctx) => {
    assert.match(ctx.bl1261.result.output, /CLEAN/);
    assert.equal(ctx.bl1261.result.status, 0, 'audit must exit zero when clean');
  });

  scoped(/^ticket (BL-\d+) is still in backlog\/(active|paused|hold|done)\/$/, (ctx, id, pool) => {
    const ticketPath = path.join(ctx.bl1261.root, 'backlog', pool, `${id}.yaml`);
    assert.ok(fs.existsSync(ticketPath), `ticket must still be in backlog/${pool}/`);
  });

  scoped(/^no ticket has moved between pools$/, (ctx) => {
    // Verify the ticket is still in its original pool
    const ticketPath = path.join(ctx.bl1261.root, 'backlog', ctx.bl1261.ticketPool, `${ctx.bl1261.ticketId}.yaml`);
    assert.ok(fs.existsSync(ticketPath), 'ticket must not have moved');
  });

  scoped(/^no parcel has been removed from any mailbox$/, (ctx) => {
    // Verify the parcel still exists (if it was written)
    if (ctx.bl1261.parcelRole) {
      const parcelPath = path.join(
        ctx.bl1261.root,
        '.swarmforge',
        'handoffs',
        ctx.bl1261.parcelRole,
        'inbox',
        ctx.bl1261.parcelSubdir || 'new',
        'test.handoff'
      );
      assert.ok(fs.existsSync(parcelPath), 'parcel must not have been removed');
    }
  });

  scoped(/^the audit reports that role's mailbox as unresolved$/, (ctx) => {
    assert.match(ctx.bl1261.result.output, /UNRESOLVED/);
  });

  scoped(/^the audit does not report the backlog as clean$/, (ctx) => {
    assert.doesNotMatch(ctx.bl1261.result.output, /CLEAN/);
  });
}

module.exports = { registerSteps };
