'use strict';

// BL-1676: step handlers for "night-closing-ceremony-run leaves no
// unexplained first-run mutant". Both scenarios read the parcel's own
// committed discharge evidence at
// `backlog/evidence/BL-1676-night-closing-ceremony-run-mutation.md` - fixed
// path (this ticket is not a hardening-debt-ledger row), same read-only
// live-tree read as BL-1577's precedent.
//
// The coder's own slice (this parcel's first stage, per required_stages:
// [coder, hardener, qa]) only drives the named declarations' survivors
// toward zero via behaviour tests
// (`backlog/evidence/BL-1676-coder-<date>.md`); the full Stryker run with a
// json reporter and the per-declaration killed-by table is the hardener's
// stage (Article 1.6, mirrors BL-1577's hardener precedent). Until the
// hardener commits `BL-1676-night-closing-ceremony-run-mutation.md`, both
// scenarios below are EXPECTED to fail (the evidence file does not exist
// yet) - this is the gate doing its job, not a coder-stage defect. The
// evidence contract this file parses:
//
//   Include set: full unit suite
//   Instrumented: <N>
//   Survived: <N>
//
//   ## Survivor disposition
//   - <declaration>: killed by <test file> :: <test case> | accepted equivalent: <code-level reason> | owned by BL-<n>
//   (one row per declaration the ticket's census names)

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const FEATURE = "BL-1676 night-closing-ceremony-run leaves no unexplained first-run mutant";

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const EVIDENCE_PATH = path.join(REPO_ROOT, 'backlog', 'evidence', 'BL-1676-night-closing-ceremony-run-mutation.md');

// The ticket's own per-declaration census (title and description), the
// eight declarations the 38 survivors and in-scope no-coverage mutants sit
// in. Every Examples-equivalent value here is load-bearing (engineering.prompt).
const KNOWN_CENSUS_DECLARATIONS = [
  'runNightClosingCeremony',
  'applyAction',
  'localDayKey',
  'parseHmToMs',
  'withRuntimeLoudCodes',
  'gateBypassed',
  'resolveCeremonyDeadlines',
  'ceremonyIsDue',
];

function readEvidence() {
  assert.ok(
    fs.existsSync(EVIDENCE_PATH),
    `no discharge evidence yet at ${EVIDENCE_PATH} - written by the hardener stage, not the coder (Article 1.6)`
  );
  return fs.readFileSync(EVIDENCE_PATH, 'utf8');
}

// Extracts the body of a `## <title>` markdown section, up to the next
// `## ` heading or end of file - same shape as BL-1577's `section` helper.
function section(evidenceText, title) {
  const lines = evidenceText.split('\n');
  const startIndex = lines.findIndex((line) => line.trim() === `## ${title}`);
  if (startIndex === -1) {
    return '';
  }
  const body = [];
  for (let i = startIndex + 1; i < lines.length; i += 1) {
    if (/^##\s/.test(lines[i])) {
      break;
    }
    body.push(lines[i]);
  }
  return body.join('\n');
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(new RegExp("^the parcel commit compiled and the scoped Stryker run over night-closing-ceremony-run\\.js recorded in the evidence$"), (ctx) => {
    ctx.evidencePath = EVIDENCE_PATH;
  });

  scoped(new RegExp("^the evidence is read$"), (ctx) => {
    ctx.evidenceText = readEvidence();
  });

  // ── scenario 01 ──────────────────────────────────────────────────────
  scoped(new RegExp("^every mutant Stryker reports is killed or listed as an accepted equivalent with its code-level reason$"), (ctx) => {
    const dispositionBody = section(ctx.evidenceText, 'Survivor disposition');
    const dispositionLines = dispositionBody.match(/^- \S.*:.+$/gm) || [];
    const allowed = /killed by \S+.*::.+|accepted equivalent:\s*\S.+|owned by [A-Za-z]+-\d+/;
    const badLines = dispositionLines.filter((line) => !allowed.test(line));
    assert.deepEqual(
      badLines,
      [],
      `evidence at ${EVIDENCE_PATH} has disposition line(s) with no recognized disposition: ${JSON.stringify(badLines)}`
    );
  });

  scoped(new RegExp("^the run reports at least 400 mutants$"), (ctx) => {
    const m = /^Instrumented:\s*(\d+)\s*$/m.exec(ctx.evidenceText);
    assert.ok(m, `evidence at ${EVIDENCE_PATH} has no "Instrumented: N" line`);
    assert.ok(Number(m[1]) >= 400, `expected at least 400 instrumented mutants, got ${m[1]}`);
  });

  // ── scenario 02 ──────────────────────────────────────────────────────
  scoped(new RegExp("^the declarations named in the ticket's census$"), (ctx) => {
    ctx.censusDeclarations = KNOWN_CENSUS_DECLARATIONS;
  });

  scoped(new RegExp("^each declaration's killed group names a unit test that pins the decision or boundary the mutant changed$"), (ctx) => {
    const dispositionBody = section(ctx.evidenceText, 'Survivor disposition');
    const missing = ctx.censusDeclarations.filter((decl) => {
      const re = new RegExp(`^- ${decl}:\\s*killed by \\S+.*::.+$`, 'm');
      return !re.test(dispositionBody);
    });
    assert.deepEqual(
      missing,
      [],
      `evidence at ${EVIDENCE_PATH} names no killing test for declaration(s): ${JSON.stringify(missing)}`
    );
  });
}

module.exports = { registerSteps };
