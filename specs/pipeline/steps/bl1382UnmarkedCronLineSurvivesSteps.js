'use strict';

// BL-1382: a crontab line the swarm did not write is never the swarm's to
// remove.
//
// Answered by this ticket's two e2e suites, which drive the REAL installer,
// the REAL uninstaller and the REAL reconcile strip against a fixture crontab
// behind a `crontab` shim. Nothing here reads or writes the live user crontab,
// and no scenario is answered by grepping a predicate for its own literals -
// the defect was a predicate that read plausibly and erased the human's data.

const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const FEATURE = "BL-1382 A crontab line the swarm did not write is never the swarm's to remove";
const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const E2E = path.join('swarmforge', 'scripts', 'test', 'test_bl1382_unmarked_cron_lines_survive.sh');
const AGREEMENT = path.join('swarmforge', 'scripts', 'test', 'test_bl1382_cron_ownership_agreement.sh');

// Explicit KNOWN_VALUES: a scenario naming a claim this handler does not know
// throws rather than passing through unchecked.
const CLAIMS = {
  'freshness-gone': 'the freshness line marked for R is gone',
  'operator-kept': 'the unmarked operator-script line is present byte-identical',
  'scripts-kept': 'the unmarked scripts-dir line is present byte-identical',
  'sibling-kept': "the sibling root's marked line is present byte-identical",
  'uninstall-reports': 'the uninstall reports the unmarked operator-script line as left in place',
  'marked-removed': 'a line carrying the operator schedule marker is still removed',
  'marked-removal-narrow': 'and the unmarked line beside it is still untouched',
  'install-block': 'the recognized-mode install wrote its managed block for R',
  'install-keeps': 'a recognized-mode install leaves both unmarked lines byte-identical',
  'install-reports': 'and the install reports the unmarked line as left in place',
  'fixture-only': 'every check ran against the fixture crontab, never the live one',
};

const AGREEMENT_CLAIMS = {
  'agree-r': 'both readers classify every corpus line the same for',
  unmarked: "an unmarked line naming the root is not the swarm's, however it names it",
  marked: 'every line the swarm marked for the root IS owned',
  sibling: "no sibling root's line is claimed",
  'drift-fails': 'a marker list edited in one reader and not the other makes this suite fail',
};

// Module scope, not per-ctx: each scenario gets its own ctx, so a per-ctx memo
// would re-run both suites once per scenario (BL-1390).
let suiteRun = null;
let agreementRun = null;

function runSuite(scriptPath, memo) {
  if (memo.value) {
    return memo.value;
  }
  const res = spawnSync('bash', [scriptPath], { cwd: REPO_ROOT, encoding: 'utf8', timeout: 1800000 });
  const out = `${res.stdout || ''}${res.stderr || ''}`;
  memo.value = out;
  if (res.status !== 0) {
    throw new Error(`${scriptPath} failed (${res.status}):\n${out}`);
  }
  return out;
}

const e2eMemo = { get value() { return suiteRun; }, set value(v) { suiteRun = v; } };
const agreeMemo = { get value() { return agreementRun; }, set value(v) { agreementRun = v; } };

function runE2e(ctx) {
  ctx.bl1382 = ctx.bl1382 || {};
  ctx.bl1382.out = runSuite(E2E, e2eMemo);
  return ctx.bl1382.out;
}

function runAgreement(ctx) {
  ctx.bl1382 = ctx.bl1382 || {};
  ctx.bl1382.agreement = runSuite(AGREEMENT, agreeMemo);
  return ctx.bl1382.agreement;
}

function requirePassed(ctx, claimKey) {
  const claim = CLAIMS[claimKey];
  assert.ok(claim, `unknown claim: ${claimKey}`);
  const out = runE2e(ctx);
  assert.ok(out.includes(`PASS: ${claim}`), `"${claim}" did not pass, in:\n${out}`);
}

function requireAgreed(ctx, claimKey) {
  const claim = AGREEMENT_CLAIMS[claimKey];
  assert.ok(claim, `unknown agreement claim: ${claimKey}`);
  const out = runAgreement(ctx);
  assert.ok(out.includes(`PASS: ${claim}`), `"${claim}" did not pass, in:\n${out}`);
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  // ── Background: the fixture the e2e builds for itself ───────────────────
  scoped(/^a fixture project root "R" with the swarmforge scripts$/, (ctx) => {
    ctx.bl1382 = ctx.bl1382 || {};
  });
  scoped(/^a sibling fixture root "S"$/, () => {});
  scoped(/^a crontab shim that reads and writes a fixture crontab file$/, (ctx) => {
    // The one claim worth asserting from the Background: no check anywhere in
    // this feature may touch the live user crontab.
    requirePassed(ctx, 'fixture-only');
  });
  scoped(/^the fixture crontab holds a freshness line marked for "(R|S)"$/, () => {});
  scoped(/^the fixture crontab holds an unmarked line naming "(.+)"$/, () => {});

  // ── Given ───────────────────────────────────────────────────────────────
  scoped(/^the fixture conf for "R" sets swarm_shift to "day"$/, (ctx) => {
    ctx.bl1382.mode = 'day';
  });

  scoped(/^the fixture crontab holds a line carrying the operator schedule marker for "R"$/, (ctx) => {
    ctx.bl1382.markedOperatorLine = true;
  });

  scoped(/^a corpus of crontab lines mixing marked, unmarked and sibling-root lines$/, (ctx) => {
    runAgreement(ctx);
  });

  // ── When ────────────────────────────────────────────────────────────────
  scoped(/^the swarm cron lines for "R" are uninstalled$/, (ctx) => {
    runE2e(ctx);
  });

  scoped(/^the schedule cron is installed for "R"$/, (ctx) => {
    runE2e(ctx);
  });

  scoped(/^each line is classified by the shell predicate and by the reconcile strip$/, (ctx) => {
    runAgreement(ctx);
  });

  // ── Then ────────────────────────────────────────────────────────────────
  scoped(/^the freshness line marked for "R" is gone$/, (ctx) => {
    requirePassed(ctx, 'freshness-gone');
  });

  scoped(/^the unmarked line naming "(.+)" is present byte-identical$/, (ctx, named) => {
    requirePassed(ctx, /operator/.test(named) ? 'operator-kept' : 'scripts-kept');
  });

  scoped(/^the freshness line marked for "S" is present byte-identical$/, (ctx) => {
    requirePassed(ctx, 'sibling-kept');
  });

  scoped(/^the output reports the unmarked line naming "(.+)" as left in place$/, (ctx) => {
    // Both writers owe the report; which one this scenario ran decides which
    // claim answers it.
    requirePassed(ctx, ctx.bl1382.mode === 'day' ? 'install-reports' : 'uninstall-reports');
  });

  scoped(/^the fixture crontab holds the managed block for "R"$/, (ctx) => {
    requirePassed(ctx, 'install-block');
    requirePassed(ctx, 'install-keeps');
  });

  scoped(/^the line carrying the operator schedule marker for "R" is gone$/, (ctx) => {
    requirePassed(ctx, 'marked-removed');
    requirePassed(ctx, 'marked-removal-narrow');
  });

  scoped(/^every line receives the same ownership from both$/, (ctx) => {
    requireAgreed(ctx, 'agree-r');
    requireAgreed(ctx, 'unmarked');
    requireAgreed(ctx, 'marked');
    requireAgreed(ctx, 'sibling');
    // The agreement is only worth having if it can fail (qa_e2e item 5).
    requireAgreed(ctx, 'drift-fails');
  });
}

module.exports = { registerSteps };
