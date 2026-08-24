'use strict';

// BL-1027: mint-time hygiene refuses a dangling acceptance: pointer.
// Drives the REAL specifier_backlog_hygiene_gate.bb against fixture YAMLs.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');

const FEATURE =
  "the specifier's hygiene gate refuses a ticket whose acceptance pointer names a file that is not there";
const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const GATE_BB = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'specifier_backlog_hygiene_gate.bb');

const KNOWN_DECLARATIONS = new Set([
  'names a feature file that is present',
  'names a feature file that is not present',
  'names a parked draft file that is present',
  'is absent altogether',
  'is a block scalar naming no feature file',
  'is a glob-shaped mention of a file not yet named',
  "is an epic tracker's prose standing in for a path",
]);

function ensureState(ctx) {
  if (!ctx.bl1027) {
    ctx.bl1027 = { tmpDir: fs.mkdtempSync(path.join(os.tmpdir(), 'bl1027-hygiene-')), tickets: [] };
  }
  return ctx.bl1027;
}

function cleanup(ctx) {
  const st = ctx.bl1027;
  if (!st || !st.tmpDir) return;
  fs.rmSync(st.tmpDir, { recursive: true, force: true });
  st.tmpDir = null;
}

function baseLines(id) {
  return [`id: ${id}`, 'title: fixture ticket', 'type: feature', 'epic: fixture-epic', 'milestone: M8'];
}

function writeTicket(ctx, id, extraLines) {
  const st = ensureState(ctx);
  const filePath = path.join(st.tmpDir, `${id}.yaml`);
  fs.writeFileSync(filePath, [...baseLines(id), ...extraLines, 'priority: 5', ''].join('\n'));
  st.tickets.push({ id, filePath });
  return filePath;
}

function runGate(paths) {
  return spawnSync('bb', [GATE_BB, ...paths], {
    encoding: 'utf8',
    env: { ...process.env, BACKLOG_HYGIENE_REPO_ROOT: REPO_ROOT },
  });
}

function acceptanceLinesFor(declaration, id) {
  const present = 'specs/features/BL-1027-mint-time-gate-refuses-a-dangling-acceptance-pointer.feature';
  const draft = 'specs/features/BL-235-per-tile-backend-model-switch.cross-backend.feature.draft';
  switch (declaration) {
    case 'names a feature file that is present':
      return [`acceptance: ${present}`];
    case 'names a feature file that is not present':
      return [`acceptance: specs/features/${id}-missing-on-purpose.feature`];
    case 'names a parked draft file that is present':
      return [`acceptance: ${draft}`];
    case 'is absent altogether':
      return [];
    case 'is a block scalar naming no feature file':
      return ['acceptance: |', '  Specifier writes the scenarios later.', '  Happy path only.'];
    case 'is a glob-shaped mention of a file not yet named':
      return [
        'acceptance: |',
        '  Not yet drafted. Once ruled, write specs/features/BL-1027-*.feature.',
      ];
    case "is an epic tracker's prose standing in for a path":
      return ['acceptance:', '  none: "tracker only — see decomposes_into children for acceptance"'];
    default:
      throw new Error(`unknown declaration: ${declaration}`);
  }
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(/^a ticket the specifier is about to hand off$/, (ctx) => {
    ensureState(ctx).ticketId = 'BL-91027';
  });

  // Scenario 03 — more specific than the Outline <declaration> step below.
  scoped(/^the ticket's acceptance declaration is a block scalar hiding a real feature path$/, (ctx) => {
    const st = ensureState(ctx);
    st.ticketId = 'BL-91074';
    st.featurePath = 'specs/features/BL-91074-hidden.feature';
    st.acceptanceLines = ['acceptance: |', `  ${st.featurePath}`, '  (prose)'];
  });

  scoped(/^the ticket's acceptance declaration (.+)$/, (ctx, declaration) => {
    const cell = declaration.trim();
    assert.ok(KNOWN_DECLARATIONS.has(cell), `unknown <declaration>: ${cell}`);
    const st = ensureState(ctx);
    st.declaration = cell;
    st.acceptanceLines = acceptanceLinesFor(cell, st.ticketId);
  });

  scoped(/^the specifier's backlog hygiene gate runs on it$/, (ctx) => {
    const st = ensureState(ctx);
    const filePath = writeTicket(ctx, st.ticketId, st.acceptanceLines || []);
    st.singlePath = filePath;
    const result = runGate([filePath]);
    st.result = { status: result.status, out: `${result.stdout || ''}${result.stderr || ''}` };
  });

  scoped(/^the gate passes it$/, (ctx) => {
    const st = ensureState(ctx);
    try {
      assert.equal(st.result.status, 0, `expected pass, got:\n${st.result.out}`);
      assert.ok(st.result.out.includes('ok'), st.result.out);
      assert.doesNotMatch(st.result.out, /DANGLING-ACCEPTANCE/);
    } finally {
      cleanup(ctx);
    }
  });

  scoped(/^the gate refuses it, naming the ticket and the path$/, (ctx) => {
    const st = ensureState(ctx);
    try {
      assert.notEqual(st.result.status, 0, `expected refuse, got:\n${st.result.out}`);
      assert.match(st.result.out, /DANGLING-ACCEPTANCE/);
      assert.ok(st.result.out.includes(st.ticketId), st.result.out);
      assert.ok(st.result.out.includes(`${st.ticketId}-missing-on-purpose.feature`), st.result.out);
    } finally {
      cleanup(ctx);
    }
  });

  scoped(/^several tickets, one of which names a feature file that is not present$/, (ctx) => {
    const st = ensureState(ctx);
    const present =
      'acceptance: specs/features/BL-1027-mint-time-gate-refuses-a-dangling-acceptance-pointer.feature';
    st.goodA = writeTicket(ctx, 'BL-91071', [present]);
    st.bad = writeTicket(ctx, 'BL-91072', [
      'acceptance: specs/features/BL-91072-missing-on-purpose.feature',
    ]);
    st.goodB = writeTicket(ctx, 'BL-91073', [present]);
  });

  scoped(/^the specifier's backlog hygiene gate runs on all of them$/, (ctx) => {
    const st = ensureState(ctx);
    const paths = st.tickets.map((t) => t.filePath);
    const result = runGate(paths);
    st.result = { status: result.status, out: `${result.stdout || ''}${result.stderr || ''}` };
  });

  scoped(/^the gate refuses, naming the offending ticket$/, (ctx) => {
    const st = ensureState(ctx);
    assert.notEqual(st.result.status, 0, st.result.out);
    assert.match(st.result.out, /DANGLING-ACCEPTANCE BL-91072/);
  });

  scoped(/^the tickets that are clean are not named as offenders$/, (ctx) => {
    const st = ensureState(ctx);
    try {
      assert.doesNotMatch(st.result.out, /DANGLING-ACCEPTANCE BL-91071/);
      assert.doesNotMatch(st.result.out, /DANGLING-ACCEPTANCE BL-91073/);
    } finally {
      cleanup(ctx);
    }
  });

  scoped(/^the gate refuses it as an unreadable acceptance declaration$/, (ctx) => {
    const st = ensureState(ctx);
    try {
      assert.notEqual(st.result.status, 0, st.result.out);
      assert.match(st.result.out, /UNREADABLE-ACCEPTANCE/);
      assert.ok(st.result.out.includes(st.ticketId), st.result.out);
      assert.ok(st.result.out.includes(st.featurePath), st.result.out);
    } finally {
      cleanup(ctx);
    }
  });
}

module.exports = { registerSteps };
