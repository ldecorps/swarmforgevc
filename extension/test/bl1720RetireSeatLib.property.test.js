'use strict';

// BL-1720's one declared invariant: "After a seat is retired, no roster
// copy the swarm reads - master roles.tsv, sessions.tsv, any worktree's
// roles.tsv - lists it, and no delivery or session repair targets it."
//
// retire-seat-lib/filter-out-seat-rows (retire_seat_lib.bb) is the pure
// core every roster rewrite in retire_seat.sh runs through - exhaustively
// constructed here, never fc-sampled (this session's own precedent for a
// space this small): the retired seat's row is dropped, every OTHER row
// survives byte-identical, line order preserved, regardless of how many
// rows there are or where the retired seat's row sits among them.

const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const path = require('node:path');

const LIB = path.join(__dirname, '..', '..', 'swarmforge', 'scripts', 'retire_seat_lib.bb');

function bbEval(expr) {
  const out = execFileSync('bb', ['-e', `(load-file "${LIB}") ${expr}`], { encoding: 'utf8' });
  return out;
}

function row(role) {
  return [role, 'wtname', `/wt/${role}`, `swarmforge-${role}`, 'Display', 'claude', 'task', 'off', 'forward-only'].join('\t');
}

function filterOutSeatRows(rows, seat, colIdx) {
  const text = rows.join('\n');
  const edn = `(retire-seat-lib/filter-out-seat-rows ${JSON.stringify(text)} ${JSON.stringify(seat)} ${colIdx})`;
  return bbEval(`(println ${edn})`).replace(/\n$/, '');
}

const ROLE_SETS = [
  { name: '1 row, the seat itself', roles: ['coder@2'] },
  { name: '2 rows, seat first', roles: ['coder@2', 'architect'] },
  { name: '2 rows, seat last', roles: ['coder', 'coder@2'] },
  { name: '3 rows, seat in the middle', roles: ['coder', 'coder@2', 'architect'] },
  { name: '3 rows, seat absent', roles: ['coder', 'cleaner', 'architect'] },
];

test('invariant: the retired seat is dropped, every other row survives byte-identical, line order preserved', () => {
  const reach = new Set();
  for (const { name, roles } of ROLE_SETS) {
    reach.add(name);
    const rows = roles.map(row);
    const result = filterOutSeatRows(rows, 'coder@2', 0);
    const resultLines = result === '' ? [] : result.split('\n');

    const expectedLines = rows.filter((r) => !r.startsWith('coder@2\t'));
    assert.deepEqual(
      resultLines,
      expectedLines,
      `expected coder@2's row dropped and every other row unchanged in order for "${name}", got: ${JSON.stringify(resultLines)}`
    );

    for (const line of resultLines) {
      assert.ok(!line.startsWith('coder@2\t'), `expected no surviving row to start with coder@2, got: ${line}`);
    }
  }
  assert.equal(reach.size, ROLE_SETS.length, 'reach floor: expected every constructed role-set to run');
});

test('invariant: the same filter works identically on sessions.tsv shape (seat column 1, not 0)', () => {
  const sessionsRows = ['1\tcoder\tswarmforge-coder\tCoder\tclaude', '2\tcoder@2\tswarmforge-coder@2\tCoder2\tclaude', '3\tarchitect\tswarmforge-architect\tArchitect\tclaude'];
  const result = filterOutSeatRows(sessionsRows, 'coder@2', 1);
  const resultLines = result.split('\n');
  assert.deepEqual(resultLines, [sessionsRows[0], sessionsRows[2]], `expected only coder@2's sessions.tsv row dropped, got: ${JSON.stringify(resultLines)}`);
});
