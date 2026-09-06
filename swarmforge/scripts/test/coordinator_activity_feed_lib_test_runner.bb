#!/usr/bin/env bb
;; TDD runner for coordinator_activity_feed_lib.bb (GH-24) — no real git, no
;; real Telegram.

(ns coordinator-activity-feed-lib-test-runner
  (:require [babashka.fs :as fs]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "coordinator_activity_feed_lib.bb")))

;; tempDirTrapGuard.test.js finding: the manual (fs/delete-tree tmp) calls
;; below only run if the script reaches them - an uncaught exception
;; anywhere between fs/create-temp-dir and the final cleanup would leak the
;; temp root. A shutdown hook is the same belt-and-suspenders convention
;; post_qa_branch_sweep_lib_test_runner.bb already uses.
(def created-temp-dirs (atom []))
(.addShutdownHook (Runtime/getRuntime)
                   (Thread. (fn [] (doseq [d @created-temp-dirs] (try (fs/delete-tree d) (catch Exception _ nil))))))

(def failures (atom []))

(defn assert= [msg expected actual]
  (when (not= expected actual)
    (swap! failures conj (str "FAIL: " msg "\n  expected: " (pr-str expected) "\n  actual:   " (pr-str actual)))))

(defn assert-true [msg actual] (assert= msg true (boolean actual)))

;; ── new-handoffs ─────────────────────────────────────────────────────────
;; Realistic filenames throughout (<priority>_<rest>), never bare letters -
;; handoff-sort-key drops a fixed 3-character prefix, so a fixture shorter
;; than that would prove nothing about the real shape.

(def h1 {:file "50_20260906T100000Z_000001_a" :header {:type "note" :to "coder" :task nil :message "hi"}})
(def h2 {:file "50_20260906T110000Z_000002_b" :header {:type "git_handoff" :to "coder" :task "BL-1" :message nil}})
(def h3 {:file "50_20260906T120000Z_000003_c" :header {:type "note" :to "specifier" :task nil :message "bye"}})

(assert= "no cursor: every handoff is new"
         [h1 h2 h3]
         (coordinator-activity-feed-lib/new-handoffs [h1 h2 h3] nil))

(assert= "cursor at h1: only what sorts after it"
         [h2 h3]
         (coordinator-activity-feed-lib/new-handoffs [h1 h2 h3] (:file h1)))

(assert= "cursor at h3: nothing new"
         []
         (coordinator-activity-feed-lib/new-handoffs [h1 h2 h3] (:file h3)))

;; Non-vacuity for the priority-independence fix: a priority-00 file whose
;; TIMESTAMP is later than an already-posted priority-50 file's must still
;; be found as new. Before this fix, comparing raw filenames put every
;; "00_..." before every "50_..." lexically regardless of when either was
;; actually created - this exact shape silently dropped a genuinely later
;; trace forever.
(def old-p50 {:file "50_20260906T100000Z_000001_old" :header {:type "note" :to "coder" :task nil :message "old"}})
(def new-p00 {:file "00_20260906T200000Z_000002_new" :header {:type "note" :to "coder" :task nil :message "new"}})

(assert= "a later priority-00 file is still found new after a cursor at an earlier priority-50 file"
         [new-p00]
         (coordinator-activity-feed-lib/new-handoffs [old-p50 new-p00] (:file old-p50)))

(assert= "handoff-sort-key drops only the fixed priority prefix, nothing more"
         "20260906T100000Z_000001_old"
         (coordinator-activity-feed-lib/handoff-sort-key (:file old-p50)))

;; ── new-commits ──────────────────────────────────────────────────────────

(def c1 {:sha "s1" :subject "Close BL-1: move to done. By coordinator."})
(def c2 {:sha "s2" :subject "Promote BL-2: paused → active for coder"})
(def c3 {:sha "s3" :subject "some unrelated commit"})

(assert= "no cursor: every commit is new"
         [c1 c2 c3]
         (coordinator-activity-feed-lib/new-commits [c1 c2 c3] nil))

(assert= "cursor at s1: only what comes after"
         [c2 c3]
         (coordinator-activity-feed-lib/new-commits [c1 c2 c3] "s1"))

(assert= "cursor sha not found: empty, never replay the whole backlog"
         []
         (coordinator-activity-feed-lib/new-commits [c1 c2 c3] "nope"))

;; ── parse-bookkeeping-subject ────────────────────────────────────────────

(assert= "a close commit parses"
         {:action :close :ticket "BL-1412"}
         (coordinator-activity-feed-lib/parse-bookkeeping-subject
          "Close BL-1412: move to done. By coordinator."))

(assert= "a promote commit parses"
         {:action :promote :ticket "BL-725" :role "coder"}
         (coordinator-activity-feed-lib/parse-bookkeeping-subject
          "Promote BL-725: paused → active for coder"))

(assert= "a GH-numbered ticket parses too"
         {:action :close :ticket "GH-24"}
         (coordinator-activity-feed-lib/parse-bookkeeping-subject
          "Close GH-24: move to done. By coordinator."))

(assert= "an unrelated subject does not parse"
         nil
         (coordinator-activity-feed-lib/parse-bookkeeping-subject "docs: update the README"))

(assert= "a merge commit does not parse"
         nil
         (coordinator-activity-feed-lib/parse-bookkeeping-subject "Merge main abc123 into coder."))

;; ── format-line ──────────────────────────────────────────────────────────

(assert= "a handoff with a task formats task, not message"
         "→ git_handoff → coder (BL-1)"
         (coordinator-activity-feed-lib/format-line
          {:kind :handoff :type "git_handoff" :to "coder" :task "BL-1" :message nil}))

(assert= "a handoff with no task falls back to message"
         "→ note → coder: hi"
         (coordinator-activity-feed-lib/format-line
          {:kind :handoff :type "note" :to "coder" :task nil :message "hi"}))

(assert= "a close commit formats"
         "✓ closed BL-1412"
         (coordinator-activity-feed-lib/format-line
          {:kind :commit :action :close :ticket "BL-1412"}))

(assert= "a promote commit formats"
         "↑ promoted BL-725 → coder"
         (coordinator-activity-feed-lib/format-line
          {:kind :commit :action :promote :ticket "BL-725" :role "coder"}))

;; ── handoff-header-from-text ─────────────────────────────────────────────

(assert= "header fields parse from raw handoff text"
         {:type "git_handoff" :to "coder" :task "BL-1" :message nil}
         (coordinator-activity-feed-lib/handoff-header-from-text
          "type: git_handoff\nto: coder\ntask: BL-1\n\nmerge_and_process ...\n"))

;; ── tick! ────────────────────────────────────────────────────────────────

;; Hardener fix (tempDirTrapGuard): registered into the file-level
;; created-temp-dirs/shutdown-hook pair above, so an assertion failure or
;; crash anywhere below still removes the fixture root - the tail-of-file
;; (fs/delete-tree tmp) alone never runs on that path.
(def tmp (fs/create-temp-dir))
(swap! created-temp-dirs conj tmp)

(defn reset-tick-fixture! []
  (fs/delete-tree tmp)
  (fs/create-dirs tmp))

;; Scenario 03: nothing new posts nothing, cursor untouched.
(reset-tick-fixture!)
(let [posted (atom [])
      result (coordinator-activity-feed-lib/tick!
              {:daemon-dir (str tmp)
               :list-sent-handoffs (fn [] [])
               :list-bookkeeping-commits (fn [] [])
               :post! (fn [line] (swap! posted conj line) true)})]
  (assert= "no traces: nothing posted" [] @posted)
  (assert= "no traces: zero posted count" 0 (:posted result)))

;; Scenario 01/02: one handoff and one bookkeeping commit both post, in order.
(reset-tick-fixture!)
(let [posted (atom [])
      result (coordinator-activity-feed-lib/tick!
              {:daemon-dir (str tmp)
               :list-sent-handoffs (fn [] [{:file "00_a" :header {:type "note" :to "coder" :task nil :message "hi"}}])
               :list-bookkeeping-commits (fn [] [{:sha "s1" :subject "Close BL-1412: move to done. By coordinator."}])
               :post! (fn [line] (swap! posted conj line) true)})]
  (assert= "both traces posted, handoffs first" ["→ note → coder: hi" "✓ closed BL-1412"] @posted)
  (assert= "cursor advanced past both"
           {:handoff-cursor "00_a" :commit-cursor "s1"}
           (coordinator-activity-feed-lib/read-cursor (str tmp))))

;; Scenario 04: a persisted cursor survives a restart (fresh tick!, same dir).
(let [posted (atom [])]
  (coordinator-activity-feed-lib/tick!
   {:daemon-dir (str tmp)
    :list-sent-handoffs (fn [] [{:file "00_a" :header {:type "note" :to "coder" :task nil :message "hi"}}])
    :list-bookkeeping-commits (fn [] [{:sha "s1" :subject "Close BL-1412: move to done. By coordinator."}])
    :post! (fn [line] (swap! posted conj line) true)})
  (assert= "restart: already-surfaced traces are not re-posted" [] @posted))

;; Scenario 05: a failed send stops the tick and does not advance past it;
;; the next tick retries the SAME trace, exactly once total.
(reset-tick-fixture!)
(let [posted (atom [])
      fail-once (atom true)
      post! (fn [line]
              (if @fail-once
                (do (reset! fail-once false) false)
                (do (swap! posted conj line) true)))
      list-h (fn [] [{:file "00_a" :header {:type "note" :to "coder" :task nil :message "hi"}}])
      list-c (fn [] [])]
  (coordinator-activity-feed-lib/tick! {:daemon-dir (str tmp) :list-sent-handoffs list-h :list-bookkeeping-commits list-c :post! post!})
  (assert= "first tick: the failed send posted nothing" [] @posted)
  (assert= "first tick: cursor did not advance past the failure"
           {:handoff-cursor nil :commit-cursor nil}
           (coordinator-activity-feed-lib/read-cursor (str tmp)))
  (coordinator-activity-feed-lib/tick! {:daemon-dir (str tmp) :list-sent-handoffs list-h :list-bookkeeping-commits list-c :post! post!})
  (assert= "second tick: the retried trace posts exactly once" ["→ note → coder: hi"] @posted)
  (assert= "second tick: cursor now advanced"
           {:handoff-cursor "00_a" :commit-cursor nil}
           (coordinator-activity-feed-lib/read-cursor (str tmp))))

(fs/delete-tree tmp)

(when (seq @failures)
  (doseq [f @failures] (println f))
  (System/exit 1))

(println "ALL PASS: coordinator_activity_feed_lib.bb")
