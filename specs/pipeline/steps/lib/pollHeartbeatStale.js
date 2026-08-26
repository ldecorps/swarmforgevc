'use strict';

// Shared adapter for front-desk-supervisor-lib/poll-heartbeat-stale? (5-arity).
// Used by BL-1089 acceptance steps and property cover — one bb seam, not two.

const path = require('node:path');
const { execFileSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..', '..');
const LIB = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'front_desk_supervisor_lib.bb');

/**
 * @param {{ heartbeat: number|null, now: number, stall: number, spawn: number, grace: number }} args
 * @returns {boolean}
 */
function pollHeartbeatStale({ heartbeat, now, stall, spawn, grace }) {
  const hb = heartbeat === null ? 'nil' : String(heartbeat);
  const out = execFileSync(
    'bb',
    [
      '-e',
      `(require '[babashka.fs :as fs])
(load-file "${LIB}")
(println (front-desk-supervisor-lib/poll-heartbeat-stale? ${hb} ${now} ${stall} ${spawn} ${grace}))`,
    ],
    { encoding: 'utf8' }
  );
  return out.trim() === 'true';
}

module.exports = { pollHeartbeatStale, LIB, REPO_ROOT };
