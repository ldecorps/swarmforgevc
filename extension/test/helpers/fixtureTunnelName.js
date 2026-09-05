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

/**
 * Fixture processes leaked by an EARLIER run, identified by the throwaway
 * binary path they were launched from rather than by tunnel name.
 *
 * Path, never name, and that is the load-bearing choice: a name-matched sweep
 * would select the operator's real tunnel too, which is the very thing this
 * module exists to prevent. Every fixture cloudflared is a script under the
 * OS temp directory; the real one is an installed binary, so a temp-path
 * match cannot reach it however the names collide.
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
    .map((line) => Number(line.split(/\s+/)[0]))
    .filter((pid) => Number.isInteger(pid) && pid > 0 && pid !== process.pid);
}

module.exports = {
  PRODUCTION_TUNNEL_NAMES,
  fixtureTunnelName,
  isProductionTunnelName,
  assertFixtureTunnelName,
  leakedFixtureTunnelPids,
};
