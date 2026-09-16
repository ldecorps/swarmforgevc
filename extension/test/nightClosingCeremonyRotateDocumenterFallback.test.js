'use strict';

// Hotfix 2026-09-16: rotateDocumenter's real IO wiring (buildRealDeps' own
// function, extracted as an exported rotateDocumenter/spawnConsultDocumenter
// pair) had ZERO test coverage before this - every existing test in this
// directory injects a FAKE rotateDocumenter to exercise the pure state
// machine, never the real one. That gap is exactly how the bug shipped:
// live 2026-09-15, `rotate_to_role.sh documenter` was refused (the resident
// held a real undrained parcel, BL-805's respawn-as! gate, exit 5 - the
// normal case while the ceremony fires mid-work), the old fallback sent an
// inert note to coordinator (which cannot respawn a pane it does not own),
// and documenter never got a live session - "rotate-documenter" ->
// "briefing-missing" -> "swarm-stopped" in one ceremony run, nothing wrote
// the briefing.
//
// This test drives the REAL rotateDocumenter/spawnConsultDocumenter against
// a real fixture: a stub rotate_to_role.sh that always exits 5 (the exact
// respawn-as! refusal), the REAL consult_spawn_cli.bb, and a fake tmux on
// PATH - end to end, no mocking of execFileSync itself, same posture as
// test_consult_spawn_cli.sh's own fixture on the bb side.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { rotateDocumenter, spawnConsultDocumenter } = require('../out/tools/night-closing-ceremony-run');
const { mkTmpDir } = require('./helpers/tmpDir');
const { copyLiveScriptClosureInto } = require('./helpers/pinnedRepoFixture');

function makeFixture() {
  const root = mkTmpDir('ncc-rotate-fallback-');
  const docWt = path.join(root, 'wt-documenter');
  fs.mkdirSync(path.join(docWt, '.swarmforge', 'handoffs', 'inbox', 'new'), { recursive: true });
  fs.mkdirSync(path.join(docWt, '.swarmforge', 'handoffs', 'inbox', 'in_process'), { recursive: true });
  fs.mkdirSync(path.join(root, '.swarmforge', 'launch'), { recursive: true });
  fs.mkdirSync(path.join(root, '.swarmforge', 'daemon', 'consult'), { recursive: true });

  fs.writeFileSync(
    path.join(root, '.swarmforge', 'roles.tsv'),
    `documenter\tdocumenter\t${docWt}\tswarmforge-documenter\tDocumenter\tclaude\ttask\n`
  );
  fs.writeFileSync(path.join(root, '.swarmforge', 'tmux-socket'), path.join(root, 'fake.sock'));
  fs.writeFileSync(path.join(root, 'fake.sock'), '');
  fs.writeFileSync(path.join(root, '.swarmforge', 'launch', 'documenter.sh'), '#!/bin/sh\nexit 0\n', {
    mode: 0o755,
  });

  // The REAL consult_spawn_cli.bb, copied in alongside its DERIVED .bb
  // dependency closure (BL-1038) - never the whole live scripts directory,
  // which grows with every unrelated script the repo ever gains - same
  // "confirm the real wiring" posture as importing the real compiled
  // night-closing-ceremony-run.js above. rotate_to_role.sh is deliberately
  // NOT part of this - it is a .sh file, written fresh below as this
  // fixture's own stub.
  copyLiveScriptClosureInto(path.join(root, 'swarmforge', 'scripts'), ['consult_spawn_cli.bb']);

  // A stub rotate_to_role.sh that always exits 5 - the exact respawn-as!
  // :refuse exit code (handoff_lib.bb) for a resident with a real,
  // undrained in_process parcel and a different target role.
  fs.writeFileSync(path.join(root, 'swarmforge', 'scripts', 'rotate_to_role.sh'), '#!/bin/sh\nexit 5\n', {
    mode: 0o755,
  });

  const fakeBin = path.join(root, 'bin');
  fs.mkdirSync(fakeBin, { recursive: true });
  const tmuxLog = path.join(root, 'tmux-calls.log');
  const tmuxStateDir = path.join(root, 'tmux-state');
  fs.mkdirSync(tmuxStateDir, { recursive: true });
  fs.writeFileSync(
    path.join(fakeBin, 'tmux'),
    `#!/usr/bin/env bash
args=("$@")
if [[ "\${args[0]:-}" == "-S" ]]; then
  sub="\${args[2]:-}"
  case "$sub" in
    has-session)
      name="\${args[4]:-}"
      [[ -f "${tmuxStateDir}/$name.exists" ]] && exit 0
      exit 1
      ;;
    new-session)
      printf '%s\\n' "\${args[*]}" >> "${tmuxLog}"
      name="\${args[5]:-}"
      touch "${tmuxStateDir}/$name.exists"
      exit 0
      ;;
    *)
      printf '%s\\n' "\${args[*]}" >> "${tmuxLog}"
      exit 0
      ;;
  esac
fi
echo "unexpected tmux invocation: $*" >&2
exit 1
`,
    { mode: 0o755 }
  );
  fs.writeFileSync(tmuxLog, '');

  return { root, tmuxLog, fakeBin };
}

function withFakeTmuxOnPath(fakeBin, fn) {
  const prevPath = process.env.PATH;
  process.env.PATH = `${fakeBin}:${prevPath}`;
  try {
    return fn();
  } finally {
    process.env.PATH = prevPath;
  }
}

test('a refused rotation spawns documenter its own ephemeral session', () => {
  const { root, tmuxLog, fakeBin } = makeFixture();
  withFakeTmuxOnPath(fakeBin, () => {
    rotateDocumenter(root);
  });
  const marker = path.join(root, '.swarmforge', 'daemon', 'consult', 'documenter.json');
  assert.ok(fs.existsSync(marker), 'expected a consult marker for documenter after a refused rotation');
  const markerBody = JSON.parse(fs.readFileSync(marker, 'utf8'));
  assert.equal(markerBody.role, 'documenter');
  assert.equal(markerBody.requested_by, 'coordinator');
  const calls = fs.readFileSync(tmuxLog, 'utf8');
  assert.match(calls, /new-session/, 'expected a real new-session tmux call, not a silent no-op');
  assert.doesNotMatch(calls, /respawn-pane/, 'never a create-then-respawn sequence');
});

test('a successful direct rotation never triggers a consult spawn', () => {
  const { root, tmuxLog } = makeFixture();
  fs.writeFileSync(path.join(root, 'swarmforge', 'scripts', 'rotate_to_role.sh'), '#!/bin/sh\nexit 0\n', {
    mode: 0o755,
  });
  rotateDocumenter(root);
  const marker = path.join(root, '.swarmforge', 'daemon', 'consult', 'documenter.json');
  assert.ok(!fs.existsSync(marker), 'no consult marker when the direct rotation already succeeded');
  assert.equal(fs.readFileSync(tmuxLog, 'utf8'), '', 'no tmux calls at all on the happy path');
});

test('spawnConsultDocumenter is independently exercised, not only reachable via rotateDocumenter', () => {
  const { root, tmuxLog, fakeBin } = makeFixture();
  withFakeTmuxOnPath(fakeBin, () => {
    spawnConsultDocumenter(root);
  });
  const marker = path.join(root, '.swarmforge', 'daemon', 'consult', 'documenter.json');
  assert.ok(fs.existsSync(marker), 'spawnConsultDocumenter alone writes the consult marker');
  assert.match(fs.readFileSync(tmuxLog, 'utf8'), /new-session/, 'spawnConsultDocumenter alone calls tmux');
});
