'use strict';

// BL-1732/BL-654 declared invariant 2 (the submit half): "Only the
// principal can file an intake or change the shared vocabulary: the
// form's write routes refuse a request without the bridge's device and
// control tokens...". Drives the REAL POST /intake-form/submit route
// against a real startBridge instance with randomly-shaped draft
// payloads and NO auth headers - every one must be refused, and none may
// ever write an INTAKE file. (The topic-ignores-everyone-else half is a
// pure decision with no generator surface of its own - covered by
// bl1732IntakeTopicFormSteps.js's own acceptance scenario, not restated
// here as a second property.)

const assert = require('node:assert/strict');
const fc = require('fast-check');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { mkTmpDir } = require('./helpers/tmpDir');
const { copySeededRepoInto } = require('./helpers/sharedRepoFixture');
const { copyLiveScriptClosureInto } = require('./helpers/pinnedRepoFixture');
const { SUBPROCESS_HEAVY_TIMEOUT_MS } = require('./helpers/subprocessHeavyTimeout');

const { startBridge } = require('../out/bridge/bridgeServer');
const { createMockCursorBridgeAgentSession } = require('../out/bridge/cursorBridgeAgentSession');

const TOKEN = 'bl1732-invariant-token';
const NOW = 1_700_000_000_000;

function mkFixture() {
  const root = mkTmpDir('bl1732-auth-invariant-');
  copySeededRepoInto(root);
  copyLiveScriptClosureInto(path.join(root, 'swarmforge', 'scripts'), ['commit_integrity_cli.bb']);
  execFileSync('git', ['add', '-A'], { cwd: root });
  execFileSync('git', ['commit', '-q', '-m', 'seed script closure'], { cwd: root });
  return root;
}

function listIntakeFiles(root) {
  const dir = path.join(root, 'backlog');
  if (!fs.existsSync(dir)) {
    return [];
  }
  return fs.readdirSync(dir).filter((name) => name.startsWith('INTAKE-'));
}

const DRAFT_ARB = fc.record({
  actor: fc.string({ minLength: 1, maxLength: 20 }).filter((s) => s.trim().length > 0),
  action: fc.string({ minLength: 1, maxLength: 20 }).filter((s) => s.trim().length > 0),
  goal: fc.string({ minLength: 1, maxLength: 20 }).filter((s) => s.trim().length > 0),
  scenarios: fc.string({ minLength: 1, maxLength: 40 }).filter((s) => s.trim().length > 0),
});

test(
  'BL-1732/BL-654 invariant: a submit with no device/control token is always refused and never writes an INTAKE file',
  async () => {
    await fc.assert(
      fc.asyncProperty(DRAFT_ARB, async (draft) => {
        const root = mkFixture();
        const handle = await startBridge(root, path.join(root, 'runs.jsonl'), TOKEN, {
          nowMs: NOW,
          letsTalk: { agentSession: createMockCursorBridgeAgentSession(root) },
        });
        try {
          const res = await fetch(`http://127.0.0.1:${handle.port}/intake-form/submit`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(draft),
          });
          assert.equal(res.status, 401, `expected 401 with no auth, got ${res.status}`);
          assert.deepEqual(listIntakeFiles(root), []);
        } finally {
          handle.stop();
        }
      }),
      { numRuns: 8 }
    );
  },
  SUBPROCESS_HEAVY_TIMEOUT_MS
);
