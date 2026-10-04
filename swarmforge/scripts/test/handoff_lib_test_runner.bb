#!/usr/bin/env bb
;; BL-365: TDD runner for handoff_lib.bb's new atomic-write!/corrupt-handoff?/
;; quarantine-corrupt-handoff!/partition-corrupt - the shared durability +
;; integrity-floor helpers. No real crash, no real timers: durability is
;; proven by injecting write-fn!/sync-fn!/rename-fn! and asserting the
;; ORDER (the "honest mechanical proof" the ticket asks for), and corruption
;; cases are constructed fixture content, not a race.

(ns handoff-lib-test-runner
  (:require [babashka.fs :as fs]
            [cheshire.core :as json]
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
        dequeued (handoff-lib/resolve-dequeueable-candidates
                  [good bad] [] [] resolve-fn? handoff-lib/default-ambulance-held? (constantly false))]
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

;; ── BL-655 ambulance-hold-04: partition-ambulance-held / resolve-dequeueable-
;;    candidates dequeue-site filtering (site 2) ────────────────────────────
;; held?-fn is injected (never the real fs-reading default-ambulance-held?)
;; so this exercises the pure partitioning logic deterministically, the same
;; injection posture partition-unresolvable-commit's resolve-fn? already
;; uses above.

(let [dir (mk-tmp-dir)
      for-654 (fs/path dir "50_a_from_specifier_to_coder.handoff")
      for-660 (fs/path dir "50_b_from_specifier_to_coder.handoff")
      held?-fn (fn [content] (str/includes? content "task: BL-660"))]
  (spit (str for-654) (git-handoff-content "aaaaaaaaaa" "BL-654"))
  (spit (str for-660) (git-handoff-content "bbbbbbbbbb" "BL-660"))
  (let [{:keys [held valid]} (handoff-lib/partition-ambulance-held [for-654 for-660] held?-fn)]
    (assert= "ambulance-hold-04: the parcel attributed to another ticket is held" [for-660] held)
    (assert= "ambulance-hold-04: the parcel attributed to the ambulance ticket stays valid" [for-654] valid)
    (assert-true "ambulance-hold-04: a held candidate is left byte-identical at its original path"
                 (fs/exists? for-660))
    (assert= "ambulance-hold-04: a held candidate's content is untouched"
             (git-handoff-content "bbbbbbbbbb" "BL-660") (slurp (str for-660)))))

(let [dir (mk-tmp-dir)
      for-654 (fs/path dir "50_a_from_specifier_to_coder.handoff")
      for-660 (fs/path dir "50_b_from_specifier_to_coder.handoff")
      held?-fn (fn [content] (str/includes? content "task: BL-660"))]
  (spit (str for-654) (git-handoff-content "aaaaaaaaaa" "BL-654"))
  (spit (str for-660) (git-handoff-content "bbbbbbbbbb" "BL-660"))
  (let [dequeued (handoff-lib/resolve-dequeueable-candidates
                  [for-654 for-660] [] [] (constantly true) held?-fn (constantly false))]
    (assert= "ambulance-hold-04: resolve-dequeueable-candidates end-to-end excludes only the held candidate"
             [for-654] dequeued)))

(let [dir (mk-tmp-dir)
      only-660 (fs/path dir "50_only_from_specifier_to_coder.handoff")]
  (spit (str only-660) (git-handoff-content "cccccccccc" "BL-660"))
  (let [dequeued (handoff-lib/resolve-dequeueable-candidates
                  [only-660] [] [] (constantly true) (constantly true))]
    (assert= "ambulance-hold-04: a fully-held new/ listing dequeues nothing (never falls through to a wrong pick)"
             [] dequeued)
    (assert-true "ambulance-hold-04: the held candidate is still sitting in new/, not moved anywhere"
                 (fs/exists? only-660))))

;; ── BL-1835: the pause hold exempts a briefing-instruction note addressed
;;    to the documenter - everything else, including this exact text to any
;;    other role (or another role's own COPY of a broadcast that also names
;;    the documenter in `to:`), stays held exactly as before. `recipient`
;;    is the per-copy inbox-owner header a real delivery stamps
;;    (handoff-protocol.md) - `to` alone can list more than one role for a
;;    broadcast. ─────────────────────────────────────────────────────────

(defn note-content
  ([to recipient message] (note-content to recipient message "coordinator"))
  ([to recipient message from]
   (str "id: 20260930T000000Z_000001_from_" from "\n"
        "from: " from "\nto: " to "\nrecipient: " recipient "\npriority: 00\ntype: note\nmessage: " message "\n"
        "\n" message "\n")))

(def bl1835-briefing-message "produce the morning briefing for 2026-10-01")

(let [dir (mk-tmp-dir)
      briefing-for-documenter (fs/path dir "00_a_from_coordinator_to_documenter.handoff")
      ordinary-for-documenter (fs/path dir "10_b_from_coordinator_to_documenter.handoff")
      briefing-for-coder (fs/path dir "00_c_from_coordinator_to_coder.handoff")
      land-note-for-qa (fs/path dir "10_d_from_coordinator_to_qa.handoff")
      git-handoff-for-documenter (fs/path dir "50_e_from_qa_to_documenter.handoff")
      ;; QA bounce D1: a broadcast's CODER copy (`to: coder,documenter`,
      ;; `recipient: coder`) carries the exact briefing text and names the
      ;; documenter in `to` too - the shape that wrongly passed the old
      ;; to-list-membership check.
      broadcast-coder-copy (fs/path dir "00_f_from_coordinator_to_coder.handoff")]
  (spit (str briefing-for-documenter) (note-content "documenter" "documenter" bl1835-briefing-message))
  (spit (str ordinary-for-documenter) (note-content "documenter" "documenter" "branch behind abc1234567: merge up"))
  (spit (str briefing-for-coder) (note-content "coder" "coder" bl1835-briefing-message))
  (spit (str land-note-for-qa) (note-content "QA" "QA" "land documenter briefing 0123456789"))
  (spit (str git-handoff-for-documenter) (git-handoff-content "abcdef0123" "BL-9001"))
  (spit (str broadcast-coder-copy) (note-content "coder,documenter" "coder" bl1835-briefing-message))
  (let [{:keys [held valid]} (handoff-lib/partition-pause-held
                               [briefing-for-documenter ordinary-for-documenter briefing-for-coder
                                land-note-for-qa git-handoff-for-documenter broadcast-coder-copy]
                               (constantly true))]
    (assert= "BL-1835: only the briefing note addressed to the documenter is exempt"
             [briefing-for-documenter] valid)
    (assert= "BL-1835: every other candidate, including a broadcast's coder copy, stays held"
             [ordinary-for-documenter briefing-for-coder land-note-for-qa git-handoff-for-documenter broadcast-coder-copy] held)
    (assert-true "BL-1835: a held candidate is left byte-identical at its original path"
                 (= (note-content "documenter" "documenter" "branch behind abc1234567: merge up")
                    (slurp (str ordinary-for-documenter))))))

;; A missing `recipient:` header (an untagged/legacy file) fails CLOSED -
;; held, never exempt - unlike mine?/stage-handoff-files' own "untagged
;; passes" convention, since this is a narrow allowlisted pause-hold bypass
;; rather than a general inbox filter.
(let [dir (mk-tmp-dir)
      untagged (fs/path dir "00_g_untagged.handoff")]
  (spit (str untagged)
        (str "id: t\nfrom: coordinator\nto: documenter\npriority: 00\ntype: note\nmessage: " bl1835-briefing-message "\n"
             "\n" bl1835-briefing-message "\n"))
  (let [{:keys [held valid]} (handoff-lib/partition-pause-held [untagged] (constantly true))]
    (assert= "BL-1835: a briefing note with no recipient header stays held (fail closed)" [untagged] held)
    (assert= "BL-1835: a briefing note with no recipient header is never exempt" [] valid)))

(let [dir (mk-tmp-dir)
      briefing-for-documenter (fs/path dir "00_a_from_coordinator_to_documenter.handoff")
      ordinary-for-documenter (fs/path dir "10_b_from_coordinator_to_documenter.handoff")]
  (spit (str briefing-for-documenter) (note-content "documenter" "documenter" bl1835-briefing-message))
  (spit (str ordinary-for-documenter) (note-content "documenter" "documenter" "hi"))
  (let [{:keys [held valid]} (handoff-lib/partition-pause-held
                               [briefing-for-documenter ordinary-for-documenter]
                               (constantly false))]
    (assert= "BL-1835: an inactive pause holds nothing, exemption or not (unchanged behavior)"
             [] held)
    (assert= "BL-1835: an inactive pause validates every candidate"
             [briefing-for-documenter ordinary-for-documenter] valid)))

;; resolve-dequeueable-candidates end-to-end: the exemption flows through the
;; shared dequeue path every live caller (ready_for_next_task.bb,
;; ready_for_next_batch.bb) actually uses, not just the isolated partition.
(let [dir (mk-tmp-dir)
      briefing-for-documenter (fs/path dir "00_a_from_coordinator_to_documenter.handoff")
      ordinary-for-documenter (fs/path dir "10_b_from_coordinator_to_documenter.handoff")]
  (spit (str briefing-for-documenter) (note-content "documenter" "documenter" bl1835-briefing-message))
  (spit (str ordinary-for-documenter) (note-content "documenter" "documenter" "hi"))
  (let [dequeued (handoff-lib/resolve-dequeueable-candidates
                  [briefing-for-documenter ordinary-for-documenter] [] []
                  (constantly true) (constantly false) (constantly true))]
    (assert= "BL-1835: resolve-dequeueable-candidates end-to-end serves only the briefing note while paused"
             [briefing-for-documenter] dequeued)
    (assert-true "BL-1835: the held ordinary note is still sitting in new/, not moved anywhere"
                 (fs/exists? ordinary-for-documenter))))

;; The two triggers' own literal: briefing-due-instruction("") IS the prefix
;; partition-pause-held matches by, and with a real day-key it is exactly
;; the text nightClosingCeremonyLive.ts's briefingInstruction(dayKey) sends
;; (BL-897 mirror: bl1458BriefingTriggerInvariants.property.test.js covers
;; the cross-language identity; this pins that the PREFIX used for matching
;; is a real prefix of the real instruction, never a drifted copy).
(assert-true "BL-1835: briefing-due-instruction-prefix is a true prefix of a real day's instruction"
             (str/starts-with? (briefing-generation-schedule-lib/briefing-due-instruction "2026-10-01")
                                handoff-lib/briefing-due-instruction-prefix))

;; ── BL-927: departing-role-blocking-handoff resolves the departing role
;;    from LIVE identity (via the injectable :live-role-fn seam), never the
;;    raw marker alone - unit-level coverage of the pure decision shape;
;;    the real tmux probe end of resident-live-role is covered by
;;    test_rotate_to_role_stuck_parcel_gate.sh's fake-tmux fixture. ────────

(defn bl927-fixture
  "A fresh target-root with roles.tsv rows for coder/cleaner/documenter, all
   master-resident (so mailbox-dir gives each its own <role> subfolder under
   the SAME worktree-path) - kept minimal since departing-role-blocking-
   handoff never reads worktree-path for anything but mailbox resolution."
  []
  (let [dir (mk-tmp-dir)
        swarm-dir (fs/path dir ".swarmforge")]
    (fs/create-dirs swarm-dir)
    (spit (str (fs/path swarm-dir "roles.tsv"))
          (str "coder\tmaster\t" dir "\tswarmforge-coder\tCoder\tclaude\ttask\n"
               "cleaner\tmaster\t" dir "\tswarmforge-cleaner\tCleaner\tclaude\tbatch\n"
               "documenter\tmaster\t" dir "\tswarmforge-documenter\tDocumenter\tclaude\ttask\n"))
    dir))

(defn bl927-write-marker! [dir content]
  (when content
    (spit (str (fs/path dir ".swarmforge" "mono-router-active-role")) content)))

(defn bl927-queue-parcel! [dir role name]
  (let [in-process (fs/path dir ".swarmforge" "handoffs" role "inbox" "in_process")]
    (fs/create-dirs in-process)
    (spit (str (fs/path in-process (str "00_" name ".handoff")))
          (git-handoff-content "aaaaaaaaaa" name))))

(defmacro bl927-with-fixture [[dir-sym marker] & body]
  `(let [~dir-sym (bl927-fixture)]
     (bl927-write-marker! ~dir-sym ~marker)
     (handoff-lib/set-project-root! ~dir-sym)
     (try
       ~@body
       (finally (handoff-lib/set-project-root! nil)))))

;; Agreement (the common, pre-BL-927 case): marker and live identity name
;; the same role - byte-identical result whether resolved from the marker
;; or from live-role-fn, with or without a real blocking parcel.
(bl927-with-fixture [dir "coder"]
  (assert= "bl927 agree, no parcel: proceeds (nil blocking-file)"
           {:role "coder" :blocking-file nil}
           (handoff-lib/departing-role-blocking-handoff {:live-role-fn (constantly "coder")})))

(bl927-with-fixture [dir "coder"]
  (bl927-queue-parcel! dir "coder" "stuck-agree")
  (let [result (handoff-lib/departing-role-blocking-handoff {:live-role-fn (constantly "coder")})]
    (assert= "bl927 agree, real parcel: :role is the marker/live role" "coder" (:role result))
    (assert-true "bl927 agree, real parcel: blocking-file names it"
                 (str/includes? (str (:blocking-file result)) "stuck-agree"))))

;; BL-927 residual case: marker diverged, live identity readable and
;; DIFFERENT - the departing role and its mailbox resolve from LIVE, never
;; the marker, regardless of what the marker role's own box holds.
(bl927-with-fixture [dir "cleaner"]
  (bl927-queue-parcel! dir "cleaner" "stuck-marker-only")
  (assert= "bl927 residual, live role's box empty: proceeds despite the marker role's real parcel"
           {:role "coder" :blocking-file nil}
           (handoff-lib/departing-role-blocking-handoff {:live-role-fn (constantly "coder")})))

(bl927-with-fixture [dir "cleaner"]
  (bl927-queue-parcel! dir "cleaner" "stuck-marker")
  (bl927-queue-parcel! dir "coder" "stuck-live")
  (let [result (handoff-lib/departing-role-blocking-handoff {:live-role-fn (constantly "coder")})]
    (assert= "bl927 residual, live role's box also blocked: :role is the LIVE role, never the marker" "coder" (:role result))
    (assert-true "bl927 residual: blocking-file names the LIVE role's own parcel"
                 (str/includes? (str (:blocking-file result)) "stuck-live"))
    (assert-false "bl927 residual: blocking-file never names the marker role's parcel"
                  (str/includes? (str (:blocking-file result)) "stuck-marker"))))

;; BL-927 invariant 2: an unreadable live identity fails OPEN - never falls
;; back to trusting the marker's claim alone, even with a real parcel
;; sitting under the marker role.
(bl927-with-fixture [dir "coder"]
  (bl927-queue-parcel! dir "coder" "stuck-unreadable")
  (assert= "bl927 unreadable live identity (nil): fails open despite a real marker-role parcel"
           {:role nil :blocking-file nil}
           (handoff-lib/departing-role-blocking-handoff {:live-role-fn (constantly nil)})))

(bl927-with-fixture [dir "coder"]
  (bl927-queue-parcel! dir "coder" "stuck-blank")
  (assert= "bl927 unreadable live identity (blank): fails open, blank is divergence not agreement"
           {:role nil :blocking-file nil}
           (handoff-lib/departing-role-blocking-handoff {:live-role-fn (constantly "   ")})))

;; BL-805 unchanged: missing/blank marker, or a marker naming a role absent
;; from roles.tsv, still fails open WITHOUT ever consulting live identity -
;; live-role-fn throwing proves the gate short-circuits before the probe,
;; not merely that it happens to agree with a nil result.
(let [never-called (fn [] (throw (ex-info "live-role-fn must not be called when the marker alone is undetermined" {})))]
  (bl927-with-fixture [dir nil]
    (assert= "bl927 missing marker: fails open, never consulting live-role-fn"
             {:role nil :blocking-file nil}
             (handoff-lib/departing-role-blocking-handoff {:live-role-fn never-called})))

  (bl927-with-fixture [dir "   "]
    (assert= "bl927 blank marker: fails open, never consulting live-role-fn"
             {:role nil :blocking-file nil}
             (handoff-lib/departing-role-blocking-handoff {:live-role-fn never-called})))

  (bl927-with-fixture [dir "nonexistent-role"]
    (assert= "bl927 unknown-role marker: fails open, never consulting live-role-fn"
             {:role nil :blocking-file nil}
             (handoff-lib/departing-role-blocking-handoff {:live-role-fn never-called}))))

;; The default (0-arg) form's real resident-live-role probe is deliberately
;; NOT exercised here - it needs a live tmux session, which is exactly what
;; this seam exists to keep out of the unit suite (see coder.prompt's
;; Design And Testability rule). Its integration coverage lives in
;; test_rotate_to_role_stuck_parcel_gate.sh's fake-tmux fixture instead.

;; ── BL-1316: apply-claim-effort! (the IO edge over claim-effort-decision) ──

(defn bl1316-fixture!
  "A fresh target-root with role's launch/<role>.claude-settings.json seeded
   with starting-effort, or no file at all when starting-effort is nil."
  [role starting-effort]
  (let [dir (mk-tmp-dir)
        launch-dir (fs/path dir ".swarmforge" "launch")]
    (fs/create-dirs launch-dir)
    (when starting-effort
      (spit (str (fs/path launch-dir (str role ".claude-settings.json")))
            (str "{\"model\":\"claude-sonnet-5\",\"effortLevel\":\"" starting-effort "\"}")))
    dir))

(defmacro bl1316-with-fixture [[dir-sym role starting-effort] & body]
  `(let [~dir-sym (bl1316-fixture! ~role ~starting-effort)]
     (handoff-lib/set-project-root! ~dir-sym)
     (try
       ~@body
       (finally (handoff-lib/set-project-root! nil)))))

(bl1316-with-fixture [dir "coder" "medium"]
  (let [result (handoff-lib/apply-claim-effort!
                {:role "coder" :backend "claude" :mutation-cost "high" :pack-default-effort "medium"})]
    (assert= "apply-claim-effort!: high mutation_cost applies and writes" {:apply? true :effort "high" :written? true} result)
    (assert-true "apply-claim-effort!: settings file effortLevel updated to high"
                 (str/includes? (slurp (str (fs/path dir ".swarmforge" "launch" "coder.claude-settings.json"))) "\"high\""))))

(bl1316-with-fixture [dir "coder" "high"]
  (let [result (handoff-lib/apply-claim-effort!
                {:role "coder" :backend "claude" :mutation-cost nil :pack-default-effort "low"})]
    (assert= "apply-claim-effort! invariant 3: absent mutation_cost restores the pack default, not the prior effort"
             {:apply? true :effort "low" :written? true} result)
    (assert-true "apply-claim-effort!: settings file restored to the pack default"
                 (str/includes? (slurp (str (fs/path dir ".swarmforge" "launch" "coder.claude-settings.json"))) "\"low\""))))

(bl1316-with-fixture [dir "coder@cursor2" "n/a"]
  (let [before (slurp (str (fs/path dir ".swarmforge" "launch" "coder@cursor2.claude-settings.json")))
        result (handoff-lib/apply-claim-effort!
                {:role "coder@cursor2" :backend "cursor" :mutation-cost "high" :pack-default-effort "low"})]
    (assert= "apply-claim-effort! invariant 2: a backend with no lever never applies"
             {:apply? false} result)
    (assert= "apply-claim-effort!: settings file untouched for a no-lever backend"
             before
             (slurp (str (fs/path dir ".swarmforge" "launch" "coder@cursor2.claude-settings.json"))))))

(bl1316-with-fixture [dir "coder" nil]
  (assert= "apply-claim-effort!: claim still succeeds (no throw) when the settings file is missing"
           {:apply? true :effort "high" :written? false}
           (handoff-lib/apply-claim-effort!
            {:role "coder" :backend "claude" :mutation-cost "high" :pack-default-effort "low"})))

;; ── BL-1317: record-effort-adapt! (the IO edge over adapt-effort-decision) ──
;; Reuses BL-1316's fixture: the file Adapt rewrites is the SAME launch
;; settings file the claim-time apply writes, because "in-memory / respawn
;; only" (declared invariant 1) means the effort reaches the agent through
;; the file a respawn reads - never through the pack conf.

(defn bl1317-fixture!
  "BL-1316's launch fixture plus a pack conf, so a test can assert the conf
   is byte-identical afterwards (declared invariant 1)."
  [role starting-effort]
  (let [dir (bl1316-fixture! role starting-effort)
        conf-dir (fs/path dir "swarmforge")]
    (fs/create-dirs conf-dir)
    (spit (str (fs/path conf-dir "swarmforge.conf"))
          (str "active_backlog_max_depth 2\n"
               "window " role " claude " role " --effort medium\n"))
    dir))

(defmacro bl1317-with-fixture [[dir-sym role starting-effort] & body]
  `(let [~dir-sym (bl1317-fixture! ~role ~starting-effort)]
     (handoff-lib/set-project-root! ~dir-sym)
     (try
       ~@body
       (finally (handoff-lib/set-project-root! nil)))))

(defn bl1317-conf-text [dir]
  (slurp (str (fs/path dir "swarmforge" "swarmforge.conf"))))

(defn bl1317-effort [dir role]
  (-> (slurp (str (fs/path dir ".swarmforge" "launch" (str role ".claude-settings.json"))))
      (json/parse-string true)
      :effortLevel))

;; A bounce climbs one notch above the claim-time baseline, and the pack conf
;; on disk is untouched (feature scenario bounce-climbs-one-notch-01).
(bl1317-with-fixture [dir "coder" "medium"]
  (let [before-conf (bl1317-conf-text dir)
        result (handoff-lib/record-effort-adapt!
                {:role "coder" :backend "claude" :mutation-cost "medium"
                 :pack-default-effort "medium" :signal "bounce"})]
    (assert-true "record-effort-adapt!: a bounce applies" (:apply? result))
    (assert= "record-effort-adapt!: a bounce climbs one notch" "high" (:effort result))
    (assert= "record-effort-adapt!: the seat's respawn effort is now high" "high" (bl1317-effort dir "coder"))
    (assert= "record-effort-adapt! invariant 1: the pack conf on disk is unchanged"
             before-conf (bl1317-conf-text dir))))

;; A clean completion short of the streak changes nothing but the counter;
;; the third one gives a notch back, and no further one goes below the
;; BL-1316 baseline (feature scenario clean-streak-may-drop-02).
(bl1317-with-fixture [dir "coder" "high"]
  (let [call (fn [] (handoff-lib/record-effort-adapt!
                     {:role "coder" :backend "claude" :mutation-cost "medium"
                      :pack-default-effort "medium" :signal "clean"}))
        before-conf (bl1317-conf-text dir)
        r1 (call) r2 (call) r3 (call)]
    (assert-false "record-effort-adapt!: one clean completion is not a streak" (:apply? r1))
    (assert-false "record-effort-adapt!: two clean completions are not a streak" (:apply? r2))
    (assert= "record-effort-adapt!: the counter accumulates across completions" 2 (:clean-streak r2))
    (assert-true "record-effort-adapt!: the third clean completion drops a notch" (:apply? r3))
    (assert= "record-effort-adapt!: the notch given back lands on the baseline" "medium" (bl1317-effort dir "coder"))
    (assert= "record-effort-adapt!: a spent streak starts over, so one long clean run cannot walk the ladder down"
             0 (:clean-streak r3))
    (let [r4 (call) r5 (call) r6 (call)]
      (assert-false "record-effort-adapt!: no further drop below the BL-1316 baseline (r4)" (:apply? r4))
      (assert-false "record-effort-adapt!: no further drop below the BL-1316 baseline (r5)" (:apply? r5))
      (assert-false "record-effort-adapt!: no further drop below the BL-1316 baseline (r6)" (:apply? r6))
      (assert= "record-effort-adapt!: the seat stays at its baseline" "medium" (bl1317-effort dir "coder")))
    (assert= "record-effort-adapt! invariant 1: a whole clean run still never touches the pack conf"
             before-conf (bl1317-conf-text dir))))

;; A bounce spends whatever clean run preceded it - under-thinking now
;; outweighs having been clean before.
(bl1317-with-fixture [dir "coder" "high"]
  (handoff-lib/record-effort-adapt!
   {:role "coder" :backend "claude" :mutation-cost "medium" :pack-default-effort "medium" :signal "clean"})
  (handoff-lib/record-effort-adapt!
   {:role "coder" :backend "claude" :mutation-cost "medium" :pack-default-effort "medium" :signal "bounce"})
  (let [after (handoff-lib/record-effort-adapt!
               {:role "coder" :backend "claude" :mutation-cost "medium"
                :pack-default-effort "medium" :signal "clean"})]
    (assert= "record-effort-adapt!: a bounce resets the clean streak" 1 (:clean-streak after))
    (assert-false "record-effort-adapt!: so the next clean completion cannot drop a notch" (:apply? after))))

;; A backend with no lever is never sent an effort at all (feature scenario
;; no-lever-skips-03).
(bl1317-with-fixture [dir "coder@cursor2" "n/a"]
  (let [before (slurp (str (fs/path dir ".swarmforge" "launch" "coder@cursor2.claude-settings.json")))
        before-conf (bl1317-conf-text dir)
        result (handoff-lib/record-effort-adapt!
                {:role "coder@cursor2" :backend "cursor" :mutation-cost "high"
                 :pack-default-effort "low" :signal "bounce"})]
    (assert-false "record-effort-adapt! invariant 2 carried forward: a lever-less backend applies nothing"
                  (:apply? result))
    (assert= "record-effort-adapt!: and names no effort a lever-less backend cannot take" nil (:effort result))
    (assert= "record-effort-adapt!: its settings file is untouched"
             before (slurp (str (fs/path dir ".swarmforge" "launch" "coder@cursor2.claude-settings.json"))))
    (assert= "record-effort-adapt! invariant 1: and so is the pack conf" before-conf (bl1317-conf-text dir))))

;; A missing settings file leaves the completion alone rather than throwing:
;; the completion has already happened, and a dial that cannot be retuned
;; must never turn a finished parcel into a failure. It also fails CLOSED
;; rather than assuming a rung - with no file there is no effort the seat is
;; known to be running at, and guessing one would write a flag the backend
;; may not accept. In particular it must not CREATE a settings file the
;; launcher never wrote.
(bl1317-with-fixture [dir "coder" nil]
  (let [result (handoff-lib/record-effort-adapt!
                {:role "coder" :backend "claude" :mutation-cost "high"
                 :pack-default-effort "low" :signal "bounce"})]
    (assert-false "record-effort-adapt!: a missing settings file applies nothing, and does not throw"
                  (:apply? result))
    (assert-true "record-effort-adapt!: and says why, rather than guessing a rung"
                 (str/includes? (str (:reason result)) "unknown prior effort"))
    (assert-false "record-effort-adapt!: no settings file is invented for a seat the launcher never wrote one for"
                  (fs/exists? (str (fs/path dir ".swarmforge" "launch" "coder.claude-settings.json"))))))

;; A climb Adapt recorded for a ticket survives that SAME ticket's re-claim -
;; without this the tier is inert exactly where it matters, because a bounce
;; sends the same ticket back to the same seat and the re-claim would reset
;; the effort that had just been raised.
(bl1317-with-fixture [dir "coder" "medium"]
  (handoff-lib/record-effort-adapt!
   {:role "coder" :backend "claude" :mutation-cost "medium" :pack-default-effort "medium"
    :ticket "BL-9001" :signal "bounce"})
  (assert= "the bounce climbed the seat to high" "high" (bl1317-effort dir "coder"))
  (let [same (handoff-lib/apply-claim-effort!
              {:role "coder" :backend "claude" :mutation-cost "medium"
               :pack-default-effort "medium" :ticket "BL-9001"})]
    (assert= "re-claiming the SAME ticket keeps the climbed effort" "high" (:effort same))
    (assert= "and the settings file still says high" "high" (bl1317-effort dir "coder")))
  (let [other (handoff-lib/apply-claim-effort!
               {:role "coder" :backend "claude" :mutation-cost "medium"
                :pack-default-effort "medium" :ticket "BL-9002"})]
    (assert= "BL-1316 invariant 3 still holds: a DIFFERENT ticket's claim restores its own baseline"
             "medium" (:effort other))
    (assert= "and the settings file is back to the baseline" "medium" (bl1317-effort dir "coder"))))

;; The carry-over is one-directional: it can never pull a claim BELOW what
;; the ticket's own mutation_cost bought.
(bl1317-with-fixture [dir "coder" "medium"]
  (handoff-lib/record-effort-adapt!
   {:role "coder" :backend "claude" :mutation-cost "low" :pack-default-effort "low"
    :ticket "BL-9003" :signal "clean"})
  (let [claimed (handoff-lib/apply-claim-effort!
                 {:role "coder" :backend "claude" :mutation-cost "high"
                  :pack-default-effort "low" :ticket "BL-9003"})]
    (assert= "a recorded effort below the claim-time baseline is ignored" "high" (:effort claimed))))

;; ── hotfix outbox-race: read-envelope-if-present ──────────────────────────
;; handoffd.bb:656 slurped an outbox parcel OUTSIDE its try; a parcel the
;; sending role archived between the listing and the read threw
;; FileNotFoundException straight through poll-once! and killed the daemon
;; (4x on 2026-09-02, same signature on 2026-08-30). The read now goes
;; through this helper, which answers {:vanished true} for a path that is
;; gone or unreadable instead of throwing.
(let [tmp (str (fs/create-temp-dir {:prefix "handoff-lib-envelope-"}))
      present (str (fs/path tmp "present.handoff"))
      unreadable (str (fs/path tmp "unreadable.handoff"))]
  (spit present "id: g1\nfrom: coder\nto: cleaner\npriority: 50\ntype: note\n\nhello\n")
  (spit unreadable "id: g2\nfrom: coder\nto: cleaner\n\nx\n")
  (fs/set-posix-file-permissions unreadable "---------")
  (let [ok (handoff-lib/read-envelope-if-present present)]
    (assert-true "read-envelope-if-present: a present parcel is parsed" (map? (:envelope ok)))
    (assert= "read-envelope-if-present: a present parcel exposes its headers" "cleaner"
             (get-in ok [:envelope :headers "to"]))
    (assert-false "read-envelope-if-present: a present parcel is not reported vanished" (:vanished ok)))
  (assert= "read-envelope-if-present: a path that no longer exists reports vanished instead of throwing"
           {:vanished true} (handoff-lib/read-envelope-if-present (str (fs/path tmp "gone.handoff"))))
  (assert= "read-envelope-if-present: an unreadable parcel (the deterministic stand-in for a mid-poll vanish) reports vanished instead of throwing"
           {:vanished true} (handoff-lib/read-envelope-if-present unreadable))
  (fs/set-posix-file-permissions unreadable "rw-------")
  (fs/delete-tree tmp))

;; ── run-respawn-bootstrap! routes through the chokepoint (BL-1524) ─────────
;; The static respawn_bootstrap_test_runner.bb checks only source TEXT (the
;; call appears in the function body); it cannot see whether the runtime
;; wiring actually reaches daemon-cycle-guard-lib/spawn-detached! with the
;; built argv. with-redefs proves the real call, not the text.
(let [captured (atom ::not-called)]
  (with-redefs [daemon-cycle-guard-lib/spawn-detached!
                (fn [argv] (reset! captured argv) {:stubbed true})
                handoff-lib/load-role-info (fn [_] {:agent "aider"})
                respawn-bootstrap-lib/argv-for-role (fn [_] ["node" "bootstrap.js" "--role" "coder"])]
    (handoff-lib/run-respawn-bootstrap! "fake-socket" "fake-session" "coder"))
  (assert= "run-respawn-bootstrap!: routes the built argv through daemon-cycle-guard-lib/spawn-detached!"
           ["node" "bootstrap.js" "--role" "coder"] @captured))

;; A no-op provider (argv-for-role returns nil) must never call spawn-detached!
;; at all, and must not throw.
(let [captured (atom ::not-called)]
  (with-redefs [daemon-cycle-guard-lib/spawn-detached! (fn [_] (reset! captured :called) {:stubbed true})
                handoff-lib/load-role-info (fn [_] {:agent "embedded"})
                respawn-bootstrap-lib/argv-for-role (fn [_] nil)]
    (handoff-lib/run-respawn-bootstrap! "fake-socket" "fake-session" "coder"))
  (assert= "run-respawn-bootstrap!: no argv means spawn-detached! is never called"
           ::not-called @captured))

;; ── BL-1616: worked-task-names-in attributes a completed Work note ────────
;; through the shared supersede-lib reader, and excludes a --no-work
;; completion (invariant 2). git_handoff attribution (pre-existing) is
;; re-asserted here too, so this block is the whole contract in one place.

(defn- write-handoff! [dir name content]
  (fs/create-dirs dir)
  (spit (str (fs/path dir name)) content))

(let [dir (mk-tmp-dir)]
  (write-handoff! dir "50_gh.handoff"
                   (str "id: x\nfrom: coder\nto: cleaner\npriority: 50\n"
                        "type: git_handoff\ntask: BL-9001\ncommit: abc1234567\n\npayload\n"))
  (assert= "worked-task-names-in: a git_handoff attributes through its task header"
           #{"BL-9001"} (handoff-lib/worked-task-names-in dir)))

(let [dir (mk-tmp-dir)]
  (write-handoff! dir "10_note.handoff"
                   (str "id: x\nfrom: coordinator\nto: coder\npriority: 10\n"
                        "type: note\nmessage: Work BL-9002: read backlog/active\n\n"
                        "Work BL-9002: read backlog/active\n"))
  (assert= "worked-task-names-in: a completed Work note attributes through supersede-lib/task-name-from-content"
           #{"BL-9002"} (handoff-lib/worked-task-names-in dir)))

(let [dir (mk-tmp-dir)]
  (write-handoff! dir "10_note.handoff"
                   (str "id: x\nfrom: coordinator\nto: coder\npriority: 10\n"
                        "type: note\nmessage: Work BL-9003: read backlog/active\n"
                        "no_work_reason: not ready\nno_work_at: 2026-08-17T00:05:00Z\n\n"
                        "Work BL-9003: read backlog/active\n"))
  (assert= "worked-task-names-in: a --no-work completion contributes nothing (invariant 2)"
           #{} (handoff-lib/worked-task-names-in dir)))

(let [dir (mk-tmp-dir)]
  (write-handoff! dir "10_note.handoff"
                   (str "id: x\nfrom: coordinator\nto: coder\npriority: 10\n"
                        "type: note\nmessage: branch behind abc1234567: merge up\n\n"
                        "branch behind abc1234567: merge up\n"))
  (assert= "worked-task-names-in: a note naming no ticket contributes nothing"
           #{} (handoff-lib/worked-task-names-in dir)))

(let [dir (mk-tmp-dir)]
  (write-handoff! (str (fs/path dir "batch_20260817T000000Z_001")) "10_note.handoff"
                   (str "id: x\nfrom: coordinator\nto: cleaner\npriority: 10\n"
                        "type: note\nmessage: Work BL-9004: read backlog/active\n\n"
                        "Work BL-9004: read backlog/active\n"))
  (assert= "worked-task-names-in: a completed Work note inside a batch_* subdirectory attributes too"
           #{"BL-9004"} (handoff-lib/worked-task-names-in dir)))

(let [dir (mk-tmp-dir)]
  (write-handoff! dir "50_gh.handoff"
                   (str "id: x\nfrom: coder\nto: cleaner\npriority: 50\n"
                        "type: git_handoff\ntask: BL-9001\ncommit: abc1234567\n\npayload\n"))
  (write-handoff! dir "10_note.handoff"
                   (str "id: y\nfrom: coordinator\nto: coder\npriority: 10\n"
                        "type: note\nmessage: Work BL-9002: read backlog/active\n\n"
                        "Work BL-9002: read backlog/active\n"))
  (assert= "worked-task-names-in: the union of git_handoff and Work-note attribution in one directory"
           #{"BL-9001" "BL-9002"} (handoff-lib/worked-task-names-in dir)))

;; ── BL-1655: remove-header! ──────────────────────────────────────────────
(let [dir (mk-tmp-dir)
      file (fs/path dir "10_x.handoff")]
  (write-handoff! dir "10_x.handoff"
                   (str "id: x\nfrom: coder\nto: cleaner\npriority: 50\n"
                        "type: git_handoff\nheld_by_seat: coder\ntask: BL-9001\n\npayload\n"))
  (handoff-lib/remove-header! file "held_by_seat")
  (assert= "remove-header!: the removed header no longer reads back"
           nil (handoff-lib/header-field file "held_by_seat"))
  (assert= "remove-header!: an unrelated header before it survives"
           "x" (handoff-lib/header-field file "id"))
  (assert= "remove-header!: an unrelated header after it survives"
           "BL-9001" (handoff-lib/header-field file "task"))
  (assert= "remove-header!: the body is untouched"
           "payload\n" (handoff-lib/body file)))

(let [dir (mk-tmp-dir)
      file (fs/path dir "10_y.handoff")]
  (write-handoff! dir "10_y.handoff"
                   (str "id: y\nfrom: coder\nto: cleaner\npriority: 50\n"
                        "type: git_handoff\ntask: BL-9002\n\npayload\n"))
  (handoff-lib/remove-header! file "held_by_seat")
  (assert= "remove-header!: a no-op when the header was never present"
           "BL-9002" (handoff-lib/header-field file "task")))

;; The prior test's own "body is untouched" assertion cannot discriminate
;; a mutant that drops the header/body boundary check entirely (removing
;; the `done?` guard so the scan strips ANY line starting with the field's
;; prefix, wherever it sits) - its body ("payload\n") never contains a
;; matching line, so that mutant survives it silently. A body line that
;; itself starts with the field's own prefix is the only fixture that
;; actually exercises the boundary - remove-header!'s own docstring states
;; "never touching the body" as an invariant, so this is what proves it.
(let [dir (mk-tmp-dir)
      file (fs/path dir "10_z.handoff")]
  (write-handoff! dir "10_z.handoff"
                   (str "id: z\nfrom: coder\nto: cleaner\npriority: 50\n"
                        "type: git_handoff\nheld_by_seat: coder\ntask: BL-9003\n\n"
                        "held_by_seat: this line is BODY TEXT, not a header - never removed\n"))
  (handoff-lib/remove-header! file "held_by_seat")
  (assert= "remove-header!: the header is dropped"
           nil (handoff-lib/header-field file "held_by_seat"))
  (assert= "remove-header!: a body line sharing the field's own prefix survives untouched (the header/body boundary, not a text match, decides)"
           "held_by_seat: this line is BODY TEXT, not a header - never removed\n"
           (handoff-lib/body file)))

;; ── BL-1837 D1: prompt-file-path agrees with swarmforge.sh's
;;    role_prompt_card_path for a local-model seat ──────────────────────────

(handoff-lib/set-project-root! "/bl1837-prompt-file-path-fixture-root")
(assert= "prompt-file-path: a local-model seat's '@' maps to '-'"
         "/bl1837-prompt-file-path-fixture-root/.swarmforge/prompts/coder-iq3.md"
         (handoff-lib/prompt-file-path "coder@iq3" "local-model"))
(assert= "prompt-file-path: a claude seat's '@' is unchanged"
         "/bl1837-prompt-file-path-fixture-root/.swarmforge/prompts/coder@2.md"
         (handoff-lib/prompt-file-path "coder@2" "claude"))
(assert= "prompt-file-path: the 1-arity form (agent unknown) stays unmapped"
         "/bl1837-prompt-file-path-fixture-root/.swarmforge/prompts/coder@iq3.md"
         (handoff-lib/prompt-file-path "coder@iq3"))
(handoff-lib/set-project-root! nil)

;; BL-897: this path and swarmforge.sh's role_prompt_card_path are two
;; readers of the SAME file across the bash/bb boundary; a test asserting
;; they agree is the constant-across-a-language-boundary rule, not an
;; incidental nicety - the two drifted exactly this way at mint (D1).
(let [swarmforge-sh (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "swarmforge.sh"))
      root (mk-tmp-dir)
      card-path (fn [role agent]
                  (let [result (daemon-cycle-guard-lib/sh!
                                "zsh" "-c"
                                (str "source '" swarmforge-sh "' '" root "' >/dev/null 2>&1; "
                                     "role_prompt_card_path '" role "' '" agent "'"))]
                    (str/trim (:out result))))]
  (handoff-lib/set-project-root! root)
  (try
    (doseq [[role agent] [["coder@iq3" "local-model"]
                          ["coder@2" "claude"]
                          ["documenter" "claude"]
                          ["coder@iq3" "claude"]]]
      (assert= (str "BL-897 agreement for role=" role " agent=" agent)
               (card-path role agent)
               (handoff-lib/prompt-file-path role agent)))
    (finally (handoff-lib/set-project-root! nil))))

;; ── BL-1837 D1: recompose-role-prompt! for a local-model seat ───────────────
;; A respawn/rotation of a seat named coder@iq3 must recompose the SAME
;; card file (prompts/coder-iq3.md) write_agent_instruction_file wrote at
;; launch - never the pre-fix prompts/coder@iq3.md, which a respawn would
;; silently recompose forever without ever refreshing what qwen's launch
;; line actually reads.
(let [dir (mk-tmp-dir)
      swarm-dir (fs/path dir ".swarmforge")
      prompts-dir (fs/path swarm-dir "prompts")]
  (fs/create-dirs prompts-dir)
  (spit (str (fs/path swarm-dir "roles.tsv"))
        (str "coder@iq3\tmaster\t" dir "\tswarmforge-coder@iq3\tCoder (iq3)\tlocal-model\ttask\n"))
  (spit (str (fs/path prompts-dir "coder-iq3.md")) "stale card\n")
  (spit (str (fs/path prompts-dir "coder-iq3.md.metadata.json"))
        (json/generate-string {:agent "local-model" :model "ista-iq3s-coder:latest"
                                :two-pack? false :overlay-prompt ""}))
  (handoff-lib/set-project-root! dir)
  (try
    (let [result (handoff-lib/recompose-role-prompt!
                  "coder@iq3"
                  {:compose-fn (fn [_role _opts] {:system-prompt "fresh card\n"})})]
      (assert-true "recompose-role-prompt! for a local-model seat: ok"
                   (:ok result))
      (assert= "recompose-role-prompt! for a local-model seat: rewrites prompts/coder-iq3.md (the '-' path), not prompts/coder@iq3.md"
               "fresh card\n"
               (slurp (str (fs/path prompts-dir "coder-iq3.md"))))
      (assert-false "recompose-role-prompt! for a local-model seat: never creates the pre-fix '@' path"
                     (fs/exists? (str (fs/path prompts-dir "coder@iq3.md")))))
    (finally (handoff-lib/set-project-root! nil))))

;; ── print-task follows the BL-1871 take-up (2026-10-03) ──────────────────
;; A local coder seat read "1) Execute the PAYLOAD (merge_and_process ...)",
;; ran merge_and_process as a shell command (exit 127), then ran the
;; lander's land_merge_path.bb looking for a merge - in task mode the
;; take-up has already moved the worktree. And a refused take-up was told
;; "Do NOT run ready_for_next.sh again" under a PARCEL_LINE saying "ask again".
(let [d (mk-tmp-dir)
      gh (str (fs/path d "00_x_from_coordinator_to_coder_for_coder.handoff"))
      wn (str (fs/path d "10_y_from_coordinator_to_coder_for_coder.handoff"))
      printed (fn [file opts] (with-out-str (handoff-lib/print-task file opts)))]
  (spit gh (str (git-handoff-content "abcdef0123" "BL-9001") "merge_and_process coordinator abcdef0123\n"))
  (spit wn (str "id: 20261003T000000Z_000009_from_coordinator\nfrom: coordinator\nto: coder\n"
                "priority: 10\ntype: note\nmessage: Work BL-9002: merge main first, then read backlog/active\n"
                "\nWork BL-9002\n"))
  (let [batch (with-out-str (handoff-lib/print-task gh))
        moved (printed gh {:task-mode? true :take-up :moved})
        stayed (printed gh {:task-mode? true :take-up :stay})
        refused (printed gh {:task-mode? true :take-up :refused})
        refused-note (printed wn {:task-mode? true :take-up :refused})]
    (assert-true "print-task: a batch seat (one-arity call) is still told to execute the merge_and_process payload"
                 (str/includes? batch "1) Execute the PAYLOAD (merge_and_process"))
    (doseq [[label out] [["moved" moved] ["stayed" stayed]]]
      (assert-false (str "print-task: a task-mode take-up that " label " never says to execute merge_and_process")
                    (str/includes? out "Execute the PAYLOAD"))
      (assert-true (str "print-task: a task-mode take-up that " label " says there is nothing to merge")
                   (str/includes? out "there is nothing to merge, and merge_and_process is not a shell command"))
      (assert-true (str "print-task: a task-mode take-up that " label " still names the ticket to implement")
                   (str/includes? out "2) Implement BL-9001 from backlog/active/")))
    (doseq [[label out] [["git_handoff" refused] ["Work note" refused-note]]]
      (assert-true (str "print-task: a refused take-up of a " label " says it was NOT taken up")
                   (str/includes? out "was NOT taken up"))
      (assert-true (str "print-task: a refused take-up of a " label " says to ask again once fixed")
                   (str/includes? out "then run ready_for_next.sh again"))
      (assert-false (str "print-task: a refused take-up of a " label " never says do not run ready_for_next again")
                    (str/includes? out "Do NOT run ready_for_next.sh again"))
      (assert-false (str "print-task: a refused take-up of a " label " gives no work or completion steps")
                    (or (str/includes? out "2) Implement") (str/includes? out "done_with_current.sh"))))))

;; ── print-task gives a reverse copy no work (2026-10-04) ─────────────────
;; Served the architect's non-forwarding copy of BL-1851, the iq3 coder was
;; told to read the spec, implement it and forward it. The copy is never
;; taken up, so it rebuilt the shipped ticket on BL-1858's line.
(let [d (mk-tmp-dir)
      rc (str (fs/path d "00_r_from_architect_to_coder_for_coder.handoff"))
      fwd (str (fs/path d "00_f_from_coordinator_to_coder_for_coder.handoff"))]
  (spit rc (str/replace-first (git-handoff-content "abcdef0123" "BL-9001")
                              "created_at:" "non-forwarding: true\ncreated_at:"))
  (spit fwd (git-handoff-content "abcdef0123" "BL-9001"))
  (assert-true "fixture: the reverse copy carries the marker" (handoff-lib/non-forwarding? rc))
  (let [out (with-redefs [handoff-lib/current-role (constantly "coder@iq3")]
              (with-out-str (handoff-lib/print-task rc {:task-mode? true :take-up :stay :next-stage "architect"
                                                        :ticket-file "/x/backlog/active/BL-9001-a.yaml"})))
        plain (with-redefs [handoff-lib/current-role (constantly "coder@iq3")]
                (with-out-str (handoff-lib/print-task fwd {:task-mode? true :take-up :moved :next-stage "architect"})))]
    (assert-true "print-task: a task-mode reverse copy says it carries no work"
                 (str/includes? out "It carries no work for you"))
    (assert-true "print-task: a task-mode reverse copy names done_with_current as the one step"
                 (str/includes? out "2) Run now: swarmforge/scripts/done_with_current.sh"))
    (doseq [[label needle] [["read or implement the ticket" "2) Read "] ["implement the ticket" "Implement BL-9001"]
                            ["commit" "3) Commit"] ["forward" "Forward it to"] ["write a draft" "tmp/handoff.txt"]]]
      (assert-false (str "print-task: a task-mode reverse copy is never told to " label)
                    (str/includes? out needle)))
    (assert-true "print-task: a forward parcel still gets the forward steps"
                 (str/includes? plain "4) Forward it to architect"))
    (assert-false "print-task: a forward parcel is not called a reverse copy"
                  (str/includes? plain "reverse copy")))
  (assert-true "print-task: a batch seat still merges a reverse copy's payload"
               (str/includes? (with-out-str (handoff-lib/print-task rc)) "1) Execute the PAYLOAD (merge_and_process")))

;; ── print-task names the served ticket's file (2026-10-03) ──────────────
;; "Implement BL-1916 from backlog/active/" sent a local seat to README.md,
;; then to asking the user, then to a guessed backlog/active/BL-1916.md.
(let [root (mk-tmp-dir)
      active (fs/path root "backlog" "active")
      _ (fs/create-dirs active)
      slugged (str (fs/path active "BL-9001-a-slug.yaml"))
      bare (str (fs/path active "BL-9003.yaml"))
      gh (str (fs/path root "00_x_from_coordinator_to_coder_for_coder.handoff"))
      wn (str (fs/path root "10_y_from_coordinator_to_coder_for_coder.handoff"))]
  (spit slugged "id: BL-9001\n")
  (spit bare "id: BL-9003\n")
  (spit (str (fs/path active "BL-90010-other.yaml")) "id: BL-90010\n")
  (assert= "active-ticket-file finds <id>-<slug>.yaml, absolute" (str (fs/absolutize slugged))
           (handoff-lib/active-ticket-file root "BL-9001"))
  (assert= "active-ticket-file finds a bare <id>.yaml" (str (fs/absolutize bare))
           (handoff-lib/active-ticket-file root "BL-9003"))
  (assert= "active-ticket-file is nil for a ticket not in active/" nil (handoff-lib/active-ticket-file root "BL-9002"))
  (assert= "active-ticket-file is nil for a non-id" nil (handoff-lib/active-ticket-file root "demo-task"))
  (assert= "active-ticket-file is nil without an active/ dir" nil (handoff-lib/active-ticket-file (mk-tmp-dir) "BL-9001"))
  (spit gh (str (git-handoff-content "abcdef0123" "BL-9001") "merge_and_process coordinator abcdef0123\n"))
  (spit wn (str "id: 20261003T000000Z_000010_from_coordinator\nfrom: coordinator\nto: coder\n"
                "priority: 10\ntype: note\nmessage: Work BL-9001: merge main first, then read backlog/active\n"
                "\nWork BL-9001\n"))
  (let [named (with-out-str (handoff-lib/print-task gh {:task-mode? true :take-up :moved
                                                         :ticket-file (handoff-lib/active-ticket-file root "BL-9001")}))
        note (with-out-str (handoff-lib/print-task wn {:task-mode? true :take-up :moved
                                                        :ticket-file (handoff-lib/active-ticket-file root "BL-9001")}))]
    (assert-true "print-task: step 2 names the ticket's file to read"
                 (str/includes? named (str "2) Read " (fs/absolutize slugged) " with read_file - it is BL-9001's spec")))
    (assert-false "print-task: a named file replaces the bare backlog/active/ pointer"
                  (str/includes? named "from backlog/active/ with"))
    (assert-true "print-task: a Work note names the ticket's file too"
                 (str/includes? note (str "The ticket it names is " (fs/absolutize slugged))))))

;; ── print-task spells out the forward (2026-10-03) ─────────────────────────
;; Told "3) Commit, git_handoff to the next role", a local seat ran
;; `git handoff next`, then wrote a file reading "handed off" into its outbox.
(require '[clojure.java.shell])
(let [d (mk-tmp-dir)
      gh (str (fs/path d "00_z_from_coordinator_to_coder_for_coder.handoff"))]
  (spit gh (str (git-handoff-content "abcdef0123" "BL-9001") "merge_and_process coordinator abcdef0123\n"))
  (let [cmd (handoff-lib/forward-draft-command "QA" "coder" "BL-9001")
        repo (mk-tmp-dir)
        git! (fn [& args] (apply clojure.java.shell/sh "git" "-C" repo args))]
    (git! "init" "-q")
    (spit (str (fs/path repo "a.txt")) "a\n")
    (git! "add" "a.txt")
    (git! "-c" "user.email=t@t" "-c" "user.name=t" "commit" "-q" "-m" "a")
    (let [r (clojure.java.shell/sh "bash" "-c" cmd :dir repo)
          head (str/trim (:out (git! "rev-parse" "HEAD")))]
      (assert= "forward-draft-command exits 0" 0 (:exit r))
      (assert= "forward-draft-command writes the five draft lines with HEAD's 10-character commit"
               (str "type: git_handoff\nto: QA\npriority: 50\ntask: BL-9001\ncommit: " (subs head 0 10) "\n")
               (slurp (str (fs/path repo "tmp" "handoff.txt"))))))
  (assert-true "forward-draft-command: a non-coder stage forwards at priority 00"
               (str/includes? (handoff-lib/forward-draft-command "documenter" "hardender" "BL-9001") "priority: 00"))
  (let [out (with-redefs [handoff-lib/current-role (constantly "coder@2")]
              (with-out-str (handoff-lib/print-task gh {:task-mode? true :take-up :moved :next-stage "QA"})))]
    (assert-true "print-task: the forward step names the next stage" (str/includes? out "4) Forward it to QA"))
    (assert-true "print-task: the forward step prints the draft command" (str/includes? out "> tmp/handoff.txt"))
    (assert-true "print-task: the forward step names swarm_handoff.sh" (str/includes? out "swarmforge/scripts/swarm_handoff.sh tmp/handoff.txt"))
    (assert-true "print-task: the commit byline is the seat's stage" (str/includes? out "ends `By coder.`"))
    (assert-true "print-task: done_with_current comes after the forward" (str/includes? out "5) Then run: swarmforge/scripts/done_with_current.sh"))
    (assert-false "print-task: the vague git_handoff line is gone" (str/includes? out "Commit, git_handoff to the next role")))
  (assert-true "print-task: without a next stage the step-3 line is unchanged"
               (str/includes? (with-out-str (handoff-lib/print-task gh {:task-mode? true :take-up :moved}))
                              "3) Commit, git_handoff to the next role")))

;; ── a bounce's task header carries its reason after the id (2026-10-03) ──
(let [root (mk-tmp-dir)
      active (fs/path root "backlog" "active")
      _ (fs/create-dirs active)
      f (str (fs/path active "BL-9101-a-slug.yaml"))
      gh (str (fs/path root "00_b_from_QA_to_coder_for_coder.handoff"))]
  (spit f "id: BL-9101\n")
  (assert= "leading-ticket-id: a bounce task name gives its id" "BL-9101" (handoff-lib/leading-ticket-id "BL-9101 [behavior: a reason]"))
  (assert= "leading-ticket-id: a bare id is itself" "BL-9101" (handoff-lib/leading-ticket-id "BL-9101"))
  (assert= "leading-ticket-id: a longer id is not cut short" nil (handoff-lib/leading-ticket-id "BL-9101x"))
  (assert= "leading-ticket-id: nil for a non-id task" nil (handoff-lib/leading-ticket-id "demo-task"))
  (assert= "active-ticket-file finds a bounced ticket's file" (str (fs/absolutize f))
           (handoff-lib/active-ticket-file root "BL-9101 [behavior: a reason]"))
  (spit gh (str (git-handoff-content "abcdef0123" "BL-9101 [behavior: a reason]") "merge_and_process QA abcdef0123\n"))
  (let [out (with-redefs [handoff-lib/current-role (constantly "coder")]
              (with-out-str (handoff-lib/print-task gh {:task-mode? true :take-up :moved :next-stage "QA"
                                                        :ticket-file (handoff-lib/active-ticket-file root "BL-9101 [behavior: a reason]")})))]
    (assert-true "print-task: a bounce's draft names the bare ticket id" (str/includes? out "\\ntask: BL-9101\\ncommit"))
    (assert-false "print-task: a bounce's draft never carries the reason" (str/includes? out "task: BL-9101 ["))))

;; ── report ────────────────────────────────────────────────────────────────
(if (empty? @failures)
  (println "handoff_lib (BL-365): ALL TESTS PASSED")
  (do (println (str "handoff_lib (BL-365): " (count @failures) " FAILURE(S):"))
      (doseq [f @failures] (println f))
      (System/exit 1)))
