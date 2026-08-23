'use strict';

// BL-1045: how long a ticket has been in backlog/hold/, derived from GIT
// rather than file mtime.
//
// mtime is rewritten by clones, worktree operations and checkouts, and this
// repo has already been bitten by trusting it - a ticket parked twelve days
// ago would read as parked today after any of them. The commit that ADDED the
// file at its hold/ path is the fact that does not move.

const assert = require('node:assert/strict');

const {
  heldSinceGitArgs,
  parseHeldSinceMs,
  readHeldSinceMsFor,
} = require('../out/concierge/heldSince');

test('the git query asks for the commit that added the file at its hold path', () => {
  const args = heldSinceGitArgs('BL-844-thing.yaml');
  assert.deepEqual(args, [
    'log',
    '--diff-filter=A',
    '--format=%at',
    '-1',
    '--',
    'backlog/hold/BL-844-thing.yaml',
  ]);
});

test('a filename with no path traversal is required, so a link cannot escape backlog/hold', () => {
  for (const bad of ['../secrets.yaml', 'a/b.yaml', '', '   ']) {
    assert.throws(() => heldSinceGitArgs(bad), /filename/, `"${bad}" must be refused`);
  }
});

test('git epoch seconds become epoch milliseconds', () => {
  assert.equal(parseHeldSinceMs('1755820800\n'), 1755820800000);
});

test('empty, blank or unparseable git output is undefined, never a guessed instant', () => {
  for (const raw of ['', '\n', 'not a number', '  ', '-1']) {
    assert.equal(parseHeldSinceMs(raw), undefined, `${JSON.stringify(raw)} must not resolve to a date`);
  }
});

test('the newest of several add commits is taken, since a re-park is the current hold', () => {
  assert.equal(parseHeldSinceMs('1755820800\n1600000000\n'), 1755820800000);
});

test('a held ticket resolves through the injected git runner, never a real subprocess here', () => {
  const seen = [];
  const ms = readHeldSinceMsFor('BL-844-thing.yaml', (args) => {
    seen.push(args);
    return '1755820800\n';
  });
  assert.equal(ms, 1755820800000);
  assert.deepEqual(seen, [heldSinceGitArgs('BL-844-thing.yaml')]);
});

test('a git runner that throws leaves the age unknown rather than failing the board', () => {
  assert.equal(
    readHeldSinceMsFor('BL-844-thing.yaml', () => {
      throw new Error('not a git repository');
    }),
    undefined
  );
});

test('a refused filename leaves the age unknown and never reaches git', () => {
  let called = false;
  assert.equal(
    readHeldSinceMsFor('../escape.yaml', () => {
      called = true;
      return '1';
    }),
    undefined
  );
  assert.equal(called, false);
});
