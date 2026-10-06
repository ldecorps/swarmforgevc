'use strict';

// BL-2037: step handlers for "a local seat's phase record carries its
// notes between arrange, act and assert". Drives the REAL CLI
// (swarmforge/scripts/local_seat_phase_cli.bb, backed by
// local_seat_phase_lib.bb's pure transitions) with `spawnSync('bb', ...)`
// against a fixture worktree under `trackedTmpRoot` - never a mocked
// transition table. The outline's <outcome> maps to the real command
// through an explicit known-values table (never passthrough), per the
// ticket's own direction.
//
// The record's on-disk format (`phase: X\nfailed: N\n` then one
// `===\n<note>\n` block per note) is read back here with the same shape
// local_seat_phase_lib.bb's own parse/render use - this is fixture setup
// and assertion, not a second production implementation of the format.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const { trackedTmpRoot } = require('./lib/fixtureReaper');

const FEATURE = "BL-2037 A local seat's phase record carries its notes between arrange, act and assert";

const CLI = path.join(__dirname, '..', '..', '..', 'swarmforge', 'scripts', 'local_seat_phase_cli.bb');

// Known-values table: the outline's own <outcome> text to the real CLI
// invocation that produces it. An outcome not listed here is a defect in
// THIS table, never a passthrough guess.
const OUTCOME_TO_ARGS = {
  'more arrange': (ticket, notesPath) => ['end', ticket, '--to', 'arrange', '--notes', notesPath],
  'ready to act': (ticket, notesPath) => ['end', ticket, '--to', 'act', '--notes', notesPath],
  'no code change': (ticket, notesPath) => ['end', ticket, '--to', 'assert', '--notes', notesPath],
  done: (ticket, notesPath) => ['end', ticket, '--to', 'assert', '--notes', notesPath],
  failed: (ticket, notesPath) => ['fail', ticket, '--notes', notesPath],
  passed: (ticket, notesPath) => ['pass', ticket, '--notes', notesPath],
};

function fixture(ctx) {
  if (!ctx.bl2037) {
    ctx.bl2037 = { dir: trackedTmpRoot('bl2037-local-seat-phase-') };
  }
  return ctx.bl2037;
}

function recordPath(dir, ticket) {
  return path.join(dir, '.swarmforge', 'phase', `${ticket}.md`);
}

function renderRecord(phase, failed, notes) {
  return `phase: ${phase}\nfailed: ${failed}\n${notes.map((n) => `===\n${n}\n`).join('')}`;
}

function writeRecord(dir, ticket, phase, failed, notes) {
  const p = recordPath(dir, ticket);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, renderRecord(phase, failed, notes));
}

function readRecord(dir, ticket) {
  const p = recordPath(dir, ticket);
  const text = fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '';
  const lines = text.split('\n');
  const phaseLine = lines.find((l) => l.startsWith('phase:'));
  const failedLine = lines.find((l) => l.startsWith('failed:'));
  const phase = phaseLine ? phaseLine.slice('phase:'.length).trim() : 'arrange';
  const failed = failedLine ? Number.parseInt(failedLine.slice('failed:'.length).trim(), 10) || 0 : 0;
  const rest = lines.slice(2).join('\n');
  const notes = rest
    .split(/^===$/m)
    .map((s) => s.trim())
    .filter(Boolean);
  return { phase, failed, notes };
}

function runCli(f, args) {
  const r = spawnSync('bb', [CLI, ...args], { encoding: 'utf8', cwd: f.dir });
  return { exitCode: r.status, stdout: r.stdout || '', stderr: r.stderr || '' };
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  // ── Background ──────────────────────────────────────────────────────────
  scoped(/^a fixture worktree for a local-model seat holding a parcel for (BL-\d+)$/, (ctx, ticket) => {
    const f = fixture(ctx);
    f.ticket = ticket;
  });

  // ── a-parcel-starts-in-arrange-01 ────────────────────────────────────────
  scoped(/^the seat asks the phase command for (BL-\d+)'s phase$/, (ctx, ticket) => {
    const f = fixture(ctx);
    f.result = runCli(f, ['show', ticket]);
  });

  scoped(/^the phase is "([a-z]+)" with (\d+) failed asserts$/, (ctx, phase, failed) => {
    const f = fixture(ctx);
    assert.equal(f.result.exitCode, 0, `show failed: ${f.result.stderr}`);
    const parsed = JSON.parse(f.result.stdout);
    assert.equal(parsed.phase, phase);
    assert.equal(parsed.failed, Number(failed));
  });

  // ── ending-a-phase-moves-the-record-02 ───────────────────────────────────
  scoped(/^(BL-\d+)'s phase record is in "([a-z]+)" with (\d+) failed asserts$/, (ctx, ticket, phase, failed) => {
    const f = fixture(ctx);
    f.ticket = ticket;
    f.seedNote = `seed-note-${phase}-${failed}`;
    writeRecord(f.dir, ticket, phase, Number(failed), [f.seedNote]);
  });

  scoped(/^the seat ends that phase with "([^"]+)" and a note$/, (ctx, outcome) => {
    const f = fixture(ctx);
    const build = OUTCOME_TO_ARGS[outcome];
    assert.ok(build, `BL-2037: unknown outcome "${outcome}" - add it to OUTCOME_TO_ARGS`);
    f.note = `note-for-${outcome.replace(/\s+/g, '-')}`;
    const notesPath = path.join(f.dir, 'note.txt');
    fs.writeFileSync(notesPath, f.note);
    f.result = runCli(f, build(f.ticket, notesPath));
  });

  scoped(/^the record is in "([a-z]+)" with (\d+) failed asserts$/, (ctx, phase, failed) => {
    const f = fixture(ctx);
    const rec = readRecord(f.dir, f.ticket);
    assert.equal(rec.phase, phase);
    assert.equal(rec.failed, Number(failed));
  });

  scoped(/^the record stays in "([a-z]+)" and the command prints a split request for (BL-\d+)$/, (ctx, phase, ticket) => {
    const f = fixture(ctx);
    const rec = readRecord(f.dir, f.ticket);
    assert.equal(rec.phase, phase);
    assert.equal(f.result.exitCode, 0, `fail at cap should exit 0: ${f.result.stderr}`);
    assert.equal(f.result.stdout.trim(), `SPLIT_REQUEST ${ticket}`);
  });

  scoped(/^the record's notes end with that note, after every earlier note$/, (ctx) => {
    const f = fixture(ctx);
    const rec = readRecord(f.dir, f.ticket);
    assert.ok(rec.notes.length >= 2, `expected the seed note and the new note, got ${JSON.stringify(rec.notes)}`);
    assert.equal(rec.notes[0], f.seedNote);
    assert.equal(rec.notes[rec.notes.length - 1], f.note);
  });
}

module.exports = { registerSteps };
