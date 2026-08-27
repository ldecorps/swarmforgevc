'use strict';

// BL-234: step handlers for the readBacklogFolders-status-authoritative
// feature. Drives the real, testable backlog-parsing module (extension/out/
// panel/backlogReader.js), mirroring backlogSteps.js's own pattern - no VS
// Code API, no webview. Compiled output only: run `npm run compile` in
// extension/ first.
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { readBacklogFolders } = require(path.join(
  __dirname, '..', '..', '..', 'extension', 'out', 'panel', 'backlogReader.js'
));

let ticketSeq = 0;
function nextId() {
  ticketSeq += 1;
  return `BL-STATUS-${ticketSeq}`;
}

function writeTicketFile(targetPath, folder, filename, content) {
  const dir = path.join(targetPath, 'backlog', folder);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, filename), content, 'utf8');
}

function registerSteps(registry) {
  registry.define(/^a backlog with active\/, paused\/, and done\/ folders read by readBacklogFolders$/, (ctx) => {
    ctx.targetPath = fs.mkdtempSync(path.join(os.tmpdir(), 'aps-backlog-status-'));
  });

  // ── no-status-field-01 (Scenario Outline) ────────────────────────────
  registry.define(/^a ticket in the "([^"]+)" folder with a valid id and title but no status field$/, (ctx, folder) => {
    const id = nextId();
    ctx.ticketId = id;
    ctx.folder = folder;
    writeTicketFile(ctx.targetPath, folder, `${id}.yaml`, `id: ${id}\ntitle: "no status field"\n`);
  });

  // ── unrecognized-status-02 (Scenario Outline) ────────────────────────
  registry.define(/^a ticket in the "([^"]+)" folder whose status is "([^"]+)"$/, (ctx, folder, status) => {
    const id = nextId();
    ctx.ticketId = id;
    ctx.folder = folder;
    writeTicketFile(ctx.targetPath, folder, `${id}.yaml`, `id: ${id}\ntitle: "status ${status}"\nstatus: ${status}\n`);
  });

  registry.define(/^readBacklogFolders reads the backlog$/, (ctx) => {
    ctx.folders = readBacklogFolders(ctx.targetPath);
  });

  registry.define(/^the ticket appears in the "([^"]+)" bucket$/, (ctx, folder) => {
    const ids = (ctx.folders[folder] || []).map((i) => i.id);
    if (!ids.includes(ctx.ticketId)) {
      throw new Error(`expected "${ctx.ticketId}" in the "${folder}" bucket, found: ${JSON.stringify(ids)}`);
    }
  });

  // ── folder-over-stale-status-03 ──────────────────────────────────────
  registry.define(/^a ticket in the paused folder whose status is "([^"]+)"$/, (ctx, status) => {
    const id = nextId();
    ctx.ticketId = id;
    writeTicketFile(ctx.targetPath, 'paused', `${id}.yaml`, `id: ${id}\ntitle: "stale status ${status}"\nstatus: ${status}\n`);
  });

  registry.define(/^the ticket appears in the paused bucket, not the active bucket$/, (ctx) => {
    const pausedIds = (ctx.folders.paused || []).map((i) => i.id);
    const activeIds = (ctx.folders.active || []).map((i) => i.id);
    if (!pausedIds.includes(ctx.ticketId)) {
      throw new Error(`expected "${ctx.ticketId}" in the paused bucket, found: ${JSON.stringify(pausedIds)}`);
    }
    if (activeIds.includes(ctx.ticketId)) {
      throw new Error(`expected "${ctx.ticketId}" NOT in the active bucket, but it was there`);
    }
  });

  // ── unparseable-skipped-04 (Scenario Outline) ────────────────────────
  registry.define(/^a file in the paused folder missing its "([^"]+)"$/, (ctx, required) => {
    ctx.folder = 'paused';
    const lines = [];
    if (required !== 'id') {
      lines.push('id: BL-STATUS-MISSING');
    }
    if (required !== 'title') {
      lines.push('title: "missing a required field"');
    }
    lines.push('status: todo');
    writeTicketFile(ctx.targetPath, 'paused', 'incomplete.yaml', lines.join('\n') + '\n');
  });

  registry.define(/^that file is not reported in any bucket$/, (ctx) => {
    const allIds = Object.values(ctx.folders).flatMap((items) => items.map((i) => i.id));
    if (allIds.includes('BL-STATUS-MISSING')) {
      throw new Error('expected the file missing a required field to be reported in no bucket, but it was');
    }
    if ((ctx.folders.paused || []).length !== 0) {
      throw new Error(`expected the paused bucket to be empty (the only file has a missing field), got: ${JSON.stringify(ctx.folders.paused)}`);
    }
  });

  // ── none-dropped-05 ───────────────────────────────────────────────────
  registry.define(/^a paused folder of tickets with absent, unrecognized, and valid status values$/, (ctx) => {
    const absentId = nextId();
    const unrecognizedId = nextId();
    const validId = nextId();
    ctx.expectedPausedIds = [absentId, unrecognizedId, validId];
    writeTicketFile(ctx.targetPath, 'paused', `${absentId}.yaml`, `id: ${absentId}\ntitle: "absent status"\n`);
    writeTicketFile(ctx.targetPath, 'paused', `${unrecognizedId}.yaml`, `id: ${unrecognizedId}\ntitle: "unrecognized status"\nstatus: blocked\n`);
    writeTicketFile(ctx.targetPath, 'paused', `${validId}.yaml`, `id: ${validId}\ntitle: "valid status"\nstatus: todo\n`);
  });

  registry.define(/^the paused bucket contains every parseable ticket in the folder$/, (ctx) => {
    const ids = (ctx.folders.paused || []).map((i) => i.id).sort();
    const expected = [...ctx.expectedPausedIds].sort();
    if (JSON.stringify(ids) !== JSON.stringify(expected)) {
      throw new Error(`expected the paused bucket to contain exactly ${JSON.stringify(expected)}, got: ${JSON.stringify(ids)}`);
    }
  });
}

module.exports = { registerSteps };
