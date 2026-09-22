'use strict';

// BL-1517 scenario 06's durable half, wired into the standing unit
// lane: runs the REAL enumeration+behavioral check
// (project_root_arg_lib.bb's missing-fixture-root-check) against the
// REAL swarmforge/scripts/test/ directory and asserts zero offenders.
// A harness added later with the unguarded `(first *command-line-args*)`
// / `(nth *command-line-args* 0` shape fails THIS test, naming itself -
// there is no hardcoded list here to forget to update.

const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..');
const LIB_PATH = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'project_root_arg_lib.bb');
const TEST_SCRIPTS_DIR = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'test');

function runCheck() {
  const script = `
(require '[babashka.fs :as fs])
(load-file "${LIB_PATH}")
(let [result (project-root-arg-lib/missing-fixture-root-check "${TEST_SCRIPTS_DIR}")]
  (println (str "===BL1517_CHECK_START===" (pr-str result) "===BL1517_CHECK_END===")))
`;
  const result = spawnSync('bb', ['-e', script], { encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(`missing-fixture-root-check driver failed: ${result.stderr || result.error}`);
  }
  const match = result.stdout.match(/===BL1517_CHECK_START===([\s\S]*?)===BL1517_CHECK_END===/);
  if (!match) {
    throw new Error(`no delimited payload found in output: ${result.stdout.slice(0, 500)}`);
  }
  const examinedMatch = match[1].match(/:examined \[([^\]]*)\]/);
  const offendersMatch = match[1].match(/:offenders \[([^\]]*)\]/);
  const parseList = (s) => (s ? Array.from(s.matchAll(/"([^"]*)"/g)).map((m) => m[1]) : []);
  return {
    examined: parseList(examinedMatch && examinedMatch[1]),
    offenders: parseList(offendersMatch && offendersMatch[1]),
  };
}

test('every swarmforge/scripts/test/*.bb file that binds a root from *command-line-args* refuses a missing one', () => {
  const { examined, offenders } = runCheck();
  // A sanity floor, not a pin (BL-1685's own lesson: the directory grows) -
  // proves the enumeration actually reached real files, never a stub
  // returning an empty list.
  assert.ok(examined.length >= 3, `expected the enumeration to reach at least the three named harnesses, examined: ${JSON.stringify(examined)}`);
  assert.deepEqual(
    offenders,
    [],
    `harness(es) accepting a missing fixture root (BL-1517/BL-889 hazard): ${JSON.stringify(offenders)}`
  );
});
