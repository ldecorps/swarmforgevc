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
//
// BL-1724: this file used to start a fresh bb (loading the whole
// handoffd.bb) once PER CASE - seven bb processes per run, each about 1s
// under host load, pushing the whole file over the unit suite's 7.0s
// per-file budget (13.4s in-suite / 9.6-8.0s alone at load 12-13). BL-1663's
// pattern for bl1474's property test: build every case's form, run bb ONCE,
// and have each `test` read its own line of the single result. The
// role-lane-running? cases' spawned lane process is started before that one
// bb run and stopped after it (its own docstring's invariant, unchanged).
// The three fixture roots this beforeAll now creates directly (`root`,
// `laneWorktree`, `quietWorktree`) are referenced by every later `test`, so
// they use mkSharedTmpDir (per-file afterAll sweep), never mkTmpDir
// (per-test afterEach sweep - would remove them after the first test)
// - bl1280MkdtempMigrationInvariants.property.test.js caught the original
// mkTmpDir choice here.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync, spawn } = require('node:child_process');
const { mkTmpDir, mkSharedTmpDir } = require('./helpers/tmpDir');

const REPO_ROOT = path.join(__dirname, '..', '..');
const HANDOFFD = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'handoffd.bb');

function writeHeartbeat(root, role, { lastBeat, inFlight = 'false', pid = '99999' }) {
  fs.mkdirSync(path.join(root, '.swarmforge', 'heartbeat'), { recursive: true });
  fs.writeFileSync(
    path.join(root, '.swarmforge', 'heartbeat', `${role}.yaml`),
    `last_beat: "${lastBeat}"\nin_flight: "${inFlight}"\npid: "${pid}"\n`
  );
}

// BL-1673: the form is written to a FILE rather than passed via `-e` - an
// `-e` form is a literal bb process argv element, so a form naming a
// fixture worktree (as the role-lane-running? cases do) put that path on
// the probe's own command line, where lane-running?'s own scan could see
// it (probe C, unowned-red-bl1652-role-lane-running-adjudication-
// specifier-20260921.md: the same form read from a file names no worktree
// on argv). One script now evaluates every case's own form and prints one
// `id\tvalue` line per case (println's own value rendering, unchanged per
// case from the pre-BL-1724 per-case scripts), so a single bb process
// still names no fixture worktree on its own argv.
function runAllCases(root, cases) {
  // `print` the tab-prefixed id, then `println` the form's own value - a
  // separate call, never `(str ... (form))`, since `str` renders nil as ""
  // while `println` renders it as the literal "nil" the original per-case
  // scripts asserted on.
  const forms = cases.map(({ id, form }) => `(print "${id}" )(print "\\t")(println (${form}))`).join('\n');
  const script = `(load-file "${HANDOFFD}")\n${forms}`;
  const scriptFile = path.join(mkTmpDir('bl1652-script-'), 'probe.bb');
  fs.writeFileSync(scriptFile, script);
  // No `--` here: unlike `-e`, a bb FILE invocation does not consume `--`
  // as a separator - it survives into *command-line-args* itself
  // (`("--" root)`), which shifted project-root to "--" and broke every
  // heartbeat-file read (confirmed empirically against bb before fixing).
  const out = execFileSync('bb', [scriptFile, root], {
    encoding: 'utf8',
    env: { ...process.env, SWARMFORGE_ALLOW_TMP_DAEMON: '1' },
  });
  const results = {};
  for (const line of out.split('\n')) {
    const tab = line.indexOf('\t');
    if (tab === -1) continue;
    results[line.slice(0, tab)] = line.slice(tab + 1);
  }
  for (const { id } of cases) {
    assert.ok(Object.prototype.hasOwnProperty.call(results, id), `no output line for case "${id}": ${JSON.stringify(out)}`);
  }
  return results;
}

let results;
let laneChild;

beforeAll(() => {
  const root = mkSharedTmpDir('bl1652-shared-root-');

  // ── heartbeat-age-seconds fixtures ─────────────────────────────────────
  writeHeartbeat(root, 'HB1', { lastBeat: '2026-09-19T12:00:00.000Z' });
  fs.mkdirSync(path.join(root, '.swarmforge', 'heartbeat'), { recursive: true }); // HB2: no file written - absent case
  writeHeartbeat(root, 'HB3', { lastBeat: 'not-a-real-timestamp' });
  const nowMs = Date.parse('2026-09-19T12:10:00.000Z');

  // ── role-lane-running? fixtures ─────────────────────────────────────────
  const laneWorktree = mkSharedTmpDir('bl1652-role-lane-');
  laneChild = spawn('bash', ['-c', 'exec -a run_acceptance.sh sleep 30'], { cwd: laneWorktree, stdio: 'ignore' });
  execFileSync('sleep', ['0.3']);
  const quietWorktree = mkSharedTmpDir('bl1652-role-lane-quiet-');

  results = runAllCases(root, [
    { id: 'hb-well-formed', form: `handoffd/heartbeat-age-seconds "HB1" ${nowMs}` },
    { id: 'hb-absent', form: `handoffd/heartbeat-age-seconds "HB2" ${nowMs}` },
    { id: 'hb-malformed', form: `handoffd/heartbeat-age-seconds "HB3" ${nowMs}` },
    {
      id: 'fmt-exact',
      form: `@#'handoffd/format-respawn-readings {:itemId "05_item.handoff" :liveness "dead" :heartbeatAgeS 600.0 :activityAgeS 700.5 :busy false :lane false}`,
    },
    {
      id: 'fmt-bool',
      form: `@#'handoffd/format-respawn-readings {:itemId "01_item.handoff" :liveness "unknown" :heartbeatAgeS nil :activityAgeS nil :busy true :lane true}`,
    },
    { id: 'lane-running', form: `handoffd/role-lane-running? {:worktree-path "${laneWorktree}"}` },
    { id: 'lane-quiet', form: `handoffd/role-lane-running? {:worktree-path "${quietWorktree}"}` },
  ]);
});

afterAll(() => {
  if (laneChild && laneChild.pid) {
    try {
      process.kill(laneChild.pid, 'SIGKILL');
    } catch {
      // already dead - fine
    }
  }
});

// ── heartbeat-age-seconds ────────────────────────────────────────────────

test('heartbeat-age-seconds: well-formed heartbeat reports the real elapsed seconds', () => {
  assert.equal(results['hb-well-formed'], '600.0');
});

test('heartbeat-age-seconds: absent heartbeat file reads nil, never zero or a crash', () => {
  assert.equal(results['hb-absent'], 'nil');
});

test('heartbeat-age-seconds: present-but-malformed last_beat reads nil, never a crash or a bogus age', () => {
  assert.equal(results['hb-malformed'], 'nil');
});

// ── format-respawn-readings ──────────────────────────────────────────────
// Pins the exact literal every fake-harness test (the property test and the
// acceptance step handler) already asserts a "respawn-readings ..." line
// looks like - so a future edit to the real function that drifts from the
// fake mirror fails HERE, not silently.

test('format-respawn-readings: exact field names, order and boolean rendering', () => {
  assert.equal(
    results['fmt-exact'],
    'item=05_item.handoff liveness=dead heartbeat-age-s=600.0 activity-age-s=700.5 busy=false lane=false'
  );
});

test('format-respawn-readings: busy/lane render as literal true/false, never truthy junk', () => {
  assert.equal(
    results['fmt-bool'],
    'item=01_item.handoff liveness=unknown heartbeat-age-s= activity-age-s= busy=true lane=true'
  );
});

// ── role-lane-running? ───────────────────────────────────────────────────
// Proves the :worktree-path key handoffd.bb's own roles map actually uses
// (line ~274) is the SAME key role-lane-running? reads - a mismatched key
// here would silently always read false (lane-process-lib/lane-running?
// treats a nil worktree as "not running", never an error), exactly the
// set-compare class of defect a misspelled adapter key produces elsewhere
// in this codebase.

test('role-lane-running?: delegates :worktree-path to a real, currently-running lane process', () => {
  assert.equal(results['lane-running'], 'true');
});

test('role-lane-running?: a role-info with no matching lane process reads false', () => {
  assert.equal(results['lane-quiet'], 'false');
});
