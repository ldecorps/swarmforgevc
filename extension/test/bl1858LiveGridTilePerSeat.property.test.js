'use strict';

// BL-1858 declared invariants (property authorship rests with the coder,
// first pass - BL-654):
//
//   1. "The live grid has exactly one tile for each seat that roles.tsv or
//      sessions.tsv lists and whose tmux session is live, and none for a
//      live session neither lists."
//   2. "A tile's label, model, held ticket and transcript are its own
//      seat's, never another seat's of the same role."
//
// Each draw builds a fixture target, doubles tmux in-process with a
// per-session has-session answer, and runs the REAL captureLiveScreenPanes.
//
// Generator reach (BL-654): the seat pool is built around one role's
// numbered seats (coder, coder@2, coder@iq3 - each derived from `coder` by
// the `@n` suffix the code strips with seatBaseRole), so every draw that
// lists two of them is a same-role collision candidate by construction.
// Seats are spread across roles.tsv only, sessions.tsv only and both, and
// a floor below asserts the collision and the sessions-only shapes were
// actually reached. Draws keep at least three live listed seats so the
// pack never reads as a mono-router layout (that layout renames the coder
// tile Resident by design, BL-929).
//
// Transcript ownership: each seat's pane text names its own seat, and the
// tile's lines must carry that seat's text.
//
// Runs ONLY via `npm run test:properties` (vitest.properties.config.mjs).
//
// Non-vacuity (run 2026-10-03, restored byte-for-byte after each):
//   break 1 - readRosterSwarmRoles returning roles.tsv rows only (the
//     sessions.tsv union dropped): RED, a sessions-only live seat had no tile.
//   break 2 - liveScreenRoleGroup keying numbered seats by base role for
//     BOTH groups (a seat listed in its base role's own group as well):
//     RED, a seat had two tiles.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const fc = require('fast-check');
const { mkTmpDir, sweepStaleTmpDirs } = require('./helpers/tmpDir');
const { installInProcessTmux } = require('./helpers/fakeTmux');
const { captureLiveScreenPanes, clearResidentPaneLiveCache } = require('../out/bridge/residentPaneLive');

const PREFIX = 'bl1858-prop-';
const POOL = ['coordinator', 'specifier', 'coder', 'coder@2', 'coder@iq3', 'cleaner', 'QA', 'art-director'];

const seatArb = fc.record({
  where: fc.constantFrom('roles', 'sessions', 'both', 'neither'),
  live: fc.boolean(),
});

function displayOf(seat, file) {
  return `Disp-${seat}-${file}`;
}

function buildFixture(root, plan) {
  const stateDir = path.join(root, '.swarmforge');
  fs.mkdirSync(path.join(stateDir, 'launch'), { recursive: true });
  fs.mkdirSync(path.join(root, 'backlog', 'active'), { recursive: true });
  fs.writeFileSync(path.join(stateDir, 'tmux-socket'), '/tmp/fake.sock');
  const rolesLines = [];
  const sessionsLines = [];
  POOL.forEach((seat, i) => {
    const { where } = plan[seat];
    const wt = path.join(root, 'wt', `s${i}`);
    if (where === 'roles' || where === 'both') {
      const inbox = path.join(wt, '.swarmforge', 'handoffs', 'inbox', 'in_process');
      fs.mkdirSync(inbox, { recursive: true });
      const ticket = `BL-${9100 + i}`;
      fs.writeFileSync(path.join(inbox, '00_t.handoff'), `task: ${ticket}-fx\ndequeued_at: 2026-10-01T00:00:00Z\n\nbody\n`);
      fs.writeFileSync(path.join(root, 'backlog', 'active', `${ticket}-fx.yaml`), `id: ${ticket}\ntitle: "t"\n`);
      rolesLines.push(`${seat}\t${seat}\t${wt}\tswarmforge-${seat}\t${displayOf(seat, 'roles')}\tclaude\n`);
    }
    if (where === 'sessions' || where === 'both') {
      sessionsLines.push(`${i + 1}\t${seat}\tswarmforge-${seat}\t${displayOf(seat, 'sessions')}\tclaude\n`);
    }
    fs.writeFileSync(path.join(stateDir, 'launch', `${seat}.claude-settings.json`), JSON.stringify({ model: `model-${seat}` }));
  });
  fs.writeFileSync(path.join(stateDir, 'roles.tsv'), rolesLines.join(''));
  fs.writeFileSync(path.join(stateDir, 'sessions.tsv'), sessionsLines.join(''));
}

function tmuxRules(plan) {
  // Longest session first: `-t swarmforge-coder` is a substring of
  // `-t swarmforge-coder@2`, and the first matching rule wins.
  const bySessionLength = [...POOL].sort((a, b) => b.length - a.length);
  return [
    { subcommand: 'show-window-options', exitCode: 0, stdout: '0\n' },
    { subcommand: 'list-windows', exitCode: 0, stdout: '0\n' },
    ...bySessionLength.map((seat) => ({
      subcommand: 'has-session', argsInclude: `-t swarmforge-${seat}`, exitCode: plan[seat].live ? 0 : 1,
    })),
    ...bySessionLength.map((seat) => ({
      subcommand: 'capture-pane', argsInclude: `swarmforge-${seat}:`, exitCode: 0, stdout: `transcript of ${seat}\n`,
    })),
    { subcommand: 'capture-pane', exitCode: 0, stdout: 'transcript of nobody\n' },
  ];
}

const listed = (p) => p.where !== 'neither';

describe('BL-1858 live grid tile-per-seat invariants', () => {
  beforeAll(() => sweepStaleTmpDirs({ prefix: PREFIX }));

  it('one tile per live listed seat, each carrying only its own seat\'s facts', () => {
    const saved = process.env.SWARMFORGE_CONFIG;
    delete process.env.SWARMFORGE_CONFIG;
    let collisions = 0;
    let sessionsOnly = 0;
    try {
      fc.assert(
        fc.property(fc.tuple(...POOL.map(() => seatArb)), (draw) => {
          const plan = Object.fromEntries(POOL.map((seat, i) => [seat, draw[i]]));
          const expected = POOL.filter((seat) => listed(plan[seat]) && plan[seat].live);
          fc.pre(expected.length >= 3);
          if (['coder', 'coder@2', 'coder@iq3'].filter((s) => expected.includes(s)).length >= 2) collisions += 1;
          if (expected.some((s) => plan[s].where === 'sessions')) sessionsOnly += 1;

          const root = mkTmpDir(`${PREFIX}${process.pid}-`);
          const fake = installInProcessTmux(tmuxRules(plan));
          let panes;
          try {
            buildFixture(root, plan);
            clearResidentPaneLiveCache();
            panes = captureLiveScreenPanes(root);
          } finally {
            fake.restore();
            fs.rmSync(root, { recursive: true, force: true });
          }

          // Invariant 1: exactly the live listed seats, once each.
          assert.deepEqual(panes.map((p) => p.id).sort(), [...expected].sort());

          // Invariant 2: every fact on a tile is its own seat's.
          for (const { id, label, pane } of panes) {
            const where = plan[id].where;
            assert.equal(label, displayOf(id, where === 'sessions' ? 'sessions' : 'roles'), `label of ${id}`);
            assert.equal(pane.modelLabel, `model-${id}`, `model of ${id}`);
            if (where === 'sessions') {
              assert.equal(pane.ticketId, undefined, `a sessions-only seat ${id} borrowed a ticket`);
            } else {
              assert.equal(pane.ticketId, `BL-${9100 + POOL.indexOf(id)}`, `ticket of ${id}`);
            }
            const text = pane.paneText || '';
            assert.ok(text.split('\n').includes(`transcript of ${id}`), `transcript of ${id}: ${text}`);
          }
        }),
        { numRuns: 60 },
      );
    } finally {
      if (saved === undefined) delete process.env.SWARMFORGE_CONFIG;
      else process.env.SWARMFORGE_CONFIG = saved;
    }
    assert.ok(collisions >= 5, `only ${collisions} same-role collision draws`);
    assert.ok(sessionsOnly >= 5, `only ${sessionsOnly} sessions-only live seat draws`);
  }, 120000);
});
