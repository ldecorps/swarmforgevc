'use strict';

// BL-1514 declared invariant (coder first authorship - BL-654):
//
// INV2 - operator_lib.bb exports no function that no production caller
// reaches: dead-agent-events is gone (BL-653 retired the tick's own call
// to it; this ticket deletes the now-unwired pure function itself) and
// nothing under swarmforge/scripts, OUTSIDE swarmforge/scripts/test/, is
// left referencing it.
//
// Encoded as an EXHAUSTIVE walk of the real swarmforge/scripts/ tree (every
// .bb file, not a sample) rather than a fast-check generator - the property
// quantifies over a fixed, enumerable file set, so full enumeration is
// strictly stronger than any sampled subset and needs no seed.
//
// INV1 (BL-1514's other declared invariant - no acceptance scenario or step
// handler asserts the tick emits AGENT_EXITED) is NOT encoded here: it
// quantifies over Gherkin feature content and step-handler assertion
// semantics, a domain this role does not author (engineering.prompt "Does
// Not Own": Gherkin/feature files and their mutation stay with
// specifier/hardener). It is verified directly by running the acceptance
// lane itself (qa_e2e_procedure steps 1/2/4) - see the ticket's own coder
// evidence file for that run's output - not by a property test here.
//
// Non-vacuity: findDeadAgentEventsViolations is exercised against a
// synthetic FIXTURE tree with a re-introduced defn and a re-introduced
// production caller below, proving the checker actually flags both shapes
// of regression before it is trusted against the real tree.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { mkTmpDir } = require('./helpers/tmpDir');

const REPO_ROOT = path.join(__dirname, '..', '..');
const SWARM_SCRIPTS = path.join(REPO_ROOT, 'swarmforge', 'scripts');

// Walks every .bb file under `scriptsRoot`, returning one violation per file
// that (a) still defines dead-agent-events, or (b) references it from a
// path that is not under a `test` directory.
function findDeadAgentEventsViolations(scriptsRoot) {
  const violations = [];
  const stack = [scriptsRoot];
  while (stack.length) {
    const dir = stack.pop();
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
        continue;
      }
      if (!entry.name.endsWith('.bb')) continue;
      const text = fs.readFileSync(full, 'utf8');
      if (!text.includes('dead-agent-events')) continue;
      const relFromRoot = path.relative(scriptsRoot, full);
      const underTestDir = relFromRoot.split(path.sep).includes('test');
      if (/\(defn\s+dead-agent-events\b/.test(text)) {
        violations.push({ file: relFromRoot, reason: 'defines dead-agent-events' });
      } else if (!underTestDir) {
        violations.push({ file: relFromRoot, reason: 'references dead-agent-events outside test/' });
      }
    }
  }
  return violations;
}

test('BL-1514 INV2: the real swarmforge/scripts/ tree defines no dead-agent-events and no non-test file references it', () => {
  const violations = findDeadAgentEventsViolations(SWARM_SCRIPTS);
  assert.deepEqual(violations, []);
});

test('BL-1514 INV2 non-vacuity: the checker flags a re-introduced defn', () => {
  const root = mkTmpDir('sfvc-bl1514-defn-');
  fs.writeFileSync(
    path.join(root, 'operator_lib.bb'),
    '(defn dead-agent-events [a b] [])\n'
  );
  const violations = findDeadAgentEventsViolations(root);
  assert.equal(violations.length, 1);
  assert.equal(violations[0].reason, 'defines dead-agent-events');
});

test('BL-1514 INV2 non-vacuity: the checker flags a re-introduced production caller outside test/', () => {
  const root = mkTmpDir('sfvc-bl1514-caller-');
  fs.writeFileSync(
    path.join(root, 'operator_runtime.bb'),
    '(operator-lib/dead-agent-events roles live-sessions)\n'
  );
  const violations = findDeadAgentEventsViolations(root);
  assert.equal(violations.length, 1);
  assert.equal(violations[0].reason, 'references dead-agent-events outside test/');
});

test('BL-1514 INV2 non-vacuity: a reference confined to a test/ subdirectory is NOT flagged', () => {
  const root = mkTmpDir('sfvc-bl1514-testref-');
  fs.mkdirSync(path.join(root, 'test'));
  fs.writeFileSync(
    path.join(root, 'test', 'operator_lib_test_runner.bb'),
    '(operator-lib/dead-agent-events roles live-sessions)\n'
  );
  const violations = findDeadAgentEventsViolations(root);
  assert.deepEqual(violations, []);
});
