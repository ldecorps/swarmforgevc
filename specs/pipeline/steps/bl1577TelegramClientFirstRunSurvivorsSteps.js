'use strict';

// BL-1577: step handlers for "The first-run mutation survivors on
// telegramClient.ts leave with an owner and a disposition each". All three
// scenarios read the parcel's OWN committed discharge evidence at
// `backlog/evidence/BL-1577-telegramClient-mutation.md` - a deliberate
// read-only live-tree read (the feature's own prose: "the contract at this
// commit"), same shape as BL-1441/1468/1488's ledger-backed reads. This
// ticket's evidence is not ledger-backed (BL-1577 is not a
// hardening-debt-ledger row), so the path is fixed rather than looked up.
//
// The coder's own slice (this parcel's first stage) only drives the
// no-coverage mutants to zero via behaviour tests
// (`backlog/evidence/BL-1577-coder-20260916.md`); the full Stryker run with
// a json reporter and the per-survivor disposition table is the hardener's
// stage per the ticket's own "How" section (mirrors BL-1509's hardener
// precedent, Article 1.6). Until the hardener commits
// `BL-1577-telegramClient-mutation.md`, all three scenarios below are
// EXPECTED to fail (the evidence file does not exist yet) - this is the
// gate doing its job, not a coder-stage defect; see the "How" section's
// discharge-evidence contract this file parses:
//
//   Include set: full unit suite
//   Instrumented: <N>
//   No-coverage: <N>
//   Survived: <N>
//
//   ## No-coverage regions reached
//   - <function>: <test file> :: <test case description>
//   (one line per function the BL-1509 census named with a no-coverage
//   mutant - the eleven listed in KNOWN_NO_COVERAGE_FUNCTIONS below)
//
//   ## Survivor disposition
//   - <function> (<mutator or line>): <disposition>
//   where <disposition> contains one of: "killed", "accepted equivalent",
//   "grandfathered under BL-1519", or "owned by BL-<n>". One row per
//   survived mutant in the summary; the row count must equal Survived: N.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const FEATURE = 'BL-1577 The first-run mutation survivors on telegramClient.ts leave with an owner and a disposition each';

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const EVIDENCE_PATH = path.join(REPO_ROOT, 'backlog', 'evidence', 'BL-1577-telegramClient-mutation.md');

// The BL-1509 survivor census's own function list for the 19 no-coverage
// mutants (backlog/evidence/BL-1509-survivor-census-specifier-20260915.md).
// Every Examples-equivalent value here is load-bearing (engineering.prompt).
const KNOWN_NO_COVERAGE_FUNCTIONS = [
  'bl568PlanMenuAnswerDrive',
  'extractIconStickers',
  'setChatMenuButton',
  'defaultWaitMs',
  'extractForumTopicCreatedName',
  'inlineKeyboardButtonToWire',
  'defaultPost',
  'extractUpdates',
  'defaultPostVoice',
  'formatNetworkError',
  'bl568TextFallbackMessage',
];

function readEvidence() {
  assert.ok(
    fs.existsSync(EVIDENCE_PATH),
    `no discharge evidence yet at ${EVIDENCE_PATH} - written by the hardener stage, not the coder (Article 1.6)`
  );
  return fs.readFileSync(EVIDENCE_PATH, 'utf8');
}

// Extracts the body of a `## <title>` markdown section, up to the next
// `## ` heading or end of file. Scenario 02 and 03 each read a distinct
// section, and a bullet line's shape alone ("- X: Y") is not enough to
// tell which section it belongs to.
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

  scoped(/^the parcel's discharge evidence for out\/notify\/telegramClient\.js is read$/, (ctx) => {
    ctx.evidenceText = readEvidence();
  });

  // ── scenario 01 ──────────────────────────────────────────────────────
  scoped(/^it records a completed Stryker run whose dry-run include set is the full unit suite$/, (ctx) => {
    assert.match(
      ctx.evidenceText,
      /^Include set:\s*full unit suite\s*$/m,
      `evidence at ${EVIDENCE_PATH} has no "Include set: full unit suite" line`
    );
  });

  scoped(/^it instrumented at least 640 mutants$/, (ctx) => {
    const m = /^Instrumented:\s*(\d+)\s*$/m.exec(ctx.evidenceText);
    assert.ok(m, `evidence at ${EVIDENCE_PATH} has no "Instrumented: N" line`);
    assert.ok(Number(m[1]) >= 640, `expected at least 640 instrumented mutants, got ${m[1]}`);
  });

  scoped(/^it records zero no-coverage mutants$/, (ctx) => {
    const m = /^No-coverage:\s*(\d+)\s*$/m.exec(ctx.evidenceText);
    assert.ok(m, `evidence at ${EVIDENCE_PATH} has no "No-coverage: N" line`);
    assert.equal(Number(m[1]), 0, `expected zero no-coverage mutants, got ${m[1]}`);
  });

  // ── scenario 02 ──────────────────────────────────────────────────────
  scoped(/^every function the census lists with a no-coverage mutant appears with the test file and case that now executes it$/, (ctx) => {
    const body = section(ctx.evidenceText, 'No-coverage regions reached');
    const missing = KNOWN_NO_COVERAGE_FUNCTIONS.filter((fn) => {
      const re = new RegExp(`^- ${fn}:\\s*\\S+\\s*::\\s*.+$`, 'm');
      return !re.test(body);
    });
    assert.deepEqual(
      missing,
      [],
      `evidence at ${EVIDENCE_PATH} names no reaching test file/case for: ${JSON.stringify(missing)}`
    );
  });

  // ── scenario 03 ──────────────────────────────────────────────────────
  scoped(/^every survived mutant the summary reports is listed with its enclosing function and one disposition among killed, accepted equivalent with the code-level reason, grandfathered under the BL-1519 ruling, or owned by a named ticket$/, (ctx) => {
    const dispositionBody = section(ctx.evidenceText, 'Survivor disposition');
    const dispositionLines = dispositionBody.match(/^- \S+.*: .+$/gm) || [];
    const allowed = /killed|accepted equivalent|grandfathered under BL-1519|owned by BL-\d+/;
    const badLines = dispositionLines.filter((line) => !allowed.test(line));
    assert.deepEqual(
      badLines,
      [],
      `evidence at ${EVIDENCE_PATH} has disposition line(s) with no recognized disposition: ${JSON.stringify(badLines)}`
    );
    ctx.dispositionLineCount = dispositionLines.length;
  });

  scoped(/^the count of listed rows equals the summary's survived count$/, (ctx) => {
    const m = /^Survived:\s*(\d+)\s*$/m.exec(ctx.evidenceText);
    assert.ok(m, `evidence at ${EVIDENCE_PATH} has no "Survived: N" line`);
    assert.equal(
      ctx.dispositionLineCount,
      Number(m[1]),
      `evidence declares Survived: ${m[1]} but lists ${ctx.dispositionLineCount} disposition row(s)`
    );
  });
}

module.exports = { registerSteps };
