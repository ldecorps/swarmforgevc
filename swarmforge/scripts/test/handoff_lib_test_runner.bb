#!/usr/bin/env bb
;; BL-365: TDD runner for handoff_lib.bb's new atomic-write!/corrupt-handoff?/
;; quarantine-corrupt-handoff!/partition-corrupt - the shared durability +
;; integrity-floor helpers. No real crash, no real timers: durability is
;; proven by injecting write-fn!/sync-fn!/rename-fn! and asserting the
;; ORDER (the "honest mechanical proof" the ticket asks for), and corruption
;; cases are constructed fixture content, not a race.

(ns handoff-lib-test-runner
  (:require [babashka.fs :as fs]
            [clojure.string :as str]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "handoff_lib.bb")))

(def failures (atom []))

(defn assert= [msg expected actual]
  (when (not= expected actual)
    (swap! failures conj (str "FAIL: " msg "\n  expected: " (pr-str expected) "\n  actual:   " (pr-str actual)))))

(defn assert-true [msg actual] (assert= msg true (boolean actual)))
(defn assert-false [msg actual] (assert= msg false (boolean actual)))

(def created-temp-dirs (atom []))
;; BL-459: every temp dir this runner creates is tracked here and removed by
;; a JVM shutdown hook, registered ONCE below - fires on both a clean run
;; and an uncaught assertion/exception propagating out of this script
;; (verified empirically: Runtime/addShutdownHook runs on System/exit and on
;; an uncaught throwable unwinding to the top level), never on SIGKILL/OOM
;; (BL-413's periodic /tmp sweep is the backstop for that - out of scope
;; here).
(.addShutdownHook (Runtime/getRuntime)
                   (Thread. (fn [] (doseq [d @created-temp-dirs] (try (fs/delete-tree d) (catch Exception _ nil))))))

(defn mk-tmp-dir []
  (let [d (str (fs/create-temp-dir {:prefix "sfvc-handoff-lib-"}))]
    (swap! created-temp-dirs conj d)
    d))

(def valid-handoff-content
  (str "id: 20260714T000000Z_000001_from_coder\n"
       "from: coder\n"
       "to: cleaner\n"
       "priority: 50\n"
       "type: git_handoff\n"
       "role: coder\n"
       "task: demo-task\n"
       "commit: abcdef0123\n"
       "created_at: 2026-07-14T00:00:00Z\n"
       "\n"
       "Re-read your role and constitution.\n\nmerge_and_process coder abcdef0123"))

;; ── corrupt-handoff? ─────────────────────────────────────────────────────

(assert-false "a genuinely valid handoff is not corrupt" (handoff-lib/corrupt-handoff? valid-handoff-content))

(assert-true "empty content is corrupt" (handoff-lib/corrupt-handoff? ""))

(assert-true "truncated mid-header (missing 'type' and later fields) is corrupt"
             (handoff-lib/corrupt-handoff? "id: 20260714T000000Z_000001_from_coder\nfrom: coder\nto: clea"))

(assert-true "headers with no body is corrupt"
             (handoff-lib/corrupt-handoff?
              (str "id: 20260714T000000Z_000001_from_coder\n"
                   "from: coder\nto: cleaner\npriority: 50\ntype: note\n")))

(assert-true "headers with a blank-line separator but an empty body is corrupt"
             (handoff-lib/corrupt-handoff?
              (str "id: 20260714T000000Z_000001_from_coder\n"
                   "from: coder\nto: cleaner\npriority: 50\ntype: note\n\n")))

;; ── atomic-write! (real defaults - round-trips real content) ────────────

(let [dir (mk-tmp-dir)
      target (str (fs/path dir "real.handoff"))]
  (handoff-lib/atomic-write! target valid-handoff-content)
  (assert-true "atomic-write! installs the target file" (fs/exists? target))
  (assert= "atomic-write! preserves content exactly" valid-handoff-content (slurp target))
  (assert= "atomic-write! leaves no stray tmp file behind"
           1 (count (fs/list-dir dir))))

;; ── atomic-write! (injected adapters - proves write happens BEFORE sync,
;;    and sync happens BEFORE rename; the actual crash-durability property
;;    is not otherwise observable without a real crash) ─────────────────

(let [dir (mk-tmp-dir)
      target (str (fs/path dir "ordered.handoff"))
      call-order (atom [])]
  (handoff-lib/atomic-write!
   target "content"
   {:write-fn! (fn [_tmp _content] (swap! call-order conj :write))
    :sync-fn! (fn [_tmp] (swap! call-order conj :sync))
    :rename-fn! (fn [_tmp _target] (swap! call-order conj :rename))})
  (assert= "atomic-write! calls write, then sync, then rename, in that order"
           [:write :sync :rename] @call-order))

;; ── install-handoff! (BL-365 scenario 03: a sender cannot install an empty
;;    handoff into its outbox) ────────────────────────────────────────────

(let [dir (mk-tmp-dir)
      target (str (fs/path dir "50_x_from_coder_to_cleaner.handoff"))]
  (assert= "install-handoff! returns the target path on a genuine, non-corrupt write"
           target (handoff-lib/install-handoff! target valid-handoff-content))
  (assert-true "the file exists after a successful install" (fs/exists? target))
  (assert= "the file carries the real content" valid-handoff-content (slurp target)))

(let [dir (mk-tmp-dir)
      target (str (fs/path dir "50_y_from_coder_to_cleaner.handoff"))
      ;; Simulates "a role sends a handoff whose contents fail to be
      ;; written" deterministically - never a real crash or a filesystem
      ;; permission-bit trick (both banned by this project's own testing
      ;; rules) - by injecting a write-fn! that installs nothing.
      result (handoff-lib/install-handoff!
              target valid-handoff-content
              {:write-fn! (fn [tmp _content] (spit (str tmp) ""))})]
  (assert= "install-handoff! returns nil when what actually landed on disk is corrupt" nil result)
  (assert-false "no handoff file is left behind in the outbox when the write fails" (fs/exists? target)))

;; ── quarantine-corrupt-handoff! ──────────────────────────────────────────

(let [dir (mk-tmp-dir)
      file (str (fs/path dir "50_20260714T000000Z_000001_from_coder_to_cleaner.handoff"))]
  (spit file "")
  (let [dead-path (handoff-lib/quarantine-corrupt-handoff! (fs/path file))]
    (assert-false "the original corrupt file no longer exists at its old path" (fs/exists? file))
    (assert-true "the quarantined file exists at <name>.handoff.dead" (fs/exists? dead-path))
    (assert= "the quarantine suffix matches chase_sweep_lib.bb's own dead-letter convention exactly"
             (str file ".dead") (str dead-path))))

;; ── partition-corrupt ────────────────────────────────────────────────────

(let [dir (mk-tmp-dir)
      good-file (fs/path dir "50_a_from_coder_to_cleaner.handoff")
      empty-file (fs/path dir "50_b_from_coder_to_cleaner.handoff")
      truncated-file (fs/path dir "50_c_from_coder_to_cleaner.handoff")]
  (spit (str good-file) valid-handoff-content)
  (spit (str empty-file) "")
  (spit (str truncated-file) "id: x\nfrom: coder\nto: clea")
  (let [{:keys [corrupt valid]} (handoff-lib/partition-corrupt [good-file empty-file truncated-file])]
    (assert= "partition-corrupt keeps the one genuinely valid candidate" [good-file] valid)
    (assert= "partition-corrupt reports both corrupt candidates, in order" [empty-file truncated-file] corrupt)
    (assert-true "the good file is untouched at its original path" (fs/exists? good-file))
    (assert-false "the empty file no longer sits at its original path (quarantined)" (fs/exists? empty-file))
    (assert-true "the empty file is quarantined as *.handoff.dead" (fs/exists? (fs/path dir "50_b_from_coder_to_cleaner.handoff.dead")))
    (assert-true "the truncated file is quarantined as *.handoff.dead" (fs/exists? (fs/path dir "50_c_from_coder_to_cleaner.handoff.dead")))))

;; ── unresolvable-commit? / partition-unresolvable-commit / resolve- ─────
;;    dequeueable-candidates (BL-610) - all exercised with an injected
;;    resolve-fn? so the decision logic is provable without a real repo.

(def resolves-yes (constantly true))
(def resolves-no (constantly false))
(defn resolves-spy [calls result]
  (fn [commit] (swap! calls conj commit) result))

(defn git-handoff-content
  ([commit] (git-handoff-content commit "demo-task"))
  ([commit task]
   (str "id: 20260724T000000Z_000001_from_qa\n"
        "from: qa\n"
        "to: coder\n"
        "priority: 50\n"
        "type: git_handoff\n"
        "task: " task "\n"
        (when commit (str "commit: " commit "\n"))
        "created_at: 2026-07-24T00:00:00Z\n"
        "enqueued_at: 2026-07-24T00:00:02Z\n"
        "\n"
        "merge_and_process qa " (or commit "") "\n")))

(def note-content
  (str "id: 20260724T000000Z_000002_from_qa\n"
       "from: qa\nto: coder\npriority: 50\ntype: note\nmessage: hi\n"
       "\nhi\n"))

(def awake-content
  (str "id: 20260724T000000Z_000003_from_qa\n"
       "from: qa\nto: coder\npriority: 50\ntype: awake\n"
       "\nwake up\n"))

(assert-false "a git_handoff with a resolvable commit is not unresolvable"
              (handoff-lib/unresolvable-commit? (git-handoff-content "abc1234567") resolves-yes))

(assert-true "a git_handoff with an unresolvable commit is flagged"
             (handoff-lib/unresolvable-commit? (git-handoff-content "abc1234567") resolves-no))

(assert-false "a git_handoff with a blank/absent commit header is never flagged (nothing to check)"
              (handoff-lib/unresolvable-commit? (git-handoff-content nil) resolves-no))

(assert-false "a note parcel is never flagged, regardless of resolve-fn?"
              (handoff-lib/unresolvable-commit? note-content resolves-no))

(assert-false "an awake parcel is never flagged, regardless of resolve-fn?"
              (handoff-lib/unresolvable-commit? awake-content resolves-no))

(let [calls (atom [])]
  (handoff-lib/unresolvable-commit? note-content (resolves-spy calls false))
  (handoff-lib/unresolvable-commit? awake-content (resolves-spy calls false))
  (assert= "note/awake parcels never invoke the git lookup at all" [] @calls))

(let [record (handoff-lib/unresolvable-commit-record (git-handoff-content "abc1234567" "BL-999"))]
  (assert-true "the quarantine record names the commit" (str/includes? record "commit=abc1234567"))
  (assert-true "the quarantine record names the task" (str/includes? record "task=BL-999"))
  (assert-true "the quarantine record names the sending role" (str/includes? record "from=qa"))
  (assert-true "the quarantine record names created_at" (str/includes? record "created_at=2026-07-24T00:00:00Z"))
  (assert-true "the quarantine record names enqueued_at" (str/includes? record "enqueued_at=2026-07-24T00:00:02Z"))
  (assert-true "the quarantine record names a dequeued_at" (str/includes? record "dequeued_at=")))

(let [dir (mk-tmp-dir)
      resolvable (fs/path dir "50_a_from_qa_to_coder.handoff")
      unresolvable (fs/path dir "50_b_from_qa_to_coder.handoff")
      blank-commit (fs/path dir "50_c_from_qa_to_coder.handoff")
      a-note (fs/path dir "50_d_from_qa_to_coder.handoff")]
  (spit (str resolvable) (git-handoff-content "resolvableaa"))
  (spit (str unresolvable) (git-handoff-content "unresolvable"))
  (spit (str blank-commit) (git-handoff-content nil))
  (spit (str a-note) note-content)
  (let [resolve-fn? (fn [commit] (= commit "resolvableaa"))
        {:keys [quarantined valid]} (handoff-lib/partition-unresolvable-commit
                                     [resolvable unresolvable blank-commit a-note] resolve-fn?)]
    (assert= "partition-unresolvable-commit keeps the resolvable, blank-commit, and note candidates valid"
             [resolvable blank-commit a-note] valid)
    (assert= "partition-unresolvable-commit quarantines exactly the unresolvable candidate"
             [unresolvable] (mapv :file quarantined))
    (assert-true "the resolvable file is untouched at its original path" (fs/exists? resolvable))
    (assert-false "the unresolvable file no longer sits at its original path (quarantined)" (fs/exists? unresolvable))
    (assert-true "the unresolvable file is quarantined as *.handoff.dead"
                 (fs/exists? (fs/path dir "50_b_from_qa_to_coder.handoff.dead")))))

;; A parcel that is BOTH structurally corrupt AND commit-unresolvable must be
;; quarantined exactly once, via the corrupt path - resolve-dequeueable-
;; candidates must never hand it to partition-unresolvable-commit at all.
(let [dir (mk-tmp-dir)
      both-broken (fs/path dir "50_broken_from_qa_to_coder.handoff")
      lookup-calls (atom [])]
  ;; headers with no body at all: corrupt-handoff? fires on this regardless
  ;; of the (well-formed-looking) commit header present in it.
  (spit (str both-broken)
        (str "id: x\nfrom: qa\nto: coder\npriority: 50\ntype: git_handoff\ncommit: deadbeef00\n"))
  (let [dequeued (handoff-lib/resolve-dequeueable-candidates
                  [both-broken] [] [] (resolves-spy lookup-calls false))]
    (assert= "the doubly-broken parcel is not dequeued" [] dequeued)
    (assert-true "the doubly-broken parcel is quarantined (moved) exactly once"
                 (fs/exists? (fs/path dir "50_broken_from_qa_to_coder.handoff.dead")))
    (assert-false "the doubly-broken parcel no longer sits at its original path"
                  (fs/exists? both-broken))
    (assert= "the commit-resolve lookup is never invoked for a structurally corrupt candidate"
             [] @lookup-calls)))

;; resolve-dequeueable-candidates end-to-end (5-arity, injected resolve-fn?)
(let [dir (mk-tmp-dir)
      good (fs/path dir "50_good_from_qa_to_coder.handoff")
      bad (fs/path dir "50_bad_from_qa_to_coder.handoff")]
  (spit (str good) (git-handoff-content "goodcommit1"))
  (spit (str bad) (git-handoff-content "badcommit00"))
  (let [resolve-fn? (fn [commit] (= commit "goodcommit1"))
        dequeued (handoff-lib/resolve-dequeueable-candidates [good bad] [] [] resolve-fn?)]
    (assert= "resolve-dequeueable-candidates dequeues only the resolvable candidate"
             [good] dequeued)
    (assert-true "the bad candidate is quarantined as *.handoff.dead"
                 (fs/exists? (fs/path dir "50_bad_from_qa_to_coder.handoff.dead")))))

;; idempotency: re-running partition-unresolvable-commit over a directory
;; where the file has already been renamed to .dead must not throw, since
;; the renamed file is no longer among the candidates handed in (it is not
;; a *.handoff file any more, so a fresh handoff-files listing would never
;; re-surface it) - this mirrors quarantine-corrupt-handoff!'s own
;; :replace-existing false contract.
(let [dir (mk-tmp-dir)
      f (fs/path dir "50_again_from_qa_to_coder.handoff")]
  (spit (str f) (git-handoff-content "willnotresolve"))
  (handoff-lib/partition-unresolvable-commit [f] resolves-no)
  (let [remaining (handoff-lib/handoff-files dir)]
    (assert= "the quarantined file is no longer a dequeue candidate on a second pass" [] remaining)))

;; ── resolve-canonical-commit (BL-610 shape #5) ───────────────────────────
;; The send-time decision logic behind swarm_handoff.bb's canonical-commit,
;; extracted so matched-0/matched-1/matched-many/resolves-to-non-commit are
;; each a pure-value test - no real repo, no shelling to git, and no need to
;; load-file swarm_handoff.bb itself (it ends in a bare
;; (apply -main *command-line-args*) that System/exits on load with no args).

(let [[hash err] (handoff-lib/resolve-canonical-commit
                   "nothingmatches" "" (fn [_] "commit") (fn [_] "shouldnotrun"))]
  (assert= "matched-0: an empty disambiguate stdout is nil, never a hash" nil hash)
  (assert= "matched-0: the message honestly says 'matched 0', not 'resolves to ''"
           "Header 'commit' must resolve to exactly one Git object; 'nothingmatches' matched 0."
           err))

(let [[hash err] (handoff-lib/resolve-canonical-commit
                   "abc1234567" "abc1234567890abc\n"
                   (fn [_] "commit") (fn [_] "abc1234567"))]
  (assert= "matched-1, resolves to a commit: canonical short hash is returned" "abc1234567" hash)
  (assert= "matched-1, resolves to a commit: no error" nil err))

(let [[hash err] (handoff-lib/resolve-canonical-commit
                   "ambiguousab" "abc1234567890abc\ndef4567890123def\n"
                   (fn [_] "commit") (fn [_] "shouldnotrun"))]
  (assert= "matched-many: nil, never a hash" nil hash)
  (assert= "matched-many: the message states the actual count"
           "Header 'commit' must resolve to exactly one Git object; 'ambiguousab' matched 2."
           err))

(let [[hash err] (handoff-lib/resolve-canonical-commit
                   "atreenotacommit" "abc1234567890abc\n"
                   (fn [_] "tree") (fn [_] "shouldnotrun"))]
  (assert= "resolves-to-non-commit (tree): nil, never a hash" nil hash)
  (assert= "resolves-to-non-commit (tree): the message names the actual object type"
           "Header 'commit' must resolve to a commit; 'atreenotacommit' resolves to 'tree'."
           err))

(let [[hash err] (handoff-lib/resolve-canonical-commit
                   "ablobnotacommit" "abc1234567890abc\n"
                   (fn [_] "blob") (fn [_] "shouldnotrun"))]
  (assert= "resolves-to-non-commit (blob): nil, never a hash" nil hash)
  (assert= "resolves-to-non-commit (blob): the message names the actual object type"
           "Header 'commit' must resolve to a commit; 'ablobnotacommit' resolves to 'blob'."
           err))

;; ── handoff-body-lead (BL-519 / mono-router resident) ───────────────────

(let [dir (mk-tmp-dir)
      swarm-dir (fs/path dir ".swarmforge")]
  (fs/create-dirs swarm-dir)
  (spit (str (fs/path swarm-dir "roles.tsv"))
        (str "coder\tcoder\t" dir "\tswarmforge-coder\tCoder\tclaude\ttask\n"
             "cleaner\tcleaner\t" dir "\tswarmforge-cleaner\tCleaner\tclaude\ttask\n"
             "coordinator\tmaster\t" dir "\tswarmforge-coordinator\tCoordinator\taider\ttask\n"))
  (assert= "claude recipients omit the legacy re-read preamble"
           "" (handoff-lib/handoff-body-lead ["cleaner"] dir))
  (assert= "aider recipients keep the legacy re-read preamble"
           "Re-read your role and constitution.\n\n"
           (handoff-lib/handoff-body-lead ["coordinator"] dir))
  (assert= "mixed claude+aider broadcast keeps the legacy preamble"
           "Re-read your role and constitution.\n\n"
           (handoff-lib/handoff-body-lead ["coder" "coordinator"] dir)))

;; ── report ────────────────────────────────────────────────────────────────
(if (empty? @failures)
  (println "handoff_lib (BL-365): ALL TESTS PASSED")
  (do (println (str "handoff_lib (BL-365): " (count @failures) " FAILURE(S):"))
      (doseq [f @failures] (println f))
      (System/exit 1)))
