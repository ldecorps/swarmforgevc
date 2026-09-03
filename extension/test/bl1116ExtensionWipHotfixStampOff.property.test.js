'use strict';

// BL-1116 declared invariants (coder first authorship — architect bounce D1):
//
// 1. Stamp-off never reimplements — confirm/refute the five landed commits only.
// 2. Green tests never write certified/waived into the hotfix ledger.
//
// Non-vacuity: break 1 — compare a tip path against empty → RED; break 2 —
// assert state === 'certified' → RED while pending. Restored.
//
// Runs ONLY via `npm run test:properties`. BL-1356 wrapped these assertions
// in a `test()`: at module level vitest reported "No test suite found in
// file" and counted the file as a failing suite, which is why it needed a
// standing-allowlist row on top of the ledger pin. Nothing runs it under bare
// node - grep found no caller.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { assertRunWritesNoDecision } = require('./helpers/stampOff');

const REPO = path.join(__dirname, '..', '..');
const LEDGER = path.join(REPO, 'backlog', 'hotfix-ledger.yaml');

const KEYS = [
  {
    commit: 'b81334b107',
    path: 'extension/src/bridge/bridgeAuth.ts',
    mustInclude: 'resident-pane',
  },
  {
    commit: '4d5375fdad',
    path: 'extension/src/concierge/approvalAskReconcile.ts',
    mustInclude: 'approvalAskRecordedOnLiveTopic',
  },
  {
    commit: 'ae983877c4',
    path: 'extension/src/bridge/cursorBridgeAgentSession.ts',
    mustInclude: 'createLiveFrontDeskBridgeSession',
  },
  {
    commit: 'd6214efe6f',
    path: 'extension/src/swarm/backendSwitch.ts',
    mustInclude: 'prefersLaunchOverClaudeSettings',
  },
  {
    commit: 'f88913a3df',
    path: 'extension/src/swarm/acpHostClient.ts',
    mustInclude: 'initialClientState',
  },
];

function gitShow(rev, file) {
  return execFileSync('git', ['show', `${rev}:${file}`], {
    cwd: REPO,
    encoding: 'utf8',
  });
}

function ledgerRow(commit) {
  const ledger = fs.readFileSync(LEDGER, 'utf8');
  const parts = ledger.split(`- commit: ${commit}`);
  assert.ok(parts.length >= 2, `missing ledger row ${commit}`);
  return parts[1].split('- commit:')[0];
}

// BL-1356: this file's assertions ran at MODULE level, so vitest reported
// "No test suite found in file" and counted it as a failing suite - a second
// reason it needed a standing-allowlist row, independent of the ledger pin.
// Wrapping them in a `test()` costs nothing and lets the row come out.
test('BL-1116/BL-654: the stamp-off reviews five landed commits and writes no decision', () => {
  for (const key of KEYS) {
    const tipSrc = gitShow(key.commit, key.path);
    assert.ok(
      tipSrc.includes(key.mustInclude),
      `tip ${key.commit} ${key.path} must contain ${key.mustInclude}`
    );
    const headSrc = fs.readFileSync(path.join(REPO, key.path), 'utf8');
    assert.ok(
      headSrc.includes(key.mustInclude),
      `HEAD ${key.path} must still carry tip ${key.commit} surface`
    );
    // Tip reachability (confirm, do not invent a sixth commit).
    assert.equal(
      execFileSync('git', ['cat-file', '-t', key.commit], { cwd: REPO, encoding: 'utf8' }).trim(),
      'commit'
    );
    // The row's IDENTITY is asserted; its current state is not.
    //
    // BL-1356: `state: pending` was pinned as a literal, so this went red the
    // moment the row advanced through its own workflow - and because the property
    // lane's commit guard refuses every commit repo-wide on a non-allowlisted
    // red, that jammed the whole swarm. What the invariant actually forbids is a
    // decision written WITHOUT a human, so the question is now what this run
    // wrote, with the row's prior value as the expected one.
    assert.match(ledgerRow(key.commit), /stamp_ticket: BL-1116/);
    assertRunWritesNoDecision(key.commit, () => {
      assert.equal(typeof gitShow(key.commit, key.path), 'string');
    });
  }
});

