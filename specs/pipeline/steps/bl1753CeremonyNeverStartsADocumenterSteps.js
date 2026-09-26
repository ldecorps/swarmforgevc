'use strict';

// BL-1753: step handlers for "the closing ceremony never starts a documenter
// beside a mono-router resident". Drives the REAL exported rotateDocumenter
// and the real sendHandoffNote/briefingInstruction pair (buildRealDeps'
// own instructBriefing closure, reconstructed inline since it is not itself
// exported) against a disposable mkdtemp fixture (BL-1390) - a real
// rotate_to_role.sh stub mirroring handoff_lib.bb's refuse-unless-forced
// contract, and a fake tmux recording every session it would have created.
// "The recorded closing sequence names rotate-documenter once" reads the
// REAL pure machine (advanceNightClosingCeremony) directly - no IO needed
// for that one, and it is the same two-tick shape
// nightClosingCeremonyLive.test.js's own "drain overrun parks and rotates"
// case already uses.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { rotateDocumenter, sendHandoffNote } = require('../../../extension/out/tools/night-closing-ceremony-run');
const { advanceNightClosingCeremony, briefingInstruction } = require('../../../extension/out/quality/nightClosingCeremonyLive');
const { mkTmpDir } = require('../../../extension/test/helpers/tmpDir');

const FEATURE = 'BL-1753 The closing ceremony never starts a documenter beside a mono-router resident';
const DAY_KEY = '2026-09-26';

function obs(over = {}) {
  return {
    nowMs: 1_000_000,
    nightKey: DAY_KEY,
    dayKey: DAY_KEY,
    ceremonyDue: true,
    drainBudgetMs: 25 * 60_000,
    hardDeadlineMs: 1_000_000 + 35 * 60_000,
    inFlightCount: 1,
    activeRole: 'coder',
    heldParcelIds: [],
    briefingAlreadySent: false,
    ...over,
  };
}

function tick(prev, over = {}) {
  return advanceNightClosingCeremony(prev, obs(over));
}

// The exact shape "drain overrun parks and rotates" in
// nightClosingCeremonyLive.test.js already proves: frozen at t0 with
// activeRole coder, then advanced past drainDeadlineMs still holding the
// parcel - the resident is parked (not drained), and rotate-documenter is
// requested exactly once.
function sequenceForResidentHoldingParcel() {
  const started = tick(null, { inFlightCount: 1, activeRole: 'coder' });
  const parked = tick(started.state, {
    nowMs: started.state.drainDeadlineMs + 1,
    inFlightCount: 1,
    activeRole: 'coder',
  });
  return parked;
}

// mirrors handoff_lib.bb's rotate-force-override? contract: refuses (exit
// 5, BL-805's respawn-as! code) while PARCEL_MARKER exists and force is not
// "1"; a fixture with no held parcel never writes PARCEL_MARKER, so this
// succeeds on the very first, unforced call. On success it ALSO logs the
// tmux action a real rotate performs - respawn-pane on the ONE shared
// resident session, never a new one - so "no tmux session is created"
// below is a real check on that log, not vacuously true because nothing
// in this stub ever touches tmux at all.
function rotateToRoleStub(rotateLog, parcelMarker, tmuxLog) {
  return `#!/bin/sh
force="\${SWARMFORGE_ROTATE_FORCE:-}"
if [ -f "${parcelMarker}" ] && [ "$force" != "1" ]; then
  printf 'role=%s force=%s result=refused\\n' "$1" "$force" >> "${rotateLog}"
  exit 5
fi
printf 'role=%s force=%s result=ok\\n' "$1" "$force" >> "${rotateLog}"
printf 'respawn-pane -t swarmforge-resident %s\\n' "$1" >> "${tmuxLog}"
exit 0
`;
}

function makeRouterFixture(holdsParcel) {
  const root = mkTmpDir('bl1753-ceremony-');
  fs.mkdirSync(path.join(root, 'swarmforge', 'scripts'), { recursive: true });
  fs.mkdirSync(path.join(root, '.swarmforge', 'daemon', 'consult'), { recursive: true });
  const coderInProcess = path.join(root, 'wt-coder', '.swarmforge', 'handoffs', 'inbox', 'in_process');
  fs.mkdirSync(coderInProcess, { recursive: true });
  const parcelFile = path.join(coderInProcess, '00_case.handoff');
  if (holdsParcel) {
    fs.writeFileSync(
      parcelFile,
      'id: case\nfrom: architect\nto: coder\npriority: 50\ntype: git_handoff\ntask: BL-9003\ncommit: cccccccccc\n\nmerge_and_process architect cccccccccc\n'
    );
  }
  const tmuxLog = path.join(root, 'tmux-calls.log');
  fs.writeFileSync(tmuxLog, '');
  const rotateLog = path.join(root, 'rotate-calls.log');
  fs.writeFileSync(rotateLog, '');
  fs.writeFileSync(
    path.join(root, 'swarmforge', 'scripts', 'rotate_to_role.sh'),
    rotateToRoleStub(rotateLog, parcelFile, tmuxLog),
    { mode: 0o755 }
  );

  return { root, rotateLog, tmuxLog, parcelFile };
}

function makeStandingFixture() {
  const root = mkTmpDir('bl1753-ceremony-standing-');
  const tmuxLog = path.join(root, 'tmux-calls.log');
  fs.writeFileSync(tmuxLog, '');
  const notesLog = path.join(root, '.swarmforge', 'daemon', 'closing-ceremony-notes.log');
  fs.mkdirSync(path.dirname(notesLog), { recursive: true });
  return { root, tmuxLog, notesLog };
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(/^a mono-router fixture whose resident holds a coder parcel at the ceremony's drain deadline$/, (ctx) => {
    ctx.bl1753 = { kind: 'router', ...makeRouterFixture(true) };
  }, FEATURE);

  scoped(/^a mono-router fixture whose resident holds no parcel at the ceremony's drain deadline$/, (ctx) => {
    ctx.bl1753 = { kind: 'router', ...makeRouterFixture(false) };
  }, FEATURE);

  scoped(/^a standing-pack fixture whose documenter seat is live$/, (ctx) => {
    ctx.bl1753 = { kind: 'standing', ...makeStandingFixture() };
  }, FEATURE);

  scoped(/^the ceremony enters its briefing phase$/, (ctx) => {
    const st = ctx.bl1753;
    if (!st) {
      throw new Error('BL-1753: "the ceremony enters its briefing phase" reached with no fixture built yet');
    }
    if (st.kind === 'router') {
      rotateDocumenter(st.root);
    } else if (st.kind === 'standing') {
      sendHandoffNote(st.root, 'documenter', briefingInstruction(DAY_KEY));
    } else {
      throw new Error(`BL-1753: unrecognized fixture kind ${JSON.stringify(st.kind)}`);
    }
  }, FEATURE);

  scoped(/^no tmux session is created$/, (ctx) => {
    const calls = fs.readFileSync(ctx.bl1753.tmuxLog, 'utf8');
    assert.doesNotMatch(calls, /new-session/, `expected no NEW tmux session (a respawn of the shared resident pane is fine), got:\n${calls}`);
  }, FEATURE);

  scoped(/^consult_spawn_cli\.bb is not run$/, (ctx) => {
    const marker = path.join(ctx.bl1753.root, '.swarmforge', 'daemon', 'consult', 'documenter.json');
    assert.ok(!fs.existsSync(marker), 'expected no consult marker for documenter - consult_spawn_cli.bb was never run');
  }, FEATURE);

  function rotateLines(ctx) {
    return fs
      .readFileSync(ctx.bl1753.rotateLog, 'utf8')
      .trim()
      .split('\n')
      .filter(Boolean);
  }

  scoped(/^the resident is rotated to documenter$/, (ctx) => {
    const lines = rotateLines(ctx);
    assert.ok(lines.length > 0, 'expected at least one rotate_to_role.sh call');
    assert.match(lines[lines.length - 1], /result=ok$/, `expected the rotate to have succeeded, calls:\n${lines.join('\n')}`);
  }, FEATURE);

  scoped(/^the rotate was forced$/, (ctx) => {
    const lines = rotateLines(ctx);
    assert.deepEqual(
      lines.map((l) => l.split(' ')[0]),
      ['role=documenter', 'role=documenter'],
      `expected exactly two calls (plain refused, then forced), got:\n${lines.join('\n')}`
    );
    assert.match(lines[1], /force=1 result=ok$/, `expected the second call to be forced and succeed, calls:\n${lines.join('\n')}`);
  }, FEATURE);

  scoped(/^the rotate was not forced$/, (ctx) => {
    const lines = rotateLines(ctx);
    assert.equal(lines.length, 1, `expected exactly one call (no force retry needed), got:\n${lines.join('\n')}`);
    assert.match(lines[0], /force= result=ok$/, `expected the one call to be unforced and succeed, got: ${lines[0]}`);
  }, FEATURE);

  scoped(/^the coder parcel is still in coder's in_process$/, (ctx) => {
    assert.ok(fs.existsSync(ctx.bl1753.parcelFile), 'expected the coder in_process parcel to be untouched by the rotate');
  }, FEATURE);

  scoped(/^the recorded closing sequence names rotate-documenter once$/, () => {
    const { state } = sequenceForResidentHoldingParcel();
    const count = state.sequence.filter((s) => s === 'rotate-documenter').length;
    assert.equal(count, 1, `expected exactly one rotate-documenter entry, got sequence: ${JSON.stringify(state.sequence)}`);
  }, FEATURE);

  scoped(/^the documenter is instructed to write the briefing$/, (ctx) => {
    const notes = fs.readFileSync(ctx.bl1753.notesLog, 'utf8');
    assert.match(notes, /^documenter: produce the morning briefing/m, `expected a documenter briefing instruction, got:\n${notes}`);
  }, FEATURE);
}

module.exports = { registerSteps };
