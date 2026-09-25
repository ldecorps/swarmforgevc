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
const { execFileSync } = require('node:child_process');
const { makeLocalParcelDriverFixture } = require('./helpers/localParcelDriverFixture');

const LIB = path.join(__dirname, '..', '..', 'swarmforge', 'scripts', 'local_parcel_driver_lib.bb');

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

// BL-1698 D4/D5 (QA bounce 2026-09-25):
// D4: resume-from-hold!'s answer is the hold's ONE extra try - if the
//     gate still fails after it, the very next check must escalate again,
//     never type a second, generic fix request first (the off-by-one:
//     fixTurnsUsed was being set to fixTurnsLimit - 1, which still passes
//     run-gate!'s `(< fixTurnsUsed fixTurnsLimit)`).
// D5: a hold with no :acceptancePath (a mail merge-conflict hold,
//     requirement 4's "no model turn" promise) has no gate to re-arm and
//     no ticket instruction to answer - resume-from-hold! must leave it
//     alone entirely, answer unconsumed, for an operator to resolve via
//     `release` instead.

test('D4: after the answer\'s one fix request still fails the gate, the very next check escalates (never a second fix request)', () => {
  const fixture = makeLocalParcelDriverFixture();
  try {
    fixture.installDeliverRoleAnswerStub();
    fixture.writeTicket({ editablePaths: ['editable.txt'] });
    fixture.writeDriverState({
      phase: 'awaiting-model',
      ticket: 'BL-9',
      senderRole: 'specifier',
      postMergeHead: fixture.headSha(),
      specFiles: [fixture.ticketPath, fixture.featurePath],
      specHashesBefore: {},
      editablePaths: ['editable.txt'],
      fixTurnsUsed: 0,
      fixTurnsLimit: 3,
      acceptancePath: fixture.featurePath,
      escalated: true,
      reason: 'acceptance still failing',
    });
    fixture.writeWaitingAnswer('use the other approach');

    // The answer's own tick: redoes the chat set-up (D3), types the fix
    // request, and re-arms the gate.
    fixture.driveOneTick();
    let state = fixture.readDriverState();
    assert.equal(state.escalated, undefined, 'expected the answer to clear the escalated hold for one more try');
    assert.equal(state.fixTurnsUsed, state.fixTurnsLimit, 'expected fixTurnsUsed set to the limit, not limit - 1');

    // BL-1698 architect bounce (2026-09-25, D2/architect-numbering): a
    // bare "something was typed" count is true even without the chat
    // set-up (the answer's own fix request always types SOMETHING) -
    // assert the actual /clear, /read-only and /add text chat-set-up!
    // sends, so this fails when those call sites are removed, not just
    // when nothing at all is typed.
    const typedTextsAfterAnswer = fixture.tmux
      .calls()
      .filter((c) => c.includes('send-keys') && c.includes('-l'))
      .map((c) => c[c.length - 1]);
    const typedAfterAnswer = typedTextsAfterAnswer.length;
    assert.ok(
      typedTextsAfterAnswer.some((t) => t === '/clear'),
      `expected the chat set-up's /clear, got: ${JSON.stringify(typedTextsAfterAnswer)}`
    );
    assert.ok(
      typedTextsAfterAnswer.some((t) => t === `/read-only ${fixture.ticketPath}`),
      `expected /read-only on the ticket spec file, got: ${JSON.stringify(typedTextsAfterAnswer)}`
    );
    assert.ok(
      typedTextsAfterAnswer.some((t) => t === `/read-only ${fixture.featurePath}`),
      `expected /read-only on the acceptance feature file, got: ${JSON.stringify(typedTextsAfterAnswer)}`
    );
    assert.ok(
      typedTextsAfterAnswer.some((t) => t.startsWith('/add ') && t.endsWith('editable.txt')),
      `expected /add on the editable path, got: ${JSON.stringify(typedTextsAfterAnswer)}`
    );
    assert.ok(
      typedTextsAfterAnswer.some((t) => t.includes('use the other approach')),
      `expected the answer's own fix request text, got: ${JSON.stringify(typedTextsAfterAnswer)}`
    );

    // The model leaves it broken; the pane goes idle; the gate runs and
    // must escalate immediately, never type a second fix request (or redo
    // the chat set-up again) first.
    fixture.modelLeavesItBroken(0);
    fixture.driveOneTick();
    state = fixture.readDriverState();
    assert.equal(state.escalated, true, `expected an immediate re-escalation, got: ${JSON.stringify(state)}`);

    const typedAfterEscalation = fixture.tmux.calls().filter((c) => c.includes('send-keys') && c.includes('-l')).length;
    assert.equal(
      typedAfterEscalation,
      typedAfterAnswer,
      'expected no further typed text once the gate re-escalated (no second fix request)'
    );
  } finally {
    fixture.cleanup();
  }
});

test('D5: an escalated mail hold with no acceptancePath is left alone on an available answer (no model turn, no gate, answer unconsumed)', () => {
  const fixture = makeLocalParcelDriverFixture();
  try {
    fixture.installDeliverRoleAnswerStub();
    fixture.writeDriverState({ escalated: true, ticket: 'mail', reason: 'merge conflict' });
    fixture.writeWaitingAnswer('resolve the conflict by taking theirs');

    fixture.driveOneTick();

    const state = fixture.readDriverState();
    assert.deepEqual(
      state,
      { escalated: true, ticket: 'mail', reason: 'merge conflict' },
      `expected the mail hold left untouched, got: ${JSON.stringify(state)}`
    );
    const typedCalls = fixture.tmux.calls().filter((c) => c.includes('send-keys') && c.includes('-l'));
    assert.equal(typedCalls.length, 0, `expected no text typed into the pane, got ${typedCalls.length} call(s)`);

    // Left unconsumed - an operator resolves it via `release` instead.
    const answerPath = path.join(fixture.root, '.swarmforge', 'operator', 'role-answers', 'coder.json');
    const answer = JSON.parse(fs.readFileSync(answerPath, 'utf8'));
    assert.equal(answer.consumedAt, undefined, 'expected the answer to be left unconsumed');
  } finally {
    fixture.cleanup();
  }
});

// BL-1698 QA pass 2 (D1/D2, 2026-09-25): the CLI fixture above spawns one
// bb process per driveOneTick(), so a "done once per daemon process"
// regression is invisible to it - the process-lifetime marker resets on
// every call, whatever the bug. These two run everything inside ONE
// long-lived bb process instead (real spec files, real set-writable!;
// tmux/seat/git/answer delivery stubbed with with-redefs), the same
// shape as handoffd's own loop, and count CHAT-CLEAR occurrences: with
// the once-per-process marker this ticket had before pass 2, both would
// print CHAT-CLEAR exactly once combined; the fix (chat-set-up! called
// unconditionally, no marker) prints it once per fix request.
function runR1R2Probe() {
  const script = `
(load-file "${LIB}")
(ns user (:require [local-parcel-driver-lib :as d] [babashka.fs :as fs]))
(def log (atom []))
(def st (atom nil))
(def answer (atom nil))
(def tdir (str (fs/create-temp-dir)))
(def specs [(str tdir "/BL-9.yaml") (str tdir "/BL-9.feature")])
(doseq [p specs] (spit p "spec"))
(with-redefs [d/chat-clear! (fn [& _] (swap! log conj "CHAT-CLEAR"))
              d/chat-read-only! (fn [& _] nil)
              d/chat-add! (fn [& _] nil)
              d/set-writable! (fn [& _] nil)
              d/type-raw! (fn [_ _ _ t] (swap! log conj (str "TYPED: " t)))
              d/write-driver-state! (fn [_ _ s] (reset! st s))
              d/read-driver-state (fn [_ _] @st)
              d/seat-test! (fn [& _] {:exit 1 :out "" :err ""})
              d/commit-count-since (fn [& _] 0)
              d/touched-paths-since (fn [& _] [])
              d/file-sha256 (fn [_] "x")
              d/escalate! (fn [_ t r] (swap! log conj (str "ESCALATE " t " " r)))
              d/answer-available? (fn [_ _] (let [a @answer] (reset! answer nil) a))
              d/turn-idle? (fn [_] true)
              agent-runtime-inject/capture-pane-text (fn [& _] "")]
  (let [ctx {:project-root tdir :checkout tdir :role "coder" :seat-id "coder" :agent "aider" :socket "s" :session "x"}
        base {:phase "awaiting-model" :ticket "BL-9" :specFiles specs :specHashesBefore {} :editablePaths ["src/a.bb"]
              :fixTurnsUsed 0 :fixTurnsLimit 3 :acceptancePath "a.feature" :postMergeHead "h"}]
    (println "== R1: same-process hold released by the human's answer")
    (reset! st base)
    (dotimes [_ 4] (d/drive-tick! ctx))
    (reset! answer "use the other approach")
    (d/drive-tick! ctx)
    (println "== R2: seat relaunched mid-parcel, same process (nothing to simulate: no marker to survive a relaunch)")
    (reset! st base)
    (d/drive-tick! ctx)
    (doseq [l @log] (println l))))
(fs/delete-tree tdir)
`;
  return execFileSync('bb', ['-e', script], { encoding: 'utf8' });
}

test('BL-1698 pass 2 D1/D2: chat-set-up! runs before every fix request, not once per daemon process', () => {
  const out = runR1R2Probe();
  const clearCount = (out.match(/CHAT-CLEAR/g) || []).length;
  // R1: 3 fix requests to reach escalation + 1 more on the answer's own
  // fix request = 4. R2: 1 more fix request from a fresh base state = 5.
  assert.equal(
    clearCount,
    5,
    `expected chat-set-up!'s /clear once per fix request (5 across R1+R2), got ${clearCount}: ${out}`
  );
});
