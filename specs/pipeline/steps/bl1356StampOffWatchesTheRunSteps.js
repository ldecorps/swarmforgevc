'use strict';

// BL-1356: six BL-654 stamp-off property tests encoded "a green suite never
// writes a decision into the hotfix ledger" by pinning their row's CURRENT
// state literal. A ledger row advancing IS the workflow, so each was written
// pre-red - and because the property lane's commit guard refuses every commit
// touching extension/src/ or a property file repo-wide on a non-allowlisted
// red, one row advancing jammed the whole swarm's commit gate.
//
// Human ruling (option 1): keep the invariants on the live ledger, assert
// non-mutation across the run instead of a state literal.
//
// Scenarios 01-03 drive the REAL shared helper the six files now call, against
// a generated ledger on disk - the helper's ledger path is injected so proving
// the gate still bites never writes to the live file. Scenario 04 reads the
// REAL stamp-off files and the REAL standing allowlist.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const EXT_TEST = path.join(REPO_ROOT, 'extension', 'test');
const ALLOWLIST = path.join(
  REPO_ROOT, 'swarmforge', 'scripts', 'property_suite_standing_allowlist.tsv'
);
const { assertRunWritesNoDecision } = require(path.join(EXT_TEST, 'helpers', 'stampOff.js'));

const FEATURE = 'A stamp-off invariant watches what the run writes, not what the ledger currently says';
const HOTFIX = 'abc1234567';

// The scenarios' own words for the row's starting state. Explicit KNOWN_VALUES:
// an unrecognised row fails rather than passing through unchecked.
const STATES = ['stamp-open', 'pending', 'awaiting-human'];

// Every stamp-off property file this ticket owns, plus the one already fixed in
// flight. Named rather than globbed: a file silently dropped from a glob would
// make scenario 04 pass by checking less.
const STAMP_OFF_FILES = [
  'bl1113CursorHotfixStampOff.property.test.js',
  'bl1115MainSyncStatusCliStampOff.property.test.js',
  'bl1116ExtensionWipHotfixStampOff.property.test.js',
  'bl1117PipelineBoardNumericNbspStampOff.property.test.js',
  'bl1136BabysitterdCursorForgeStampOff.property.test.js',
  'bl1323StampOffInvariants.property.test.js',
];

/** Source with comments removed, so prose about the old defect is not read as it. */
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

function ledgerFixture(state) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bl1356-acceptance-'));
  const file = path.join(dir, 'hotfix-ledger.yaml');
  fs.writeFileSync(
    file,
    [
      'entries:',
      '- commit: 0000000000',
      '  state: certified',
      '  human_decision: certified',
      '  decided_at: 2026-01-01',
      `- commit: ${HOTFIX}`,
      `  state: ${state}`,
      '  stamp_ticket: BL-9999',
      '  human_decision: null',
      '  decided_at: null',
      '- commit: ffffffffff',
      '  state: waived',
      '',
    ].join('\n')
  );
  return { dir, file };
}

/** Edit the WATCHED row only - a whole-file replace lands on a neighbour. */
function rewriteWatchedRow(file, replace) {
  const text = fs.readFileSync(file, 'utf8');
  const start = text.indexOf(`- commit: ${HOTFIX}`);
  const rest = text.slice(start);
  const end = rest.indexOf('\n- commit:');
  const row = end === -1 ? rest : rest.slice(0, end);
  const next = replace(row);
  assert.notEqual(next, row, 'the fixture write changed nothing, so nothing would be under test');
  fs.writeFileSync(file, text.slice(0, start) + next + (end === -1 ? '' : rest.slice(end)));
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  // ── Background ──────────────────────────────────────────────────────────
  scoped(/^a hotfix ledger row that a stamp-off invariant watches$/, (ctx) => {
    ctx.bl1356 = { hotfix: HOTFIX, write: null };
  });

  // ── Given ───────────────────────────────────────────────────────────────
  scoped(/^the row's state is "(.+)"$/, (ctx, state) => {
    assert.ok(STATES.includes(state), `unknown row state: ${state}`);
    ctx.bl1356.state = state;
  });

  scoped(/^the row's human_decision is null$/, (ctx) => {
    ctx.bl1356.state = ctx.bl1356.state || 'stamp-open';
    ctx.bl1356.humanDecisionIsNull = true;
  });

  scoped(/^every stamp-off property file in the property lane$/, (ctx) => {
    ctx.bl1356.files = STAMP_OFF_FILES;
  });

  // ── When ────────────────────────────────────────────────────────────────
  scoped(/^the property suite runs without writing to the ledger$/, (ctx) => {
    ctx.bl1356.write = null;
  });

  scoped(/^the property suite run writes "(.+)" into the row's state$/, (ctx, value) => {
    ctx.bl1356.write = (row) => row.replace(/^  state: .*$/m, `  state: ${value}`);
  });

  scoped(/^the property suite run writes a human_decision into the row$/, (ctx) => {
    assert.equal(ctx.bl1356.humanDecisionIsNull, true, 'the row must start undecided for this to be a write');
    ctx.bl1356.write = (row) => row.replace('human_decision: null', 'human_decision: certified');
  });

  scoped(/^the lane runs against a ledger whose watched rows have all advanced$/, (ctx) => {
    // Read, not run: the lane itself takes ~145s and scenario 04 is about what
    // the FILES assert, not about one execution of them. A file that still pins
    // a moving state literal is red the moment its row advances, whether or not
    // this run happens to catch it in that state.
    //
    // Comments are stripped first: these files now EXPLAIN the old pin in
    // prose ("`state: pending` was pinned as a literal"), and a raw grep reads
    // the explanation as the defect. What is asserted is what executes.
    ctx.bl1356.pins = ctx.bl1356.files
      .map((name) => ({ name, src: stripComments(fs.readFileSync(path.join(EXT_TEST, name), 'utf8')) }))
      // Both spellings the family used - a grep for the literal form alone
      // finds three of six (the ticket's own MEASURE WITH BOTH SPELLINGS note).
      .filter(({ src }) => /state:[^/]{0,12}(pending|stamp-open)/.test(src))
      .map(({ name }) => name);
  });

  // ── Then ────────────────────────────────────────────────────────────────
  scoped(/^the stamp-off invariant (passes|fails)$/, (ctx, expected) => {
    const { dir, file } = ledgerFixture(ctx.bl1356.state);
    try {
      const work = ctx.bl1356.write ? () => rewriteWatchedRow(file, ctx.bl1356.write) : () => {};
      let outcome = 'passes';
      let detail = '';
      try {
        assertRunWritesNoDecision(HOTFIX, work, { ledgerPath: file });
      } catch (err) {
        outcome = 'fails';
        detail = err.message;
      }
      assert.equal(outcome, expected, `row at ${ctx.bl1356.state}: ${detail}`);
      if (expected === 'fails') {
        assert.match(detail, /wrote a decision into|changed /, detail);
      }
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  scoped(/^no stamp-off file is reported as a failing suite$/, (ctx) => {
    assert.deepEqual(
      ctx.bl1356.pins,
      [],
      `these stamp-off files still pin a moving ledger state, so they go red on a legitimate advance: ${ctx.bl1356.pins.join(', ')}`
    );
  });

  scoped(/^the standing allowlist carries no stamp-off entry$/, () => {
    const rows = fs
      .readFileSync(ALLOWLIST, 'utf8')
      .split('\n')
      .filter((line) => line && !line.startsWith('#'))
      .map((line) => line.split('\t')[0]);
    const stampOff = rows.filter((f) => STAMP_OFF_FILES.some((s) => f.endsWith(s)));
    assert.deepEqual(
      stampOff,
      [],
      `the allowlist still absorbs stamp-off files, hiding a future genuine regression: ${stampOff.join(', ')}`
    );
  });
}

module.exports = { registerSteps };
