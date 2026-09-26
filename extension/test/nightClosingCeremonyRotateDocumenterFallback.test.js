'use strict';

// Hotfix 2026-09-16 (rewritten BL-1753, 2026-09-26): rotateDocumenter's real
// IO wiring (buildRealDeps' own function) had ZERO test coverage before the
// hotfix - every existing test in this directory injects a FAKE
// rotateDocumenter to exercise the pure state machine, never the real one.
// That gap is exactly how the bug shipped: live 2026-09-15, `rotate_to_role.sh
// documenter` was refused (the resident held a real undrained parcel,
// BL-805's respawn-as! gate, exit 5 - the normal case while the ceremony
// fires mid-work), the old fallback sent an inert note to coordinator (which
// cannot respawn a pane it does not own), and documenter never got a live
// session.
//
// BL-1753 (the human's ruling B, 2026-09-25 - "mono-router = one resident"):
// the fallback is no longer a second session beside the resident
// (spawnConsultDocumenter, deleted) - a refused rotate is retried ONCE with
// SWARMFORGE_ROTATE_FORCE=1 instead. This test drives the REAL
// rotateDocumenter against a stub rotate_to_role.sh that mirrors
// handoff_lib.bb's real refuse-unless-forced contract (exit 5 unless the
// force env var is "1"), logging every invocation's role and force flag so
// the retry sequence itself - not just the final outcome - is observable.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { rotateDocumenter } = require('../out/tools/night-closing-ceremony-run');
const { mkTmpDir } = require('./helpers/tmpDir');

function makeFixture(rotateScript) {
  const root = mkTmpDir('ncc-rotate-fallback-');
  fs.mkdirSync(path.join(root, 'swarmforge', 'scripts'), { recursive: true });
  const rotateLog = path.join(root, 'rotate-calls.log');
  fs.writeFileSync(rotateLog, '');
  fs.writeFileSync(path.join(root, 'swarmforge', 'scripts', 'rotate_to_role.sh'), rotateScript(rotateLog), {
    mode: 0o755,
  });
  return { root, rotateLog };
}

// Every stub also logs SWARMFORGE_ROLE (BL-1753 hardener pass, 2026-09-26:
// closes a Stryker Survived gap - the 'coordinator' literal in
// rotateDocumenter's own env construction had no assertion anywhere) so
// every call's actor identity is observable, not just role/force.
//
// Mirrors handoff_lib.bb's rotate-force-override? contract exactly: refuses
// (exit 5, BL-805's respawn-as! code) unless SWARMFORGE_ROTATE_FORCE is "1".
const REFUSE_UNLESS_FORCED = (rotateLog) => `#!/bin/sh
printf 'role=%s force=%s actor=%s\\n' "$1" "\${SWARMFORGE_ROTATE_FORCE:-}" "\${SWARMFORGE_ROLE:-}" >> "${rotateLog}"
if [ "\${SWARMFORGE_ROTATE_FORCE:-}" = "1" ]; then
  exit 0
fi
exit 5
`;

const ALWAYS_SUCCEEDS = (rotateLog) => `#!/bin/sh
printf 'role=%s force=%s actor=%s\\n' "$1" "\${SWARMFORGE_ROTATE_FORCE:-}" "\${SWARMFORGE_ROLE:-}" >> "${rotateLog}"
exit 0
`;

const ALWAYS_REFUSES = (rotateLog) => `#!/bin/sh
printf 'role=%s force=%s actor=%s\\n' "$1" "\${SWARMFORGE_ROTATE_FORCE:-}" "\${SWARMFORGE_ROLE:-}" >> "${rotateLog}"
exit 5
`;

test('a refused rotation is retried once with SWARMFORGE_ROTATE_FORCE=1, never a second session', () => {
  const { root, rotateLog } = makeFixture(REFUSE_UNLESS_FORCED);
  rotateDocumenter(root);
  const calls = fs.readFileSync(rotateLog, 'utf8').trim().split('\n');
  assert.deepEqual(
    calls,
    ['role=documenter force= actor=coordinator', 'role=documenter force=1 actor=coordinator'],
    'expected exactly one plain call then one forced retry, both acting as coordinator'
  );
  assert.ok(!fs.existsSync(path.join(root, '.swarmforge', 'daemon', 'consult', 'documenter.json')), 'no consult marker is ever written');
});

test('a successful direct rotation is never retried with force', () => {
  const { root, rotateLog } = makeFixture(ALWAYS_SUCCEEDS);
  rotateDocumenter(root);
  const calls = fs.readFileSync(rotateLog, 'utf8').trim().split('\n');
  assert.deepEqual(calls, ['role=documenter force= actor=coordinator'], 'expected exactly one plain call, no retry');
});

test('a rotate refused even under force does nothing further (BL-1641 is the safety net)', () => {
  const { root, rotateLog } = makeFixture(ALWAYS_REFUSES);
  assert.doesNotThrow(() => rotateDocumenter(root));
  const calls = fs.readFileSync(rotateLog, 'utf8').trim().split('\n');
  assert.deepEqual(
    calls,
    ['role=documenter force= actor=coordinator', 'role=documenter force=1 actor=coordinator'],
    'expected the plain call and exactly one forced retry, nothing more'
  );
});

// The missing-rotate_to_role.sh branch is deliberately NOT a fourth test
// here: BL-1593's own frozen acceptance gate
// (bl1593CeremonyFallbackTestTmpDirSteps.js scenario 04) asserts this
// file's own `npx vitest run` output literally contains "3 passed" -
// covered instead in the sibling file below, which BL-1593 does not pin.
