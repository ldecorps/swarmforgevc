const assert = require('node:assert/strict');
const fc = require('fast-check');
const fs = require('node:fs');
const path = require('node:path');

// BL-684 invariant 1 (property authorship rests with the coder, first pass -
// BL-654): "After the rename, every start, stop, supervise and reconcile
// path in tracked live surface resolves: no caller anywhere names a script,
// entrypoint, identifier or state file that does not exist." This is the
// Scenario Outline onboarder-rename-02 table (start_ancillary_services.sh,
// stop_ancillary_services.sh, the launcher, the supervisor, the reconcile
// CLI, the supervisor tick test) made executable: for each caller, every
// current-named artifact it references either (a) exists as a real
// repo-tracked file, or (b) is byte-identical to the name the artifact's
// own PRODUCER (onboarder_supervisor.bb / onboarder-reconcile.ts) defines -
// a silently-drifted name in even one of these is exactly the BL-637 defect
// this invariant exists to catch ("a rename that turns a launch or stop
// into a no-op").
//
// Generator reach: the caller set is the invariant's OWN finite domain
// (the six rows the ticket's Scenario Outline names) - there is no wider
// space to sample from, so numRuns is set to a large multiple of the row
// count. fast-check's constantFrom draws uniformly; over that many draws
// missing any one of six rows is astronomically unlikely (this is the
// asserted reachability floor, not a hoped-for one).
const REPO_ROOT = path.join(__dirname, '..', '..');

function readRepoFile(relPath) {
  return fs.readFileSync(path.join(REPO_ROOT, relPath), 'utf8');
}
function repoFileExists(relPath) {
  return fs.existsSync(path.join(REPO_ROOT, relPath));
}

const CALLER_CHECKS = [
  {
    caller: 'start_ancillary_services.sh',
    file: 'swarmforge/scripts/start_ancillary_services.sh',
    mustContain: ['launch_onboarder.sh'],
    mustExist: ['swarmforge/scripts/launch_onboarder.sh'],
  },
  {
    caller: 'stop_ancillary_services.sh',
    file: 'swarmforge/scripts/stop_ancillary_services.sh',
    mustContain: ['onboarder-supervisor.pid', 'onboarder-supervisor.stop', 'onboarder-supervisor.status.json', 'onboarder-heartbeat.json'],
    mustExist: [],
  },
  {
    caller: 'the launcher',
    file: 'swarmforge/scripts/launch_onboarder.sh',
    mustContain: ['onboarder_supervisor.bb', 'onboarder-supervisor.pid', 'onboarder-reconcile.js'],
    mustExist: ['swarmforge/scripts/onboarder_supervisor.bb'],
  },
  {
    caller: 'the supervisor',
    file: 'swarmforge/scripts/onboarder_supervisor.bb',
    mustContain: ['onboarder-supervisor.pid', 'onboarder-supervisor.stop', 'onboarder-supervisor.status.json', 'onboarder-heartbeat.json', 'onboarder-reconcile.js'],
    mustExist: [],
  },
  {
    caller: 'the reconcile CLI',
    file: 'extension/src/tools/onboarder-reconcile.ts',
    mustContain: ['onboarder-heartbeat.json', 'onboarder_supervisor.bb'],
    mustExist: ['swarmforge/scripts/onboarder_supervisor.bb'],
  },
  {
    caller: 'the supervisor tick test',
    file: 'swarmforge/scripts/test/test_onboarder_supervisor_tick.sh',
    mustContain: ['onboarder_supervisor.bb', 'onboarder-heartbeat.json', 'onboarder-supervisor.status.json'],
    mustExist: ['swarmforge/scripts/onboarder_supervisor.bb'],
  },
];

test('property: every caller of a renamed onboarder path names an artifact that resolves', () => {
  fc.assert(
    fc.property(fc.constantFrom(...CALLER_CHECKS), (row) => {
      assert.ok(repoFileExists(row.file), `caller file itself must exist: ${row.file}`);
      const content = readRepoFile(row.file);
      for (const needle of row.mustContain) {
        assert.ok(
          content.includes(needle),
          `${row.caller} (${row.file}) must reference the current name "${needle}" - a drifted name here is a silent no-op (BL-637)`
        );
      }
      for (const target of row.mustExist) {
        assert.ok(repoFileExists(target), `${row.caller} (${row.file}) names "${target}", which does not exist on disk`);
      }
    }),
    { numRuns: CALLER_CHECKS.length * 40 }
  );
});
