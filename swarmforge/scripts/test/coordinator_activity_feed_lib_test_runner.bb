#!/usr/bin/env bb
;; TDD runner for coordinator_activity_feed_lib.bb (GH-24 / BL-1454) — no
;; real git, no real Telegram, no real filesystem walk.

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

;; ── new-handoffs (BL-1454: bare filenames, not {:file :header} maps) ──────
;; Realistic filenames throughout (<priority>_<rest>), never bare letters -
;; handoff-sort-key drops a fixed 3-character prefix, so a fixture shorter
;; than that would prove nothing about the real shape.

(def n1 "50_20260906T100000Z_000001_a")
(def n2 "50_20260906T110000Z_000002_b")
(def n3 "50_20260906T120000Z_000003_c")

(assert= "no cursor: every name is new"
         [n1 n2 n3]
         (coordinator-activity-feed-lib/new-handoffs [n1 n2 n3] nil))

(assert= "cursor at n1: only what sorts after it"
         [n2 n3]
         (coordinator-activity-feed-lib/new-handoffs [n1 n2 n3] n1))

(assert= "cursor at n3: nothing new"
         []
         (coordinator-activity-feed-lib/new-handoffs [n1 n2 n3] n3))

;; Non-vacuity for the priority-independence fix: a priority-00 file whose
;; TIMESTAMP is later than an already-posted priority-50 file's must still
;; be found as new. Before this fix, comparing raw filenames put every
;; "00_..." before every "50_..." lexically regardless of when either was
;; actually created - this exact shape silently dropped a genuinely later
;; trace forever.
(def old-p50 "50_20260906T100000Z_000001_old")
(def new-p00 "00_20260906T200000Z_000002_new")

(assert= "a later priority-00 file is still found new after a cursor at an earlier priority-50 file"
         [new-p00]
         (coordinator-activity-feed-lib/new-handoffs [old-p50 new-p00] old-p50))

(assert= "handoff-sort-key drops only the fixed priority prefix, nothing more"
         "20260906T100000Z_000001_old"
         (coordinator-activity-feed-lib/handoff-sort-key old-p50))

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

(defn headers-by-name [pairs]
  ;; pairs: [[name header] ...] -> a read-handoff-header fn, so a test can
  ;; assert exactly which names get their header read (invariant 3).
  (let [m (into {} pairs)]
    (fn [name] (get m name))))

;; BL-1454 scenario 01 / invariant: the FIRST tick (no cursor file at all)
;; seeds both cursors at the newest trace of each kind and posts nothing
;; historical, even though traces already exist.
(reset-tick-fixture!)
(let [posted (atom [])
      names ["00_a" "00_b" "00_c"]
      headers (headers-by-name [["00_a" {:type "note" :to "coder" :task nil :message "hi"}]
                                 ["00_b" {:type "note" :to "coder" :task nil :message "hi2"}]
                                 ["00_c" {:type "note" :to "coder" :task nil :message "hi3"}]])
      commits [{:sha "s1" :subject "Close BL-1: move to done. By coordinator."}
               {:sha "s2" :subject "Close BL-2: move to done. By coordinator."}]
      result (coordinator-activity-feed-lib/tick!
              {:daemon-dir (str tmp)
               :list-sent-handoff-names (fn [] names)
               :read-handoff-header headers
               :list-bookkeeping-commits (fn [] commits)
               :post! (fn [line] (swap! posted conj line) true)})]
  (assert= "first-ever tick: nothing posted even though traces already exist" [] @posted)
  (assert= "first-ever tick: result names it a seed" {:posted 0 :seeded true} result)
  (assert= "first-ever tick: cursor seeded at the newest handoff and newest commit"
           {:handoff-cursor "00_c" :commit-cursor "s2"}
           (coordinator-activity-feed-lib/read-cursor (str tmp))))

;; A following tick, with one new trace of each kind past the seeded
;; cursor, posts exactly those and nothing older.
(let [posted (atom [])
      names ["00_a" "00_b" "00_c" "00_d"]
      headers (headers-by-name [["00_a" {:type "note" :to "coder" :task nil :message "hi"}]
                                 ["00_b" {:type "note" :to "coder" :task nil :message "hi2"}]
                                 ["00_c" {:type "note" :to "coder" :task nil :message "hi3"}]
                                 ["00_d" {:type "note" :to "coder" :task nil :message "hi4"}]])
      commits [{:sha "s1" :subject "Close BL-1: move to done. By coordinator."}
               {:sha "s2" :subject "Close BL-2: move to done. By coordinator."}
               {:sha "s3" :subject "Close BL-3: move to done. By coordinator."}]
      result (coordinator-activity-feed-lib/tick!
              {:daemon-dir (str tmp)
               :list-sent-handoff-names (fn [] names)
               :read-handoff-header headers
               :list-bookkeeping-commits (fn [] commits)
               :post! (fn [line] (swap! posted conj line) true)})]
  (assert= "post-seed tick: only the one new handoff and one new commit post"
           ["→ note → coder: hi4" "✓ closed BL-3"] @posted)
  (assert= "post-seed tick: posted count is 2" 2 (:posted result)))

;; Scenario 03: nothing new posts nothing, cursor untouched (already seeded).
(reset-tick-fixture!)
(coordinator-activity-feed-lib/write-cursor! (str tmp) {:handoff-cursor "00_a" :commit-cursor "s1"})
(let [posted (atom [])
      result (coordinator-activity-feed-lib/tick!
              {:daemon-dir (str tmp)
               :list-sent-handoff-names (fn [] ["00_a"])
               :read-handoff-header (headers-by-name [])
               :list-bookkeeping-commits (fn [] [{:sha "s1" :subject "Close BL-1: move to done. By coordinator."}])
               :post! (fn [line] (swap! posted conj line) true)})]
  (assert= "no new traces: nothing posted" [] @posted)
  (assert= "no new traces: zero posted count" 0 (:posted result)))

;; Scenario 05: a failed send stops the tick and does not advance past it;
;; the next tick retries the SAME trace, exactly once total.
(reset-tick-fixture!)
(coordinator-activity-feed-lib/write-cursor! (str tmp) {:handoff-cursor "000" :commit-cursor nil})
(let [posted (atom [])
      fail-once (atom true)
      post! (fn [line]
              (if @fail-once
                (do (reset! fail-once false) false)
                (do (swap! posted conj line) true)))
      list-names (fn [] ["00_a"])
      headers (headers-by-name [["00_a" {:type "note" :to "coder" :task nil :message "hi"}]])
      list-c (fn [] [])]
  (coordinator-activity-feed-lib/tick! {:daemon-dir (str tmp) :list-sent-handoff-names list-names
                                         :read-handoff-header headers :list-bookkeeping-commits list-c :post! post!})
  (assert= "first tick: the failed send posted nothing" [] @posted)
  (assert= "first tick: cursor did not advance past the failure"
           {:handoff-cursor "000" :commit-cursor nil}
           (coordinator-activity-feed-lib/read-cursor (str tmp)))
  (coordinator-activity-feed-lib/tick! {:daemon-dir (str tmp) :list-sent-handoff-names list-names
                                         :read-handoff-header headers :list-bookkeeping-commits list-c :post! post!})
  (assert= "second tick: the retried trace posts exactly once" ["→ note → coder: hi"] @posted)
  (assert= "second tick: cursor now advanced"
           {:handoff-cursor "00_a" :commit-cursor nil}
           (coordinator-activity-feed-lib/read-cursor (str tmp))))

;; ── invariant 1: a tick posts at most its cap ─────────────────────────────
(reset-tick-fixture!)
(coordinator-activity-feed-lib/write-cursor! (str tmp) {:handoff-cursor "00_00" :commit-cursor nil})
(let [names (mapv #(str "00_" (format "%02d" %)) (range 0 51)) ;; 00_00..00_50: cursor + 50 newer
      headers (headers-by-name (mapv (fn [n] [n {:type "note" :to "coder" :task n :message nil}]) names))
      posted (atom [])
      result (coordinator-activity-feed-lib/tick!
              {:daemon-dir (str tmp)
               :list-sent-handoff-names (fn [] names)
               :read-handoff-header headers
               :list-bookkeeping-commits (fn [] [])
               :post! (fn [line] (swap! posted conj line) true)
               :post-cap 20})]
  (assert= "capped tick: posts exactly the cap" 20 (count @posted))
  (assert= "capped tick: result flags capped" {:posted 20 :capped true} result)
  (assert= "capped tick: first posted line is the 1st newer trace"
           "→ note → coder (00_01)" (first @posted))
  (assert= "capped tick: last posted line is the 20th newer trace"
           "→ note → coder (00_20)" (last @posted))
  (assert= "capped tick: cursor lands on the 20th newer trace"
           "00_20" (:handoff-cursor (coordinator-activity-feed-lib/read-cursor (str tmp))))

  (let [posted2 (atom [])
        result2 (coordinator-activity-feed-lib/tick!
                 {:daemon-dir (str tmp)
                  :list-sent-handoff-names (fn [] names)
                  :read-handoff-header headers
                  :list-bookkeeping-commits (fn [] [])
                  :post! (fn [line] (swap! posted2 conj line) true)
                  :post-cap 20})]
    (assert= "second capped tick: posts the next 20, none repeated" 20 (count @posted2))
    (assert= "second capped tick: no overlap with the first batch"
             #{} (clojure.set/intersection (set @posted) (set @posted2)))
    (assert= "second capped tick: first line is the 21st newer trace"
             "→ note → coder (00_21)" (first @posted2))))

;; ── invariant 1: a tick stops at its own deadline ─────────────────────────
(reset-tick-fixture!)
(coordinator-activity-feed-lib/write-cursor! (str tmp) {:handoff-cursor "00_00" :commit-cursor nil})
(let [names (mapv #(str "00_" (format "%02d" %)) (range 0 51))
      headers (headers-by-name (mapv (fn [n] [n {:type "note" :to "coder" :task n :message nil}]) names))
      clock (atom 0)
      posted (atom [])
      result (coordinator-activity-feed-lib/tick!
              {:daemon-dir (str tmp)
               :list-sent-handoff-names (fn [] names)
               :read-handoff-header headers
               :list-bookkeeping-commits (fn [] [])
               :post! (fn [line] (swap! posted conj line) (swap! clock + 10000) true)
               :now-ms (fn [] @clock)
               :post-cap 1000
               :deadline-ms 30000})]
  (assert= "deadline tick: posts at most 3 lines (0,10,20 < 30000; 30000 stops)" 3 (count @posted))
  (assert= "deadline tick: result flags deadline-reached" true (:deadline-reached result))
  (assert-true "deadline tick: returns at or before the deadline (never past it)" (<= @clock 30000)))

;; ── invariant 2: the cursor is persisted after EVERY successful post,
;; not only at the end of the loop - proven by an interrupt (post! throws)
;; that never lets the loop reach a graceful end. ─────────────────────────
(reset-tick-fixture!)
(coordinator-activity-feed-lib/write-cursor! (str tmp) {:handoff-cursor "00_00" :commit-cursor nil})
(let [names (mapv #(str "00_" (format "%02d" %)) (range 0 51))
      headers (headers-by-name (mapv (fn [n] [n {:type "note" :to "coder" :task n :message nil}]) names))
      write-count (atom 0)
      real-write! coordinator-activity-feed-lib/write-cursor!
      spy-write! (fn [dir cur] (swap! write-count inc) (real-write! dir cur))
      posted (atom [])
      post! (fn [line]
              (if (>= (count @posted) 3)
                (throw (ex-info "interrupted mid-batch" {}))
                (do (swap! posted conj line) true)))]
  (assert-true "interrupted tick throws"
               (try (coordinator-activity-feed-lib/tick!
                     {:daemon-dir (str tmp)
                      :list-sent-handoff-names (fn [] names)
                      :read-handoff-header headers
                      :list-bookkeeping-commits (fn [] [])
                      :post! post!
                      :write-cursor! spy-write!})
                    false
                    (catch Exception _ true)))
  (assert= "interrupted tick: exactly 3 posts succeeded before the throw" 3 (count @posted))
  (assert= "interrupted tick: cursor store received a write after each of the 3 posts" 3 @write-count)
  (assert= "interrupted tick: the persisted cursor names the 3rd newer trace"
           "00_03" (:handoff-cursor (coordinator-activity-feed-lib/read-cursor (str tmp))))
  (let [posted2 (atom [])]
    (coordinator-activity-feed-lib/tick!
     {:daemon-dir (str tmp)
      :list-sent-handoff-names (fn [] names)
      :read-handoff-header headers
      :list-bookkeeping-commits (fn [] [])
      :post! (fn [line] (swap! posted2 conj line) true)})
    (assert= "restarted tick: the 4th newer trace posts first, nothing re-posted"
             "→ note → coder (00_04)" (first @posted2))))

;; ── invariant 3: header reads are proportional to what is NEW, never to
;; the total count of sent handoffs ────────────────────────────────────────
(reset-tick-fixture!)
(coordinator-activity-feed-lib/write-cursor! (str tmp) {:handoff-cursor "00_0997" :commit-cursor nil})
(let [total 1000
      names (mapv #(str "00_" (format "%04d" %)) (range 0 total)) ;; 997 old, 2 new (0998,0999)
      read-count (atom 0)
      read-header (fn [name] (swap! read-count inc) {:type "note" :to "coder" :task name :message nil})
      posted (atom [])]
  (coordinator-activity-feed-lib/tick!
   {:daemon-dir (str tmp)
    :list-sent-handoff-names (fn [] names)
    :read-handoff-header read-header
    :list-bookkeeping-commits (fn [] [])
    :post! (fn [line] (swap! posted conj line) true)})
  (assert= "1000 sent handoffs, cursor at the 997th: only the 2 newer names have their header read"
           2 @read-count)
  (assert= "posted count matches the new-name count, not the total" 2 (count @posted)))

(fs/delete-tree tmp)

(when (seq @failures)
  (doseq [f @failures] (println f))
  (System/exit 1))

(println "ALL PASS: coordinator_activity_feed_lib.bb")
