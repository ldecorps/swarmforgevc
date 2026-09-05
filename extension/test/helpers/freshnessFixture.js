'use strict';

// BL-1420: the shared derivation BL-1399 first wrote for one fixture
// (extension/test/bl1012FreshnessSelfInflictedIncidents.property.test.js),
// extracted so the two remaining acceptance handlers (BL-1011, BL-1012) and
// the bl1011 property runner's own JS-side helpers never each hand-mirror
// the registry guard's own *_supervisor.bb glob a second time (BL-1398's
// lesson: a fixture that hand-mirrors a production closure goes red when
// the closure grows).
//
// daemon_log_freshness_registry_guard.sh (BL-784) refuses a checker run
// when (a) a daemon in FRESHNESS_REQUIRED has no conf row, or (b) any live
// *_supervisor.bb script has no conf row - the second arm has NO seam, it
// always walks scriptsDir on disk. So a fixture that wants the guard to
// pass must supply one conf row (with a fresh heartbeat) per script that
// glob will find, derived from the SAME glob, never a hand-written count -
// scenario 04 of BL-1420's own feature proves the derivation follows an
// injected scriptsDir rather than a count baked in at authoring time.

const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const LIVE_SCRIPTS_DIR = path.join(REPO_ROOT, 'swarmforge', 'scripts');

function supervisorNames(scriptsDir = LIVE_SCRIPTS_DIR) {
  return fs
    .readdirSync(scriptsDir)
    .filter((f) => f.endsWith('_supervisor.bb'))
    .map((f) => f.slice(0, -'.bb'.length))
    .sort();
}

function isoAt(epochSeconds) {
  return new Date(epochSeconds * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

// Appends one conf row + writes a fresh heartbeat log per live supervisor
// script, and writes the FRESHNESS_REQUIRED registry naming exactly
// requiredNames - so the guard's first arm sees exactly the daemon(s) under
// test and its second arm sees a row for every supervisor it will find.
// Every supervisor's heartbeat is pinned fresh at nowEpoch, so the watchdog
// takes no action on any of them; only the caller's own daemon-under-test
// row varies. Returns the supervisor names it wrote, for assertions.
function writeGuardSatisfyingRows({
  root,
  daemonRelDir,
  confPath,
  requiredPath,
  requiredNames,
  nowEpoch,
  ceilingSecs = 600,
  scriptsDir = LIVE_SCRIPTS_DIR,
}) {
  const names = supervisorNames(scriptsDir);
  fs.mkdirSync(path.join(root, daemonRelDir), { recursive: true });
  const rows = names.map(
    (name) => `${name}|${ceilingSecs}|${daemonRelDir}/${name}.log|${daemonRelDir}/${name}.pid|noop.sh`,
  );
  for (const name of names) {
    fs.writeFileSync(path.join(root, daemonRelDir, `${name}.log`), `${isoAt(nowEpoch)} heartbeat\n`);
  }
  fs.appendFileSync(confPath, rows.length ? `${rows.join('\n')}\n` : '');
  fs.writeFileSync(requiredPath, `${requiredNames.join('\n')}\n`);
  return names;
}

module.exports = { supervisorNames, isoAt, writeGuardSatisfyingRows, LIVE_SCRIPTS_DIR };
