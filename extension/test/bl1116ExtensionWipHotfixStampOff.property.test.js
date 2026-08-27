'use strict';

// BL-1116 declared invariants (coder first authorship — architect bounce D1):
//
// 1. Stamp-off never reimplements — confirm/refute the five landed commits only.
// 2. Green tests never write certified/waived into the hotfix ledger.
//
// Non-vacuity: break 1 — compare a tip path against empty → RED; break 2 —
// assert state === 'certified' → RED while pending. Restored.
//
// Runs via `npm run test:properties` and standalone node.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

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
  const row = ledgerRow(key.commit);
  assert.match(row, /stamp_ticket: BL-1116/);
  assert.match(row, /state: pending/);
  assert.match(row, /human_decision: null/);
  assert.doesNotMatch(row, /state: certified/);
  assert.doesNotMatch(row, /state: waived/);
}

console.log('bl1116_extension_wip_stamp_off_property: ALL PROPERTIES HOLD');
