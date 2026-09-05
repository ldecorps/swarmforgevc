'use strict';

const assert = require('node:assert/strict');
const fc = require('fast-check');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { mkTmpDir } = require('./helpers/tmpDir');
const {
  HUMAN_DECISION_BYLINE,
  humanDecisionCommitMessage,
} = require('../out/util/commitIntegrityRunner');
const { PIPELINE_ORDER } = require('../out/metrics/swarmMetrics');

// BL-1368 declared invariants:
//
// 1. A commit recording a human decision never carries a pipeline role
//    byline - the byline is the only attribution a reader has, and on this
//    class it must not name someone who did not decide.
// 2. A pipeline role's own commits keep their role byline exactly as today;
//    this changes the human-decision class only.
//
// Invariant 1 is encoded twice on purpose. The message composer is the
// behaviour, but the DEFECT was never in a composer - it was three separate
// hardcoded `By coder.` literals at three writers, which is exactly the shape
// a composer-only property cannot see. The second property therefore reads the
// real production sources and fails on any human-decision commit message
// literal that ends in a role byline. Its non-vacuity is shown against a
// reconstructed pre-fix line rather than assumed.
//
// Invariant 2 runs the REAL compliance checker (compliance_battery.bb check
// commit-byline) over REAL commits, one bb spawn per distinct role and no
// more - the property caches by role, so a hundred runs still costs seven
// spawns (a property that spawned per run once took the shared suite down).
//
// Runs ONLY via `npm run test:properties`.

const REPO_ROOT = path.join(__dirname, '..', '..');
const COMPLIANCE_CLI = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'compliance_battery.bb');

// The three production writers of a human-decision commit. Every one composes
// its message; a fourth appearing without the composer is what property 2
// exists to catch.
const HUMAN_DECISION_WRITERS = [
  'extension/src/bridge/bridgeServer.ts',
  'extension/src/tools/telegramFrontDeskBotCore.ts',
  'extension/src/tools/telegram-front-desk-bot.ts',
];

// A human-decision commit subject, as the writers compose them.
const HUMAN_DECISION_SUBJECT = /record (human_approval|approval \+ promotion)/;

function roleBylineIn(text) {
  return PIPELINE_ORDER.find((role) => text.includes(`By ${role}.`));
}

function lastParagraph(message) {
  const paragraphs = message.split('\n\n');
  return paragraphs[paragraphs.length - 1];
}

// A message-literal scanner over one source line: the shape the defect had
// was a template literal whose subject records a human decision and whose
// body is a role byline, both on the same line.
function offendingLines(source) {
  return source
    .split('\n')
    .map((line, index) => ({ line, lineNumber: index + 1 }))
    .filter(({ line }) => HUMAN_DECISION_SUBJECT.test(line) && roleBylineIn(line) !== undefined);
}

test('property: the byline paragraph of any human-decision commit names no pipeline role', () => {
  const seenSubjects = new Set();
  fc.assert(
    fc.property(
      fc.constantFrom('Approve', 'Reject', 'Amend', 'Expedite'),
      fc.integer({ min: 1, max: 4000 }),
      fc.constantFrom('record human_approval', 'record approval + promotion'),
      (verb, id, tail) => {
        const subject = `${verb} BL-${id}: ${tail}`;
        seenSubjects.add(`${verb}|${tail}`);
        const message = humanDecisionCommitMessage(subject);
        assert.equal(message.startsWith(subject), true, 'the subject survives composition');
        const byline = lastParagraph(message);
        assert.equal(byline, HUMAN_DECISION_BYLINE);
        assert.equal(roleBylineIn(byline), undefined, `the byline named a pipeline role: ${byline}`);
      }
    ),
    { numRuns: 200 }
  );
  // Reach, asserted rather than hoped for: every verb the front desk can
  // commit, on both subject shapes.
  assert.equal(seenSubjects.size, 8, `generator reached only ${seenSubjects.size} of 8 verb/subject pairs`);
  // Non-vacuous: the same predicate DOES fire on the pre-fix byline.
  assert.equal(roleBylineIn(lastParagraph('Approve BL-1: record human_approval\n\nBy coder.')), 'coder');
});

test('property: no production writer composes a human-decision commit with a role byline', () => {
  const sources = HUMAN_DECISION_WRITERS.map((rel) => ({
    rel,
    source: fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8'),
  }));
  for (const { rel, source } of sources) {
    const offenders = offendingLines(source);
    assert.deepEqual(
      offenders.map(({ lineNumber, line }) => `${rel}:${lineNumber}: ${line.trim()}`),
      [],
      'a human-decision commit message literal still carries a pipeline role byline'
    );
    // Each writer really does compose one - a file that stopped writing a
    // human-decision commit at all would otherwise pass vacuously.
    assert.equal(
      source.includes('humanDecisionCommitMessage('),
      true,
      `${rel} no longer composes its human-decision commit message`
    );
  }
  // Non-vacuous: the scanner fires on the exact line this ticket removed.
  const preFix = 'const committed = await commitApprovalWrites(t, id, `Approve ${id}: record human_approval\\n\\nBy coder.`);';
  assert.equal(offendingLines(preFix).length, 1);
});

test("property: a pipeline role's own commit still passes the role byline check, and a human-decision commit is not one", () => {
  const root = mkTmpDir('sfvc-bl1368-byline-');
  const verdicts = new Map();
  try {
    const git = (...args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', env: { ...process.env, GIT_DIR: undefined, GIT_WORK_TREE: undefined } });
    execFileSync('git', ['init', '-q', root]);
    git('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'seed');

    const checkByline = (message, role) => {
      fs.writeFileSync(path.join(root, 'work.txt'), `${message}\n`);
      git('add', 'work.txt');
      git('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', message);
      const sha = git('rev-parse', 'HEAD').trim();
      const out = execFileSync('bb', [COMPLIANCE_CLI, 'check', 'commit-byline', root, sha, role], { encoding: 'utf8' });
      return JSON.parse(out.trim().split('\n').pop()).status;
    };

    fc.assert(
      fc.property(fc.constantFrom(...PIPELINE_ORDER), (role) => {
        if (!verdicts.has(role)) {
          verdicts.set(role, {
            own: checkByline(`${role} does its own work\n\nBy ${role}.`, role),
            humanDecision: checkByline(humanDecisionCommitMessage(`Approve BL-1368: record human_approval`), role),
          });
        }
        const verdict = verdicts.get(role);
        // Invariant 2: unchanged - a role's own commit still passes.
        assert.equal(verdict.own, 'pass', `role ${role} lost its byline pass`);
        // Invariant 1, from the checker's own side: the human-decision
        // commit is not attributable to any pipeline role.
        assert.equal(verdict.humanDecision, 'fail', `role ${role} was credited with a human decision`);
      }),
      { numRuns: 60 }
    );
    // Reach: every pipeline role was actually exercised.
    assert.deepEqual([...verdicts.keys()].sort(), [...PIPELINE_ORDER].sort());
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
