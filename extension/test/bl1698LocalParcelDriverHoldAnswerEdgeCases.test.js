'use strict';

// BL-1698: the hold-and-answer edge cases, moved verbatim out of
// bl1698LocalParcelDriverMailAndReleaseEdgeCases.test.js on 2026-10-07 so
// neither file crosses the unit lane's 7 s per-file budget (BL-378). The
// whole file measured 3.7 s alone on a quiet host but 7.3 s in the gate's
// solo confirmation while two other full suites ran (QA, 06:09Z), and the
// gate refused it as a new pole. Each half is about 1.5 to 2.5 s alone.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { makeLocalParcelDriverFixture } = require('./helpers/localParcelDriverFixture');

const LIB = path.join(__dirname, '..', '..', 'swarmforge', 'scripts', 'local_parcel_driver_lib.bb');

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
