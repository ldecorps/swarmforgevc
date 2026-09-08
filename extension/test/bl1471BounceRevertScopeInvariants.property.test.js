'use strict';

// BL-1471's two DECLARED invariants (property authorship rests with the
// coder, first pass - BL-654). Runs ONLY via `npm run test:properties`
// (vitest.properties.config.mjs).
//
//   invariant 1  A bounce revert never removes or alters a path attributed
//                to a ticket other than the bounced one: content another
//                ticket delivered survives the revert unchanged, or the
//                revert is refused naming the path and the ticket.
//   invariant 2  An omission-class bounce (the parcel lacks something;
//                nothing it added is wrong) produces no revert commit: the
//                guard refuses one, and a commit that is not a revert is
//                never judged.
//
// Drives the REAL swarmforge/scripts/check_bounce_revert_scope.sh against
// real git fixtures - never a JavaScript restatement of the predicate.
//
// GENERATOR REACH (the asserted floor, never a hoped-for one). The BL-1348
// incident this guards against needed a merge carrying MORE THAN ONE
// ticket's commits, so `otherTicketCount` is drawn to guarantee both a
// scoped (0 other tickets) and a violating (1-3 other tickets) shape on
// every run, crossed independently against both an omission and a
// non-omission failure class - so "the merge carries extra tickets AND the
// bounce is an omission" (where invariant 2 must win outright, never merely
// coexist with a scope finding) is reached by construction, not by luck.

const assert = require('node:assert/strict');
const fc = require('fast-check');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const { mkTmpDir } = require('./helpers/tmpDir');

const REPO_ROOT = path.join(__dirname, '..', '..');
const GUARD = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'check_bounce_revert_scope.sh');
const FIXTURE_PREFIX = 'bl1471-property-';

const OMISSION_CLASSES = ['spec-gap', 'invariant-unencoded'];
const OTHER_CLASSES = ['behavior', 'compile', 'unit', 'integration', 'acceptance'];

function git(root, ...args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' });
}

function commitFile(root, rel, body, message) {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, body);
  git(root, 'add', rel);
  git(root, 'commit', '-q', '-m', message);
}

// A "documenter" branch carrying ticketIds[0..n-1]'s own commits (one file
// each), merged into main as "Merge documenter <sha> into QA." - the exact
// shape a bounce revert reverses. Records a bounce for ticketIds[0] at ITS
// OWN commit (an ancestor of the merge's second parent - the authoritative
// match the guard's ticket-identification step relies on, never a guess
// off commit subjects, since a merge routinely carries more than one
// ticket - that ambiguity is this ticket's whole point).
function buildFixture(ticketIds, failureClass) {
  const root = mkTmpDir(FIXTURE_PREFIX);
  git(root, 'init', '-q', '-b', 'main');
  git(root, 'config', 'user.email', 't@t');
  git(root, 'config', 'user.name', 't');
  git(root, 'config', 'commit.gpgsign', 'false');
  git(root, 'commit', '-q', '--allow-empty', '-m', 'seed');

  git(root, 'checkout', '-q', '-b', 'doc');
  const ticketCommits = [];
  const files = [];
  for (const id of ticketIds) {
    const rel = `specs/pipeline/steps/${id.replace('-', '')}ExampleSteps.js`;
    commitFile(root, rel, 'step handler\n', `${id}: add step handler`);
    ticketCommits.push(git(root, 'rev-parse', 'HEAD').trim());
    files.push(rel);
  }
  const docTip = git(root, 'rev-parse', 'HEAD').trim();

  git(root, 'checkout', '-q', 'main');
  git(root, 'merge', '-q', '--no-ff', '-m', `Merge documenter ${docTip} into QA.`, 'doc');
  const mergeTip = git(root, 'rev-parse', 'HEAD').trim();

  const bouncesDir = path.join(root, '.swarmforge', 'bounces');
  fs.mkdirSync(bouncesDir, { recursive: true });
  const record = {
    ticket: ticketIds[0],
    producingRole: 'coder',
    ticketType: 'defect',
    failureClass,
    commit: ticketCommits[0],
    by: 'QA',
    at: '2026-09-07T10:00:00.000Z',
  };
  fs.writeFileSync(path.join(bouncesDir, '2026-09.jsonl'), `${JSON.stringify(record)}\n`);

  spawnSync('git', ['revert', '-n', '-m', '1', mergeTip], { cwd: root, encoding: 'utf8' });
  const message = `Revert "Merge documenter ${docTip} into QA."\n\nThis reverts commit ${mergeTip}.\n`;

  return { root, files, mergeTip, message };
}

function runGuard(root, message) {
  const msgFile = path.join(root, '..', `bl1471-msg-${process.pid}-${Math.random()}.txt`);
  fs.writeFileSync(msgFile, message);
  const r = spawnSync('bash', [GUARD, msgFile], { cwd: root, encoding: 'utf8' });
  fs.rmSync(msgFile, { force: true });
  return { status: r.status, out: `${r.stdout || ''}${r.stderr || ''}` };
}

const caseArb = fc.record({
  otherTicketCount: fc.integer({ min: 0, max: 3 }),
  isOmission: fc.boolean(),
  classIndex: fc.nat(),
});

test('BL-1471/BL-654 invariants: a bounce revert stays scoped to its own ticket, and an omission bounce reverts nothing', () => {
  const reach = { scoped: 0, violating: 0, omission: 0, nonOmission: 0 };

  fc.assert(
    fc.property(caseArb, (c) => {
      const classes = c.isOmission ? OMISSION_CLASSES : OTHER_CLASSES;
      const failureClass = classes[c.classIndex % classes.length];
      const ticketIds = ['BL-9001'];
      for (let i = 0; i < c.otherTicketCount; i += 1) ticketIds.push(`BL-90${20 + i}`);

      const { root, files, message } = buildFixture(ticketIds, failureClass);
      try {
        if (c.isOmission) reach.omission += 1;
        else reach.nonOmission += 1;
        if (c.otherTicketCount === 0) reach.scoped += 1;
        else reach.violating += 1;

        const { status, out } = runGuard(root, message);

        if (c.isOmission) {
          // invariant 2: an omission bounce reverts nothing - refused
          // outright, regardless of how scoped the diff itself is.
          assert.notEqual(status, 0, `an omission-class (${failureClass}) revert was waved through:\n${out}`);
          assert.match(out, /nothing to revert/i, `an omission refusal must say so:\n${out}`);
        } else if (c.otherTicketCount === 0) {
          assert.equal(status, 0, `a revert scoped to its own ticket's paths was refused:\n${out}`);
        } else {
          // invariant 1: touching another ticket's path is refused, naming
          // every such path and ticket (Article 4.4's one-pass-names-every
          // -violation shape, not merely the first).
          assert.notEqual(status, 0, `a revert touching another ticket's path was waved through:\n${out}`);
          for (let i = 1; i < ticketIds.length; i += 1) {
            assert.ok(out.includes(ticketIds[i]), `refusal must name ${ticketIds[i]}:\n${out}`);
            assert.ok(out.includes(files[i]), `refusal must name ${files[i]}:\n${out}`);
          }
        }
        return true;
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    }),
    { numRuns: 20 },
  );

  assert.ok(reach.scoped > 0, 'never exercised a scoped (passing) revert');
  assert.ok(reach.violating > 0, 'never exercised a scope-violating revert');
  assert.ok(reach.omission > 0, 'never exercised an omission-class bounce');
  assert.ok(reach.nonOmission > 0, 'never exercised a non-omission-class bounce');
});
