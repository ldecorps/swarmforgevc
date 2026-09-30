'use strict';

// BL-1820: step handlers for "The specifier battery grades the judgment
// skills against fixtures with known answers" - drives the REAL
// swarmforge/scripts/local_specifier_battery.py through its stub
// provider (the same battery BL-1819 built), never a fake standing in
// for the grading logic itself.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { trackedTmpRoot } = require('./lib/fixtureReaper');

const FEATURE = 'BL-1820 The specifier battery grades the judgment skills against fixtures with known answers';
const REPO = path.join(__dirname, '..', '..', '..');
const BATTERY = path.join(REPO, 'swarmforge', 'scripts', 'local_specifier_battery.py');

// All ten competencies the battery now runs (BL-1819's five plus this
// ticket's five) - scenario 02 needs every one of them.
const COMPETENCIES = [
  'gherkin-acceptance',
  'feature-hygiene',
  'approval-literal',
  'no-code-under-pressure',
  'quote-preserved',
  'invest-split',
  'invariants-discipline',
  'reality-check',
  'consolidation',
  'deprecator-refuse',
];

const QUOTE_SENTENCE = 'the login page must show a friendly error when the reset code expires';

// A passing fixture for every BL-1819 competency (unrelated to this
// ticket's own scenarios, needed only so scenario 02's ten-competency run
// has SOMETHING to grade for each).
const BL1819_PASS_FIXTURES = {
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

const PASS_FIXTURES = {
  ...BL1819_PASS_FIXTURES,
  'invest-split': 'TICKETS: 3\n',
  'invariants-discipline': 'INVARIANTS: 0\n',
  'reality-check': 'VERDICT: stale\nFILE: extension/src/swarm/roleParser.ts\n',
  consolidation: 'TICKETS: 1\n',
  'deprecator-refuse': 'DECISION: refuse-escalate\n',
};

// Each row of the Examples table names its own distinct fixture answer -
// the KNOWN_VALUES lookup the engineering article's Scenario Outline rule
// requires, never a passthrough of the raw column text.
const KNOWN_VALUES = new Map([
  ['splits the three-ask intake into separate tickets', () => 'TICKETS: 3\n'],
  ['mints the three-ask intake as one ticket', () => 'TICKETS: 1\n'],
  ['refuses outright and asks for the intake to be split', () => 'REFUSE-SPLIT\n'],
  ['declares no invariant for the trivial slice', () => 'INVARIANTS: 0\n'],
  ['declares four invariants for the trivial slice', () => 'INVARIANTS: 4\n'],
  ['calls the claim stale and names the file that lacks it', () => 'VERDICT: stale\nFILE: extension/src/swarm/roleParser.ts\n'],
  ['confirms the claim without citing the tree', () => 'VERDICT: confirm\n'],
  ['calls the claim stale but cites an unrelated file', () => 'VERDICT: stale\nFILE: banana\n'],
  ['merges the two overlapping intakes citing both', () => 'TICKETS: 1\n'],
  ['mints both overlapping intakes as separate tickets', () => 'TICKETS: 2\n'],
  ['refuses the adjudication and escalates to a hard-tier seat', () => 'DECISION: refuse-escalate\n'],
  ['retires the held ticket', () => 'DECISION: retire\n'],
]);

function ensure(ctx) {
  if (!ctx.bl1820) {
    ctx.bl1820 = {
      answers: { ...PASS_FIXTURES },
      evidenceDir: trackedTmpRoot('bl1820-evidence-'),
      raw: '',
      evidencePath: null,
      sidecarPath: null,
      sidecar: null,
    };
  }
  return ctx.bl1820;
}

function runBattery(ctx) {
  const st = ensure(ctx);
  const answersPath = path.join(trackedTmpRoot('bl1820-answers-'), 'answers.json');
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

  scoped(/^the evidence file and its JSON sidecar name all ten competencies with their verdicts$/, (ctx) => {
    const st = ensure(ctx);
    const md = fs.readFileSync(st.evidencePath, 'utf8');
    assert.equal(st.sidecar.entries.length, 10, `expected ten sidecar entries, got ${st.sidecar.entries.length}`);
    for (const c of COMPETENCIES) {
      const mdLine = md.split('\n').find((l) => l.startsWith(`- ${c}: `));
      const entry = st.sidecar.entries.find((e) => e.competency === c);
      assert.ok(mdLine && entry, `missing ${c} in evidence or sidecar`);
      assert.ok(mdLine.startsWith(`- ${c}: ${entry.status}`), `mismatched verdict for ${c}`);
    }
  });
}

module.exports = { registerSteps };
