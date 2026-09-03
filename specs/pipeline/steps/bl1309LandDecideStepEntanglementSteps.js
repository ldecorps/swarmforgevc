'use strict';

// BL-1309: `land_main_publish.sh --decide-only` is the only landing step
// QA.prompt makes mandatory, and it asked solely whether the push would
// fast-forward — never whose work the tip carried. `main`'s first-parent chain
// IS the QA branch, so a plain push of that tip shipped every ticket ever
// merged into it. Verified by reflog on 2026-08-31: BL-1308's own land pushed
// BL-1300, held four commits earlier for a human ruling never given.
//
// Human ruling (2026-09-03, the ticket's ruling_options option 1): refuse
// EVERY entangled tip. There is no withheld-vs-ordinary predicate to get
// wrong.
//
// Every scenario runs the REAL script over a REAL repository with a REAL bare
// origin, through lib/bl1309LandDecideFixtureCli.sh. A self-remote would let
// the script's own fetch refresh origin/main back to HEAD and dissolve the
// entanglement before it was measured, and a mocked git layer could not
// exhibit the defect at all.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const FIXTURE_CLI = path.join(__dirname, 'lib', 'bl1309LandDecideFixtureCli.sh');
const REPO_ROOT = path.join(__dirname, '..', '..', '..');

const FEATURE = 'The mandatory land decide step refuses a tip carrying an unlanded ticket';

const WITHHELD_TICKET = 'BL-9003';

// The scenarios' own words, mapped to the fixture shape each one is built as.
// Explicit KNOWN_VALUES: an unrecognised row fails rather than passing through
// unchecked.
const SIBLING_STATES = {
  'no ticket but the one being landed': 'clean',
  'a ticket whose content is on origin/main': 'landed-sibling',
  'a ticket whose content is not there yet': 'unlanded-sibling',
};

const UNREADABLE_INPUTS = {
  'the detector cannot be run at all': 'no-detector',
  'the range against origin/main is unreadable': 'unreadable-range',
};

const VERDICTS = { proceed: 'proceed', refuse: 'refuse' };

function runFixture(shape) {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'bl1309-'));
  try {
    const out = execFileSync('bash', [FIXTURE_CLI, work, shape], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      timeout: 300_000,
    });
    return JSON.parse(out.trim().split('\n').pop());
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}

/**
 * What the step actually reported, read the way QA reads it: a refusal is the
 * documented non-zero status AND no push advice, never the marker text alone.
 */
function verdictOf(report) {
  if (report.exit === 0 && report.advises) return 'proceed';
  if (report.exit === 3 && !report.advises) return 'refuse';
  throw new Error(`neither proceed nor refuse: ${JSON.stringify(report)}`);
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  // ── Background ──────────────────────────────────────────────────────────
  // Both lines describe the fixture every scenario builds; they are asserted
  // against the built repository in the When step, once the shape under test
  // has been chosen.
  scoped(/^a branch tip that is a descendant of origin\/main$/, (ctx) => {
    ctx.bl1309 = { descendantOfOrigin: true };
  });

  scoped(/^a ticket being landed from that tip$/, (ctx) => {
    ctx.bl1309.landingTicket = 'BL-9001';
  });

  // ── Given ───────────────────────────────────────────────────────────────
  scoped(/^the tip adds content authored for (.+)$/, (ctx, state) => {
    const shape = SIBLING_STATES[state];
    assert.ok(shape, `unknown sibling state: ${state}`);
    ctx.bl1309.shape = shape;
  });

  scoped(/^the tip carries the merge of a ticket withheld pending a human ruling$/, (ctx) => {
    ctx.bl1309.shape = 'withheld-sibling';
  });

  scoped(/^(the detector cannot be run at all|the range against origin\/main is unreadable)$/, (ctx, input) => {
    const shape = UNREADABLE_INPUTS[input];
    assert.ok(shape, `unknown unreadable input: ${input}`);
    ctx.bl1309.shape = shape;
  });

  // ── When ────────────────────────────────────────────────────────────────
  scoped(/^the land decide step runs$/, (ctx) => {
    assert.equal(ctx.bl1309.descendantOfOrigin, true);
    assert.ok(ctx.bl1309.shape, 'no fixture shape was chosen');
    ctx.bl1309.report = runFixture(ctx.bl1309.shape);
  });

  // ── Then ────────────────────────────────────────────────────────────────
  scoped(/^it reports (proceed|refuse)$/, (ctx, verdict) => {
    const expected = VERDICTS[verdict];
    assert.ok(expected, `unknown verdict: ${verdict}`);
    assert.equal(
      verdictOf(ctx.bl1309.report),
      expected,
      `${ctx.bl1309.shape}: ${JSON.stringify(ctx.bl1309.report)}`
    );
  });

  scoped(/^its output carries the ENTANGLED_SIBLING_BLOCK marker$/, (ctx) => {
    assert.equal(ctx.bl1309.report.marker, true, ctx.bl1309.report.out);
  });

  scoped(/^its output omits the ENTANGLED_SIBLING_BLOCK marker$/, (ctx) => {
    assert.equal(ctx.bl1309.report.marker, false, ctx.bl1309.report.out);
  });

  scoped(/^its output names the withheld ticket$/, (ctx) => {
    assert.ok(
      ctx.bl1309.report.out.includes(WITHHELD_TICKET),
      `the refusal does not name the withheld ticket: ${ctx.bl1309.report.out}`
    );
  });
}

module.exports = { registerSteps };
