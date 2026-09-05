'use strict';

// BL-1061: the one place a test fixture gets a tunnel name.
//
// Tunnel fixtures spawn REAL processes whose command lines read
// "... run <name>", and the reap edge in tunnel_ownership_lib.sh selects what
// to signal by that name against the HOST process table. A fixture bound to
// the production name is therefore two faults at once: the suite cannot pass
// while the operator's tunnel is up (the extra process is genuinely there),
// and the suite's own reap is entitled to signal it. A test that can kill
// production transport is a live fault, not a test annoyance.
//
// Until BL-1061 the reap silently no-opped on Linux (`pgrep -fl` prints only
// the process name on procps-ng, so nothing ever matched), which masked the
// second half. Fixing the reap ARMS it - which is why the reap fix and this
// helper had to land together.

const os = require('node:os');

// Names any fixture may never bind, because a real process on a developer or
// operator host serves them.
const PRODUCTION_TUNNEL_NAMES = Object.freeze(['swarmforge-bubble']);

let counter = 0;

/**
 * A tunnel name unique to this process and this call. `label` is free text to
 * make a failure readable; it never affects uniqueness.
 */
function fixtureTunnelName(label = 'fixture') {
  counter += 1;
  const safeLabel = String(label).replace(/[^A-Za-z0-9-]/g, '-');
  return `sfvc-test-${process.pid}-${counter}-${safeLabel}-${Math.random().toString(36).slice(2, 8)}`;
}

/** True when `name` is one no fixture may bind. */
function isProductionTunnelName(name) {
  return PRODUCTION_TUNNEL_NAMES.includes(String(name));
}

/**
 * Throws unless `name` is safe to bind in a fixture. Called by fixtures at the
 * point of binding, so the refusal names the test rather than surfacing later
 * as an unexplained reap.
 */
function assertFixtureTunnelName(name) {
  if (isProductionTunnelName(name)) {
    throw new Error(
      `bl1061: a test fixture may not bind the production tunnel name "${name}" - ` +
      'the reap selects by name against the host process table, so this fixture could signal the ' +
      'operator\'s real tunnel. Use fixtureTunnelName() instead.'
    );
  }
  return name;
}

// BL-1287: the temp path answers "could this be a fixture?" (BL-1061's own
// question, kept - see the doc comment below). It cannot answer "does
// someone still need it?", because every fixture cloudflared - whichever
// run made it - lives under the same OS temp directory and carries the
// same command-line shape by construction. A concurrently-running
// sibling's LIVE fixture and an earlier run's LEAKED one are otherwise
// indistinguishable, so a temp-path-only sweep kills both.
//
// The discriminator is liveness of the CREATING RUN, not age of the
// process (a start-time cutoff still kills a sibling fork that started
// earlier and legitimately owns older-looking fixtures). fixtureTunnelName()
// already encodes its caller's own `process.pid` in every name it mints
// (`sfvc-test-<pid>-...`) - the one place a fixture gets a tunnel name is
// also the one place its creator is recorded, so the sweep reads it back
// rather than tracking creation separately.
const CREATOR_PID_RE = /\brun\s+sfvc-test-(\d+)-/;

/** Pure: the creating run's pid encoded in a fixture's own command line, or
 * null when the line does not carry the fixtureTunnelName() shape at all
 * (defensive fallback only - every fixture this module itself names does). */
function creatingPidFor(psLine) {
  const m = psLine.match(CREATOR_PID_RE);
  return m ? Number(m[1]) : null;
}

function isProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Fixture processes safe for THIS run to signal: temp-path cloudflareds
 * whose creating run is no longer alive. A fixture a live run still owns -
 * however its temp path or tunnel name is shaped - is never selected
 * (invariant 1); a fixture whose creator cannot be identified at all falls
 * back to the pre-BL-1287 posture (selected, since there is no known live
 * owner to protect), so a killed creator's own fixtures are still cleared
 * however it died (invariant 2).
 *
 * Path, never name, for THIS half of the question - and that is still the
 * load-bearing choice: a name-matched sweep would select the operator's
 * real tunnel too, which is the very thing this module exists to prevent.
 * Every fixture cloudflared is a script under the OS temp directory; the
 * real one is an installed binary, so a temp-path match cannot reach it
 * however the names collide (invariant 3).
 */
function leakedFixtureTunnelPids(execFileSync) {
  const tmp = os.tmpdir();
  let out = '';
  try {
    out = execFileSync('ps', ['-eo', 'pid=,args='], { encoding: 'utf8' });
  } catch {
    return [];
  }
  return out
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.includes(`${tmp}/`) && /\bcloudflared\b/.test(line) && / run \S/.test(line))
    .filter((line) => {
      const creatorPid = creatingPidFor(line);
      if (creatorPid === null) return true;
      return !isProcessAlive(creatorPid);
    })
    .map((line) => Number(line.split(/\s+/)[0]))
    .filter((pid) => Number.isInteger(pid) && pid > 0 && pid !== process.pid);
}

module.exports = {
  PRODUCTION_TUNNEL_NAMES,
  fixtureTunnelName,
  isProductionTunnelName,
  assertFixtureTunnelName,
  leakedFixtureTunnelPids,
  creatingPidFor,
  isProcessAlive,
};
