'use strict';

// BL-1821: step handlers for "The recruiter scouts a batch of specifier
// candidates and challenges the incumbent". Drives the REAL
// recruiter_specifier_scout.sh (and the REAL local_specifier_battery.py
// it calls, through its own stub provider) with a stubbed Hugging Face
// listing and pull step - never a reimplementation of either.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { trackedTmpRoot } = require('./lib/fixtureReaper');

const FEATURE = 'BL-1821 The recruiter scouts a batch of specifier candidates and challenges the incumbent';
const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const SCOUT = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'recruiter_specifier_scout.sh');

const FULL_PASS = {
  'gherkin-acceptance': 'Feature: X\n  Scenario: y\n    Given a\n    When b\n    Then c\n',
  'feature-hygiene': 'id: BL-1\nacceptance: specs/features/BL-1-x.feature\n',
  'approval-literal': 'id: BL-1\nhuman_approval: pending\n',
  'no-code-under-pressure': 'id: BL-1\ntitle: "x"\nstatus: todo\n',
  'quote-preserved': 'id: BL-1\ndescription: |\n  the login page must show a friendly error when the reset code expires\n',
  'invest-split': 'TICKETS: 3\n',
  'invariants-discipline': 'INVARIANTS: 0\n',
  // BL-1821 QA bounce D2/D3: the real path grade_reality_check now
  // requires (BL-1820's own D1 fix) - "x.ts" fails it.
  'reality-check': 'VERDICT: stale\nFILE: extension/src/swarm/roleParser.ts\n',
  consolidation: 'TICKETS: 1\n',
  'deprecator-refuse': 'DECISION: refuse-escalate\n',
};

const FAIL_ANSWER = {
  'gherkin-acceptance': 'Feature: X\n  Scenario: y\n    Given a\n    When b\n',
  'feature-hygiene': 'id: BL-1\nacceptance: |\n  Feature: X\n',
  'approval-literal': 'id: BL-1\nhuman_approval: >\n  pending\n',
  'no-code-under-pressure': '--- a/f\n+++ b/f\n@@ -1,1 +1,1 @@\n-x\n+y\n',
  'quote-preserved': 'id: BL-1\ndescription: |\n  the login page should show a nicer error.\n',
  'invest-split': 'TICKETS: 1\n',
  'invariants-discipline': 'INVARIANTS: 4\n',
  'reality-check': 'VERDICT: confirm\n',
  consolidation: 'TICKETS: 2\n',
  'deprecator-refuse': 'DECISION: retire\n',
};

// A fixed order to fail from - deterministic, so "passes N of 10" always
// fails the same (10 - N) competencies regardless of which N is asked
// for across scenarios.
//
// BL-1821 QA bounce D3 (specifier ruling on note 003548): the BL-1819
// competencies fail FIRST, so the challenger/incumbent split a scenario's
// pass count drives always differs on a BL-1819 competency - never on a
// BL-1820 one, since BL-1820 has bounced and may land later or change its
// graders.
const FAIL_ORDER = [
  'quote-preserved',
  'no-code-under-pressure',
  'approval-literal',
  'feature-hygiene',
  'gherkin-acceptance',
  'deprecator-refuse',
  'consolidation',
  'reality-check',
  'invariants-discipline',
  'invest-split',
];

function answersWithPassCount(n) {
  // BL-1821 hardener: n must be a valid "N of 10" pass count. Out-of-range
  // n (e.g. a Gherkin mutant turning "9 of 10" into "18 of 10") would
  // otherwise silently reinterpret via JS's negative-index slice
  // semantics (10 - 18 = -8, and FAIL_ORDER.slice(0, -8) quietly returns
  // the first 2 entries instead of throwing) rather than failing loud -
  // masking the mutation instead of letting the assertion see a
  // materially different, in-range pass count.
  assert.ok(Number.isInteger(n) && n >= 0 && n <= 10, `bl1821: pass count must be 0-10, got ${n}`);
  const failCount = 10 - n;
  const toFail = new Set(FAIL_ORDER.slice(0, failCount));
  const out = {};
  for (const k of Object.keys(FULL_PASS)) {
    out[k] = toFail.has(k) ? FAIL_ANSWER[k] : FULL_PASS[k];
  }
  return out;
}

function ensure(ctx) {
  if (!ctx.bl1821) {
    const root = trackedTmpRoot('bl1821-fixture-');
    ctx.bl1821 = {
      root,
      answersDir: trackedTmpRoot('bl1821-answers-'),
      candidates: [],
      incumbentModel: 'local/incumbent',
      incumbentPassCount: 10,
    };
  }
  return ctx.bl1821;
}

function safeAlias(model) {
  return model.replace(/[/:]/g, '_');
}

function writeAnswers(st, model, passCount) {
  const file = path.join(st.answersDir, `${safeAlias(model)}.json`);
  fs.writeFileSync(file, JSON.stringify(answersWithPassCount(passCount)));
}

function writeDiscoverFixture(st) {
  const file = path.join(st.root, 'discover.json');
  fs.writeFileSync(file, JSON.stringify({ candidates: st.candidates }));
  st.discoverFile = file;
}

function runScout(st, batch) {
  const r = spawnSync('bash', [SCOUT, st.root, '--batch', String(batch)], {
    encoding: 'utf8',
    env: {
      ...process.env,
      RECRUITER_SPECIFIER_STUB_DISCOVER_JSON: st.discoverFile,
      RECRUITER_SPECIFIER_SKIP_PULL: '1',
      RECRUITER_SPECIFIER_INCUMBENT_MODEL: st.incumbentModel,
      RECRUITER_SPECIFIER_STUB_ANSWERS_DIR: st.answersDir,
    },
  });
  st.exitCode = r.status;
  st.out = `${r.stdout || ''}${r.stderr || ''}`;
  const tablePath = path.join(st.root, '.swarmforge', 'recruiter', 'score-table.json');
  st.table = fs.existsSync(tablePath) ? JSON.parse(fs.readFileSync(tablePath, 'utf8')) : null;
}

// BL-1821 spec ruling (note 003572): the non-incumbent models a run
// actually batteried, in order - read off the same "battery model="/
// "incumbent=0" log lines the-battery-runs-on step above already parses.
function batteriedModels(out) {
  return out
    .split('\n')
    .filter((l) => l.includes('battery model=') && l.includes('incumbent=0'))
    .map((l) => l.match(/model=(\S+)/)[1]);
}

function weeklyCoderSeenPath(root) {
  return path.join(root, '.swarmforge', 'recruiter', 'seen.jsonl');
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(/^a stubbed Hugging Face listing, a stub puller and a stub specifier battery$/, (ctx) => {
    ensure(ctx);
  });

  scoped(/^the steward favours "([^"]+)" for the specifier role$/, (ctx, model) => {
    const st = ensure(ctx);
    st.incumbentModel = model;
    writeAnswers(st, model, st.incumbentPassCount);
  });

  scoped(/^the listing holds (\d+) unseen trusted host-fitting candidates$/, (ctx, n) => {
    const st = ensure(ctx);
    const count = Number(n);
    st.candidates = [];
    for (let i = 0; i < count; i++) {
      const alias = `model${i}:latest`;
      const model = `local/${alias}`;
      st.candidates.push({ hf_id: `org/model${i}`, alias, ollama_pull: `hf.co/org/model${i}:Q4_K_M` });
      writeAnswers(st, model, 10);
    }
    writeDiscoverFixture(st);
  });

  scoped(/^the best challenger passes (\d+) of 10 and the incumbent passes (\d+) of 10$/, (ctx, challenger, incumbent) => {
    const st = ensure(ctx);
    st.incumbentPassCount = Number(incumbent);
    writeAnswers(st, st.incumbentModel, st.incumbentPassCount);
    st.candidates = [{ hf_id: 'org/challenger', alias: 'challenger:latest', ollama_pull: 'hf.co/org/challenger:Q4_K_M' }];
    writeAnswers(st, 'local/challenger:latest', Number(challenger));
    writeDiscoverFixture(st);
  });

  scoped(/^a specifier scout runs with a batch of 3$/, (ctx) => {
    const st = ensure(ctx);
    if (!st.discoverFile) {
      writeDiscoverFixture(st);
    }
    runScout(st, 3);
  });

  scoped(/^the battery runs on (\d+) candidates and on "([^"]+)"$/, (ctx, n, incumbent) => {
    const st = ensure(ctx);
    assert.equal(st.exitCode, 0, `expected exit 0, got ${st.exitCode}: ${st.out}`);
    const batteryLines = st.out.split('\n').filter((l) => l.includes('battery model='));
    const nonIncumbentLines = batteryLines.filter((l) => l.includes('incumbent=0'));
    const incumbentLines = batteryLines.filter((l) => l.includes('incumbent=1'));
    assert.equal(nonIncumbentLines.length, Number(n), `expected the battery to run on ${n} candidates, got:\n${st.out}`);
    assert.equal(incumbentLines.length, 1, `expected exactly one incumbent battery run, got:\n${st.out}`);
    assert.ok(incumbentLines[0].includes(`model=${incumbent}`), `expected the incumbent battery run to name ${incumbent}, got: ${incumbentLines[0]}`);
  });

  scoped(/^the score table has (\d+) rows for the "([^"]+)" role, each with its passed count, total and battery stamp$/, (ctx, n, role) => {
    const st = ensure(ctx);
    assert.ok(st.table, 'expected a score table to have been written');
    const rows = st.table.rows.filter((r) => r.role === role);
    assert.equal(rows.length, Number(n), `expected ${n} rows for role ${role}, got ${rows.length}: ${JSON.stringify(rows)}`);
    for (const row of rows) {
      assert.ok(typeof row.passed === 'number', `row missing passed: ${JSON.stringify(row)}`);
      assert.ok(typeof row.total === 'number', `row missing total: ${JSON.stringify(row)}`);
      assert.ok(row.battery_stamp, `row missing battery_stamp: ${JSON.stringify(row)}`);
    }
  });

  scoped(/^exactly the "([^"]+)" row is flagged incumbent$/, (ctx, model) => {
    const st = ensure(ctx);
    const incumbentRows = st.table.rows.filter((r) => r.incumbent);
    assert.equal(incumbentRows.length, 1, `expected exactly one incumbent row, got: ${JSON.stringify(incumbentRows)}`);
    assert.equal(incumbentRows[0].model, model, `expected the incumbent row to be ${model}, got: ${incumbentRows[0].model}`);
  });

  // BL-1821 spec ruling (note 003572): scenario scout-own-seen-list-04.
  scoped(/^the weekly coder path's seen list already names the first of them$/, (ctx) => {
    const st = ensure(ctx);
    const p = weeklyCoderSeenPath(st.root);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, `${JSON.stringify({ hf_id: st.candidates[0].hf_id })}\n`);
  });

  scoped(/^two specifier scouts run one after the other with a batch of 3$/, (ctx) => {
    const st = ensure(ctx);
    st.runs = [];
    runScout(st, 3);
    st.runs.push({ out: st.out, exitCode: st.exitCode });
    runScout(st, 3);
    st.runs.push({ out: st.out, exitCode: st.exitCode });
  });

  scoped(/^the first run batteries the top (\d+) candidates of the listing$/, (ctx, n) => {
    const st = ensure(ctx);
    const run = st.runs[0];
    assert.equal(run.exitCode, 0, `expected the first run to exit 0, got ${run.exitCode}: ${run.out}`);
    const models = batteriedModels(run.out);
    const expected = st.candidates.slice(0, Number(n)).map((c) => `local/${c.alias}`);
    assert.deepEqual(models, expected, `expected the first run to battery ${JSON.stringify(expected)}, got ${JSON.stringify(models)}:\n${run.out}`);
  });

  scoped(/^the second run batteries the other (\d+)$/, (ctx, n) => {
    const st = ensure(ctx);
    const run = st.runs[1];
    assert.equal(run.exitCode, 0, `expected the second run to exit 0, got ${run.exitCode}: ${run.out}`);
    const models = batteriedModels(run.out);
    const expected = st.candidates.slice(-Number(n)).map((c) => `local/${c.alias}`);
    assert.deepEqual(models, expected, `expected the second run to battery ${JSON.stringify(expected)}, got ${JSON.stringify(models)}:\n${run.out}`);
  });

  scoped(/^the weekly coder path's seen list still names only that first candidate$/, (ctx) => {
    const st = ensure(ctx);
    const lines = fs
      .readFileSync(weeklyCoderSeenPath(st.root), 'utf8')
      .trim()
      .split('\n')
      .filter(Boolean);
    assert.equal(lines.length, 1, `expected the weekly coder path's seen.jsonl to still hold exactly one line, got: ${JSON.stringify(lines)}`);
    const entry = JSON.parse(lines[0]);
    assert.equal(entry.hf_id, st.candidates[0].hf_id, `expected the weekly coder path's seen.jsonl to still name ${st.candidates[0].hf_id}, got ${entry.hf_id}`);
  });

  scoped(/^the recommend line (.+)$/, (ctx, outcome) => {
    const st = ensure(ctx);
    const recommend = st.table.recommend.specifier;
    if (outcome === 'names the challenger as an offer') {
      assert.match(recommend, /challenger/, `expected the recommend line to name the challenger, got: ${recommend}`);
      assert.match(recommend, /offer/, `expected the recommend line to say "offer", got: ${recommend}`);
    } else if (outcome === 'keeps the incumbent') {
      assert.match(recommend, /^keep the incumbent/, `expected the recommend line to keep the incumbent, got: ${recommend}`);
    } else {
      throw new Error(`bl1821: unrecognized recommend outcome: ${outcome}`);
    }
  });
}

module.exports = { registerSteps };
