'use strict';

// BL-1652 hardening: the three functions this ticket ADDED to handoffd.bb
// (heartbeat-age-seconds, role-lane-running?, format-respawn-readings) had
// zero test coverage of their own - the property test and the acceptance
// feature both drive chase_sweep_test_runner.bb's FAKE adapters, whose
// "respawn-readings"/"telemetry-respawn-readings" log lines are a
// hand-written second implementation of the field-name/order format, never
// a call into handoffd.bb's real format-respawn-readings. A typo or
// reordering in the real function would pass every existing test.
//
// Loads the real handoffd.bb (guarded main - `load-file` never starts the
// daemon, BL-1395) against a throwaway fixture root, exactly the pattern
// BL-406's own tmp-daemon refusal names as the sanctioned escape hatch
// (SWARMFORGE_ALLOW_TMP_DAEMON=1) for an intentional test fixture.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync, spawn } = require('node:child_process');
const { mkTmpDir } = require('./helpers/tmpDir');

const REPO_ROOT = path.join(__dirname, '..', '..');
const HANDOFFD = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'handoffd.bb');

// BL-1673: the form is written to a FILE rather than passed via `-e` - an
// `-e` form is a literal bb process argv element, so a form naming a
// fixture worktree (as several callers below do) put that path on the
// probe's own command line, where lane-running?'s own scan could see it
// (probe C, unowned-red-bl1652-role-lane-running-adjudication-specifier-
// 20260921.md: the same form read from a file names no worktree on argv).
function loadHandoffdAndRun(root, forms) {
  const script = `(load-file "${HANDOFFD}")\n${forms}`;
  const scriptFile = path.join(mkTmpDir('bl1652-script-'), 'probe.bb');
  fs.writeFileSync(scriptFile, script);
  // No `--` here: unlike `-e`, a bb FILE invocation does not consume `--`
  // as a separator - it survives into *command-line-args* itself
  // (`("--" root)`), which shifted project-root to "--" and broke every
  // heartbeat-file read (confirmed empirically against bb before fixing).
  return execFileSync('bb', [scriptFile, root], {
    encoding: 'utf8',
    env: { ...process.env, SWARMFORGE_ALLOW_TMP_DAEMON: '1' },
  }).trim();
}

function writeHeartbeat(root, role, { lastBeat, inFlight = 'false', pid = '99999' }) {
  fs.mkdirSync(path.join(root, '.swarmforge', 'heartbeat'), { recursive: true });
  fs.writeFileSync(
    path.join(root, '.swarmforge', 'heartbeat', `${role}.yaml`),
    `last_beat: "${lastBeat}"\nin_flight: "${inFlight}"\npid: "${pid}"\n`
  );
}

// ── heartbeat-age-seconds ────────────────────────────────────────────────

test('heartbeat-age-seconds: well-formed heartbeat reports the real elapsed seconds', () => {
  const root = mkTmpDir('bl1652-hb-age-');
  writeHeartbeat(root, 'QA', { lastBeat: '2026-09-19T12:00:00.000Z' });
  const nowMs = Date.parse('2026-09-19T12:10:00.000Z');
  const out = loadHandoffdAndRun(root, `(println (handoffd/heartbeat-age-seconds "QA" ${nowMs}))`);
  assert.equal(out, '600.0');
});

test('heartbeat-age-seconds: absent heartbeat file reads nil, never zero or a crash', () => {
  const root = mkTmpDir('bl1652-hb-absent-');
  fs.mkdirSync(path.join(root, '.swarmforge', 'heartbeat'), { recursive: true });
  const nowMs = Date.parse('2026-09-19T12:10:00.000Z');
  const out = loadHandoffdAndRun(root, `(println (handoffd/heartbeat-age-seconds "QA" ${nowMs}))`);
  assert.equal(out, 'nil');
});

test('heartbeat-age-seconds: present-but-malformed last_beat reads nil, never a crash or a bogus age', () => {
  const root = mkTmpDir('bl1652-hb-malformed-');
  writeHeartbeat(root, 'QA', { lastBeat: 'not-a-real-timestamp' });
  const nowMs = Date.parse('2026-09-19T12:10:00.000Z');
  const out = loadHandoffdAndRun(root, `(println (handoffd/heartbeat-age-seconds "QA" ${nowMs}))`);
  assert.equal(out, 'nil');
});

// ── format-respawn-readings ──────────────────────────────────────────────
// Pins the exact literal every fake-harness test (the property test and the
// acceptance step handler) already asserts a "respawn-readings ..." line
// looks like - so a future edit to the real function that drifts from the
// fake mirror fails HERE, not silently.

test('format-respawn-readings: exact field names, order and boolean rendering', () => {
  const root = mkTmpDir('bl1652-fmt-');
  const out = loadHandoffdAndRun(
    root,
    `(println (@#'handoffd/format-respawn-readings {:itemId "05_item.handoff" :liveness "dead" :heartbeatAgeS 600.0 :activityAgeS 700.5 :busy false :lane false}))`
  );
  assert.equal(out, 'item=05_item.handoff liveness=dead heartbeat-age-s=600.0 activity-age-s=700.5 busy=false lane=false');
});

test('format-respawn-readings: busy/lane render as literal true/false, never truthy junk', () => {
  const root = mkTmpDir('bl1652-fmt-bool-');
  const out = loadHandoffdAndRun(
    root,
    `(println (@#'handoffd/format-respawn-readings {:itemId "01_item.handoff" :liveness "unknown" :heartbeatAgeS nil :activityAgeS nil :busy true :lane true}))`
  );
  assert.equal(out, 'item=01_item.handoff liveness=unknown heartbeat-age-s= activity-age-s= busy=true lane=true');
});

// ── role-lane-running? ───────────────────────────────────────────────────
// Proves the :worktree-path key handoffd.bb's own roles map actually uses
// (line ~274) is the SAME key role-lane-running? reads - a mismatched key
// here would silently always read false (lane-process-lib/lane-running?
// treats a nil worktree as "not running", never an error), exactly the
// set-compare class of defect a misspelled adapter key produces elsewhere
// in this codebase.

test('role-lane-running?: delegates :worktree-path to a real, currently-running lane process', () => {
  const worktree = mkTmpDir('bl1652-role-lane-');
  const child = spawn('bash', ['-c', 'exec -a run_acceptance.sh sleep 30'], { cwd: worktree, stdio: 'ignore' });
  try {
    execFileSync('sleep', ['0.3']);
    const root = mkTmpDir('bl1652-role-lane-root-');
    const out = loadHandoffdAndRun(root, `(println (handoffd/role-lane-running? {:worktree-path "${worktree}"}))`);
    assert.equal(out, 'true');
  } finally {
    if (child.pid) {
      try {
        process.kill(child.pid, 'SIGKILL');
      } catch {
        // already dead - fine
      }
    }
  }
});

test('role-lane-running?: a role-info with no matching lane process reads false', () => {
  const worktree = mkTmpDir('bl1652-role-lane-quiet-');
  const root = mkTmpDir('bl1652-role-lane-quiet-root-');
  const out = loadHandoffdAndRun(root, `(println (handoffd/role-lane-running? {:worktree-path "${worktree}"}))`);
  assert.equal(out, 'false');
});
