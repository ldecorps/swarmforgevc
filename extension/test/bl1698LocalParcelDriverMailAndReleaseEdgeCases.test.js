'use strict';

// BL-1698: deterministic regression tests for three branches the
// acceptance feature's own scenarios never reach - each is a real dispatch
// path through the real driver CLI, real git and the real `seat` script
// (the same fixture the acceptance step handlers use), never a pure-module
// reimplementation.
//
// 1. mechanical-mail!'s merge-conflict branch (requirement 4's own "a
//    conflict escalates like a ticket parcel's own merge-conflict path").
//    Found here: the branch raised the question but never persisted a
//    driver record, so the mail was left in_process with no record naming
//    why (a live breach of the ticket's own FIRM invariant 2) and no way
//    for an operator to release it via release-hold! (requirement 3, the
//    exact motivating problem this ticket exists to fix, now recurring one
//    layer down for mail instead of a ticket parcel). Fixed alongside this
//    test by persisting the same {:escalated true :ticket "mail" :reason
//    "merge conflict"} shape start-ticket-parcel!'s own conflict branch
//    already uses.
// 2. ask-or-escalate-to-coordinator!'s already-pending fallback
//    (requirement 5's own explicit "if the role's question slot is
//    already taken ... send the same text to the coordinator instead").
//    Already correct; pinned here since nothing exercised it before this
//    pass.
// 3. release-hold!'s two untested arms: no driver record for the seat
//    (nothing to release - exits 1, prints null) and an unrecognized mode
//    (throws, nonzero exit) - the case's third arm, alongside the
//    complete/retry arms the acceptance feature already covers.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { makeLocalParcelDriverFixture } = require('./helpers/localParcelDriverFixture');

test('mechanical-mail! escalates AND persists a driver record on a merge conflict, and an operator can release it', () => {
  const fixture = makeLocalParcelDriverFixture();
  try {
    const commitSha = fixture.makeSenderCommit({ conflict: true });
    const shortSha = commitSha.slice(0, 10);
    fixture.queueNoteMail(`BL-9 QA-approved ${shortSha} - merge your branch up to QA's`, { from: 'QA' });

    fixture.driveOneTick();

    assert.equal(fixture.hasMergeInProgress(), false, 'expected the conflicted merge to have been aborted');
    const state = fixture.readDriverState();
    assert.deepEqual(
      state,
      { escalated: true, ticket: 'mail', reason: 'merge conflict' },
      `expected a persisted driver record naming the hold, got: ${JSON.stringify(state)}`
    );
    const askCalls = fixture.recordedCalls().filter((c) => c.script === 'role_ask.bb');
    assert.equal(askCalls.length, 1, `expected exactly one question raised, got: ${JSON.stringify(askCalls)}`);
    assert.ok(
      askCalls[0].argv.some((a) => a.includes('mail: merge conflict')),
      `expected the question to name the mail conflict, got: ${JSON.stringify(askCalls[0].argv)}`
    );
    const inProcess = fs.readdirSync(path.join(fixture.root, '.swarmforge', 'handoffs', 'inbox', 'in_process'));
    assert.equal(inProcess.length, 1, 'expected the mail item to still be in_process, held by the recorded escalation');

    // The exact release path requirement 3 exists for: an operator can end
    // this hold with no model turn, same as any other hold.
    const release = fixture.releaseHold('complete');
    assert.equal(release.status, 0, `expected the release CLI to exit 0, got:\n${release.stderr}`);
    assert.deepEqual(JSON.parse(release.stdout.trim()), { result: 'completed' });
    assert.equal(fixture.readDriverState(), null, 'expected the driver record to be cleared after release');
  } finally {
    fixture.cleanup();
  }
});

test('ask-or-escalate-to-coordinator! falls back to a coordinator note when the role\'s ask slot is already taken', () => {
  const fixture = makeLocalParcelDriverFixture();
  try {
    // Overrides the fixture's own role_ask.bb stub to report the role's
    // ask slot as already taken (role_ask.bb's own already-pending
    // shape), while still logging the call the same way the default stub
    // does, so recordedCalls() keeps seeing it.
    const stubPath = path.join(fixture.scriptsDir, 'role_ask.bb');
    fs.writeFileSync(
      stubPath,
      [
        '(let [args (vec *command-line-args*)]',
        `  (spit "${fixture.callLog}" (str "role_ask.bb" (apply str (map #(str "\\u001f" %) args)) "\\n") :append true))`,
        '(println (cheshire.core/generate-string {:asked false :reason "already-pending"}))',
        '',
      ].join('\n')
    );

    fixture.queueNoteMail('BL-9 amended, merge main', { from: 'specifier' });
    fixture.driveOneTick();

    assert.equal(fixture.readDriverState(), null, 'expected the mail to be completed, no lingering record');
    const inProcess = fs.readdirSync(path.join(fixture.root, '.swarmforge', 'handoffs', 'inbox', 'in_process'));
    assert.deepEqual(inProcess, [], 'expected an empty in_process dir');

    const askCalls = fixture.recordedCalls().filter((c) => c.script === 'role_ask.bb');
    assert.equal(askCalls.length, 1, `expected the role ask to have been tried first, got: ${JSON.stringify(askCalls)}`);

    const handoffCalls = fixture.recordedCalls().filter((c) => c.script === 'swarm_handoff.sh');
    assert.equal(
      handoffCalls.length,
      1,
      `expected exactly one coordinator-note fallback, got: ${JSON.stringify(handoffCalls)}`
    );
    const draftText = handoffCalls[0].argv[0].replace(/\x1e/g, '\n');
    assert.match(draftText, /type: note/);
    assert.match(draftText, /to: coordinator/);
    assert.match(draftText, /priority: 00/);
    assert.match(draftText, /message: specifier: BL-9 amended, merge main/);
  } finally {
    fixture.cleanup();
  }
});

test('release-hold! with no driver record for the seat: nothing to release, exits 1', () => {
  const fixture = makeLocalParcelDriverFixture();
  try {
    const release = fixture.releaseHold('complete');
    assert.equal(release.status, 1, `expected exit 1 (nothing to release), got status ${release.status}`);
    assert.equal(release.stdout.trim(), 'null', `expected "null" printed, got: ${release.stdout}`);
  } finally {
    fixture.cleanup();
  }
});

test('release-hold! with an unrecognized mode: refuses rather than silently doing one of the two known things', () => {
  const fixture = makeLocalParcelDriverFixture();
  try {
    fixture.writeDriverState({ escalated: true, ticket: 'BL-9', reason: 'acceptance still failing' });
    const release = fixture.releaseHold('bogus');
    assert.notEqual(release.status, 0, 'expected a nonzero exit for an unrecognized mode');
    assert.match(release.stderr, /unknown mode "bogus"/);
    // Refuses without touching the record either way (neither completed
    // nor cleared) - the operator gets to retry with a valid mode.
    assert.notEqual(fixture.readDriverState(), null, 'expected the driver record to be left untouched on refusal');
  } finally {
    fixture.cleanup();
  }
});
