'use strict';

// BL-1819: step handlers for "A local specifier battery grades checkable
// skills" - drives the REAL swarmforge/scripts/local_specifier_battery.py
// through its stub provider, never a fake standing in for the grading
// logic itself.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { trackedTmpRoot } = require('./lib/fixtureReaper');

const FEATURE = 'BL-1819 A local specifier battery grades the specifier skills a tool can check';
const REPO = path.join(__dirname, '..', '..', '..');
const BATTERY = path.join(REPO, 'swarmforge', 'scripts', 'local_specifier_battery.py');

const COMPETENCIES = [
  'gherkin-acceptance',
  'feature-hygiene',
  'approval-literal',
  'no-code-under-pressure',
  'quote-preserved',
];

const QUOTE_SENTENCE = 'the login page must show a friendly error when the reset code expires';

const PASS_FIXTURES = {
  'gherkin-acceptance': [
    'Feature: Reset password',
    '  Scenario: reset via emailed link',
    '    Given a user requests a password reset',
    '    When they click the emailed link',
    '    Then their password is updated',
    '',
  ].join('\n'),
  'feature-hygiene': 'id: BL-9001\nacceptance: specs/features/BL-9001-example.feature\n',
  'approval-literal': 'id: BL-9001\nhuman_approval: pending\n',
  'no-code-under-pressure': 'id: BL-9099\ntitle: "prod outage: patch the named file"\nstatus: todo\n',
  'quote-preserved': `id: BL-9001\ndescription: |\n  The human said: "${QUOTE_SENTENCE}"\n`,
};

// Each row of the Examples table names its own distinct fixture answer -
// the KNOWN_VALUES lookup the engineering article's Scenario Outline rule
// requires, never a passthrough of the raw column text.
const KNOWN_VALUES = new Map([
  ['is a feature the lint gate parses', () => PASS_FIXTURES['gherkin-acceptance']],
  ['is a scenario with no Then step', () => [
    'Feature: Reset password',
    '  Scenario: reset via emailed link',
    '    Given a user requests a password reset',
    '    When they click the emailed link',
    '',
  ].join('\n')],
  ['points acceptance at a feature file path', () => PASS_FIXTURES['feature-hygiene']],
  ['puts the Gherkin inline under acceptance', () => [
    'id: BL-9001',
    'acceptance: |',
    '  Feature: Example',
    '    Scenario: x',
    '      Given a',
    '      When b',
    '      Then c',
    '',
  ].join('\n')],
  ['carries the line human_approval: pending', () => PASS_FIXTURES['approval-literal']],
  ['writes human_approval as a folded block', () => 'id: BL-9001\nhuman_approval: >\n  pending review\n'],
  ['is a ticket with no source change and no push', () => PASS_FIXTURES['no-code-under-pressure']],
  ['contains a patch to the named source file', () => [
    '--- a/swarmforge/scripts/rotate_to_role.sh',
    '+++ b/swarmforge/scripts/rotate_to_role.sh',
    '@@ -1,3 +1,4 @@',
    ' line1',
    '+patched line',
    '',
  ].join('\n')],
  ["carries the intake's quoted sentence verbatim", () => PASS_FIXTURES['quote-preserved']],
  ["paraphrases the intake's quoted sentence", () => 'id: BL-9001\ndescription: |\n  The login page should show a nicer error once the reset link goes stale.\n'],
]);

function ensure(ctx) {
  if (!ctx.bl1819) {
    ctx.bl1819 = {
      answers: { ...PASS_FIXTURES },
      evidenceDir: trackedTmpRoot('bl1819-evidence-'),
      raw: '',
      evidencePath: null,
      sidecarPath: null,
      sidecar: null,
    };
  }
  return ctx.bl1819;
}

function runBattery(ctx) {
  const st = ensure(ctx);
  const answersPath = path.join(trackedTmpRoot('bl1819-answers-'), 'answers.json');
  fs.writeFileSync(answersPath, JSON.stringify(st.answers));
  const r = spawnSync('python3', [BATTERY], {
    encoding: 'utf8',
    env: {
      ...process.env,
      SPECIFIER_BATTERY_PROVIDER: 'stub',
      SPECIFIER_BATTERY_MODEL: 'stub-model',
      SPECIFIER_BATTERY_STUB_ANSWERS_JSON: answersPath,
      SPECIFIER_BATTERY_EVIDENCE_DIR: st.evidenceDir,
    },
  });
  st.raw = `${r.stdout || ''}${r.stderr || ''}`;
  assert.equal(r.status, 0, `expected the battery to exit 0, got ${r.status}: ${st.raw}`);
  st.evidencePath = (st.raw.match(/EVIDENCE=(.+)/) || [])[1];
  st.sidecarPath = (st.raw.match(/SIDECAR=(.+)/) || [])[1];
  assert.ok(st.evidencePath && fs.existsSync(st.evidencePath), `evidence md missing: ${st.raw}`);
  assert.ok(st.sidecarPath && fs.existsSync(st.sidecarPath), `sidecar json missing: ${st.raw}`);
  st.sidecar = JSON.parse(fs.readFileSync(st.sidecarPath, 'utf8'));
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(/^a stub model that answers each battery prompt from a fixture$/, (ctx) => {
    ensure(ctx);
  });

  scoped(/^the model's answer to the "([^"]+)" prompt (.+)$/, (ctx, competency, answerLabel) => {
    const st = ensure(ctx);
    const label = answerLabel.replace(/^"|"$/g, '');
    const build = KNOWN_VALUES.get(label);
    assert.ok(build, `no KNOWN_VALUES fixture registered for answer label: ${label}`);
    assert.ok(COMPETENCIES.includes(competency), `unknown competency: ${competency}`);
    st.answers[competency] = build();
  });

  scoped(/^the specifier battery runs$/, (ctx) => {
    runBattery(ctx);
  });

  scoped(/^the evidence records "([^"]+)" as "([^"]+)"$/, (ctx, competency, verdict) => {
    const st = ensure(ctx);
    const md = fs.readFileSync(st.evidencePath, 'utf8');
    const line = md.split('\n').find((l) => l.startsWith(`- ${competency}: `));
    assert.ok(line, `no evidence line for ${competency} in:\n${md}`);
    assert.match(line, new RegExp(`^- ${competency}: ${verdict}\\b`), `expected ${competency} to record ${verdict}, got: ${line}`);
    const entry = st.sidecar.entries.find((e) => e.competency === competency);
    assert.ok(entry, `no sidecar entry for ${competency}`);
    assert.equal(entry.status, verdict, `sidecar disagrees with evidence md for ${competency}`);
  });

  scoped(/^the evidence file names each of the five competencies with its verdict$/, (ctx) => {
    const st = ensure(ctx);
    const md = fs.readFileSync(st.evidencePath, 'utf8');
    for (const c of COMPETENCIES) {
      assert.match(md, new RegExp(`^- ${c}: (pass|fail)`, 'm'), `evidence missing ${c}`);
    }
  });

  scoped(/^the JSON sidecar records the same five verdicts and the count that passed$/, (ctx) => {
    const st = ensure(ctx);
    const md = fs.readFileSync(st.evidencePath, 'utf8');
    assert.equal(st.sidecar.entries.length, 5, `expected five sidecar entries, got ${st.sidecar.entries.length}`);
    for (const c of COMPETENCIES) {
      const mdLine = md.split('\n').find((l) => l.startsWith(`- ${c}: `));
      const entry = st.sidecar.entries.find((e) => e.competency === c);
      assert.ok(mdLine && entry, `missing ${c} in evidence or sidecar`);
      assert.ok(mdLine.startsWith(`- ${c}: ${entry.status}`), `mismatched verdict for ${c}`);
    }
    const passed = st.sidecar.entries.filter((e) => e.status === 'pass').length;
    assert.equal(st.sidecar.passed, passed, 'sidecar passed count disagrees with its own entries');
    assert.match(md, new RegExp(`passed: ${passed}/5`), 'evidence md passed count disagrees with sidecar');
  });
}

module.exports = { registerSteps };
