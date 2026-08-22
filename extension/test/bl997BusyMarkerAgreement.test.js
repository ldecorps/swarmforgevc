// BL-997/BL-897: the busy-footer definition is mirrored by hand across a
// boundary no import can bridge - Babashka (chase_sweep_lib.bb's
// actively-processing?, the swarm's own classifier) and TypeScript
// (agentPaneState.ts's isPaneActivelyProcessing, this extension host's own
// classifier, reused by tmuxClient.ts's respawn precheck - see
// bl997LiveTurnStatusFrameRefusesRespawn in tmuxClient.test.js for that
// consequence). A "kept in sync" comment on each side is not a gate; this
// file is the gate.
//
// Deliberately BEHAVIORAL, not a literal-string comparison (unlike
// bl948SocketGuardLimitParity.test.js's regex-on-the-.bb-source approach):
// BL-970 replaced Babashka's single marker literal with structural
// recognition (a live status frame - spinner glyph, verb, ellipsis,
// digit-led elapsed - consulted only in the snapshot's tail window), so
// there is no longer one literal to parse out of the .bb source. Comparing
// VERDICTS on shared fixture panes is the comparison that survives that
// (and any future) reshaping of either side's actual matching strategy -
// the ticket's own direction. The fixtures are the marker's one home
// (specs/features/fixtures/BL-997/) - this file, like the ticket YAML and
// feature file, contains zero occurrences of the literal itself.
//
// Two-layer rule: this is TEST code invoking the real `bb` classifier for
// comparison, never PRODUCTION code shelling out to it - agentPaneState.ts
// itself is untouched.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { isPaneActivelyProcessing } = require('../out/panel/agentPaneState');
const { checkAgreement } = require('../../specs/pipeline/steps/lib/bl997AgreementCheck');

const REPO_ROOT = path.join(__dirname, '..', '..');
const FIXTURE_DIR = path.join(REPO_ROOT, 'specs', 'features', 'fixtures', 'BL-997');
const RUNNER = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'test', 'bl997_classify_pane_runner.bb');

const FIXTURES = {
  'a live turn-status frame': 'live-turn-status-frame.txt',
  'an idle prompt': 'idle-prompt.txt',
  'an idle prompt quoting the marker': 'idle-prompt-quoting-the-marker.txt',
};

function babashkaVerdict(fixturePath) {
  return execFileSync('bb', [RUNNER, fixturePath], { encoding: 'utf8' }).trim() === 'true';
}

function typescriptVerdict(fixturePath) {
  return isPaneActivelyProcessing(fs.readFileSync(fixturePath, 'utf8'));
}

// ── both-sides-agree-01 ──────────────────────────────────────────────────
for (const [name, file] of Object.entries(FIXTURES)) {
  test(`BL-997: the swarm classifier and the extension-host classifier agree on "${name}"`, () => {
    const fixturePath = path.join(FIXTURE_DIR, file);
    const babashka = babashkaVerdict(fixturePath);
    const typescript = typescriptVerdict(fixturePath);
    try {
      checkAgreement(babashka, typescript);
    } catch (err) {
      // Invariant 2: name BOTH verdicts on failure (checkAgreement's own
      // contract) - re-thrown with the fixture name so a suite-wide failure
      // report still says WHICH pane disagreed.
      throw new Error(`"${name}" (${file}): ${err.message}`);
    }
  });
}

// ── drift-is-caught-and-named-02 ─────────────────────────────────────────
// A definition changed on one side alone must fail the check, and the
// failure must name both literals - proven here against SYNTHETIC verdicts
// (never by mutating the real classifiers mid-test-run), which is exactly
// what this scenario's Given describes: "the swarm-side busy definition no
// longer matches the extension-host one" - a disagreement, not necessarily
// today's. See bl997BusyMarkerAgreement.property.test.js for the generative
// sweep over both disagreement directions (BL-654 invariant 2).
test('BL-997: the agreement check itself fails, and names both verdicts, when the two sides disagree', () => {
  assert.throws(
    () => checkAgreement(true, false),
    (err) => {
      assert.match(err.message, /babashka=true/);
      assert.match(err.message, /typescript=false/);
      return true;
    }
  );
});

// Non-vacuity, proven live and recorded here rather than only in a commit
// message (BL-654's own convention, applied to a Node assertion test):
// with the CURRENT chase_sweep_lib.bb (post-BL-970) and the CURRENT
// agentPaneState.ts, "an idle prompt quoting the marker" is EXACTLY where
// the two sides diverge right now - the drift this ticket exists to catch
// was not hypothetical when this parcel was built. See this ticket's own
// coder handoff/notes for the follow-up this finding spawned.
