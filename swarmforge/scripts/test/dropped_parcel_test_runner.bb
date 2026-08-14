#!/usr/bin/env bb
;; TDD runner for chase_sweep_lib.bb's BL-719 dropped-parcel functions.
;; decide-dropped-parcel?/within-dropped-parcel-cooldown? are pure
;; assertions, no real mailbox I/O; the scanning functions below get their
;; own fixture-based tests further down (real fs I/O against a temp dir, no
;; live swarm/tmux/daemon) - mirrors dispatch_gap_test_runner.bb's own
;; split exactly.
(ns dropped-parcel-test-runner
  (:require [babashka.fs :as fs]
            [clojure.string :as str]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "chase_sweep_lib.bb")))

(def failures (atom []))

(defn assert= [msg expected actual]
  (when (not= expected actual)
    (swap! failures conj (str "FAIL: " msg "\n  expected: " (pr-str expected) "\n  actual:   " (pr-str actual)))))

;; ── decide-dropped-parcel? (pure) ─────────────────────────────────────────
;; BL-719 dropped-parcel-nudge-01: trail + no live mail + stale → nudge.

(assert= "dropped-01: trail, no live mail, stale trail → true"
         true
         (chase-sweep-lib/decide-dropped-parcel?
          {:has-trail? true :live-mail? false :newest-trail-ms 1000}
          100000 5000))

;; BL-719 dropped-parcel-nudge-02: live mail suppresses regardless of age.
(assert= "dropped-02a: live mail in new/ suppresses even with a stale trail"
         false
         (chase-sweep-lib/decide-dropped-parcel?
          {:has-trail? true :live-mail? true :newest-trail-ms 1000}
          100000 5000))

(assert= "dropped-02b: live mail in in_process/ suppresses even with a stale trail"
         false
         (chase-sweep-lib/decide-dropped-parcel?
          {:has-trail? true :live-mail? true :newest-trail-ms 1}
          1000000 5000))

;; BL-719 dropped-parcel-nudge-03: fresh trail (within threshold) → no nudge.
(assert= "dropped-03: trail newer than the stall threshold → false (normal inter-stage gap)"
         false
         (chase-sweep-lib/decide-dropped-parcel?
          {:has-trail? true :live-mail? false :newest-trail-ms 99000}
          100000 5000))

;; BL-719 dropped-parcel-nudge-04: never dispatched at all → left to dispatch-gap.
(assert= "dropped-04: no trail at all → false regardless of anything else"
         false
         (chase-sweep-lib/decide-dropped-parcel?
          {:has-trail? false :live-mail? false :newest-trail-ms nil}
          100000 5000))

(assert= "dropped: no trail but a newest-trail-ms present is still false (has-trail? is authoritative)"
         false
         (chase-sweep-lib/decide-dropped-parcel?
          {:has-trail? false :live-mail? false :newest-trail-ms 1}
          100000 5000))

(assert= "dropped: has-trail? true but no timestamp at all (nil) → false, never a false positive on missing data"
         false
         (chase-sweep-lib/decide-dropped-parcel?
          {:has-trail? true :live-mail? false :newest-trail-ms nil}
          100000 5000))

(assert= "dropped: exactly at the threshold boundary counts as stale (>=)"
         true
         (chase-sweep-lib/decide-dropped-parcel?
          {:has-trail? true :live-mail? false :newest-trail-ms 95000}
          100000 5000))

(assert= "dropped: one ms under the threshold is not yet stale"
         false
         (chase-sweep-lib/decide-dropped-parcel?
          {:has-trail? true :live-mail? false :newest-trail-ms 95001}
          100000 5000))

;; ── within-dropped-parcel-cooldown? (pure) ────────────────────────────────
;; BL-719 dropped-parcel-nudge-05: a prior nudge inside the cooldown window
;; suppresses a repeat, even for a still-genuinely-dropped ticket.

(assert= "cooldown-01: true inside the window"
         true
         (chase-sweep-lib/within-dropped-parcel-cooldown? 1000 2000 5000))

(assert= "cooldown-02: false after the window elapses"
         false
         (chase-sweep-lib/within-dropped-parcel-cooldown? 1000 7000 5000))

(assert= "cooldown-03: false when never sent"
         false
         (chase-sweep-lib/within-dropped-parcel-cooldown? nil 7000 5000))

;; ── dropped-parcel-note-message / draft-lines (pure) ──────────────────────

(assert= "the nudge message leads with the ticket id (swarm convention)"
         "BL-719"
         (chase-sweep-lib/extract-ticket-id (chase-sweep-lib/dropped-parcel-note-message "BL-719")))

(assert= "the nudge message stays within the 80-char handoff limit"
         true
         (<= (count (chase-sweep-lib/dropped-parcel-note-message "BL-719"))
             chase-sweep-lib/dispatch-gap-note-max-length))

(assert= "dropped-parcel-draft-lines addresses the coordinator only, priority 00"
         ["type: note" "to: coordinator" "priority: 00"
          (str "message: " (chase-sweep-lib/dropped-parcel-note-message "BL-719"))]
         (chase-sweep-lib/dropped-parcel-draft-lines {:id "BL-719" :assigned-to "coder"}))

(assert= "dropped-parcel draft never targets coder/specifier/any worktree role"
         true
         (not (some #(str/includes? % "to: coder")
                    (chase-sweep-lib/dropped-parcel-draft-lines {:id "BL-1" :assigned-to "coder"}))))

;; ── conf parsing (pure, degrade-to-default posture) ───────────────────────

(assert= "parse-dropped-parcel-stall-threshold-ms: explicit minutes wins"
         (* 90 60 1000)
         (chase-sweep-lib/parse-dropped-parcel-stall-threshold-ms
          "config dropped_parcel_stall_threshold_minutes 90\n"))

(assert= "parse-dropped-parcel-stall-threshold-ms: absent config degrades to default"
         chase-sweep-lib/dropped-parcel-stall-default-threshold-ms
         (chase-sweep-lib/parse-dropped-parcel-stall-threshold-ms ""))

(assert= "parse-dropped-parcel-stall-threshold-ms: zero degrades to default"
         chase-sweep-lib/dropped-parcel-stall-default-threshold-ms
         (chase-sweep-lib/parse-dropped-parcel-stall-threshold-ms
          "config dropped_parcel_stall_threshold_minutes 0\n"))

(assert= "parse-dropped-parcel-stall-threshold-ms: negative degrades to default"
         chase-sweep-lib/dropped-parcel-stall-default-threshold-ms
         (chase-sweep-lib/parse-dropped-parcel-stall-threshold-ms
          "config dropped_parcel_stall_threshold_minutes -3\n"))

(assert= "parse-dropped-parcel-cooldown-ms: explicit minutes wins"
         (* 10 60 1000)
         (chase-sweep-lib/parse-dropped-parcel-cooldown-ms
          "config dropped_parcel_cooldown_minutes 10\n"))

(assert= "parse-dropped-parcel-cooldown-ms: absent config degrades to default"
         chase-sweep-lib/dropped-parcel-cooldown-default-ms
         (chase-sweep-lib/parse-dropped-parcel-cooldown-ms ""))

;; ── newest-trail-event-ms (fixture-based fs I/O, no live swarm) ───────────

(def created-temp-dirs (atom []))
;; BL-459 pattern: every temp dir this runner creates is tracked here and
;; removed by a JVM shutdown hook, mirrors dispatch_gap_test_runner.bb.
(.addShutdownHook (Runtime/getRuntime)
                   (Thread. (fn [] (doseq [d @created-temp-dirs] (try (fs/delete-tree d) (catch Exception _ nil))))))

(defn mk-tmp []
  (let [d (str (fs/create-temp-dir {:prefix "dropped-parcel-test-"}))]
    (swap! created-temp-dirs conj d)
    d))

(defn write-handoff! [dir filename headers]
  (fs/create-dirs dir)
  (spit (str (fs/path dir filename))
        (str (str/join "\n" (map (fn [[k v]] (str (name k) ": " v)) headers)) "\n\nbody\n")))

(defn write-active-item! [active-dir id assigned-to]
  (fs/create-dirs active-dir)
  (spit (str (fs/path active-dir (str id "-demo.yaml")))
        (str "id: " id "\ntitle: \"demo\"\nstatus: todo\nassigned_to: " assigned-to "\n")))

(let [tmp (mk-tmp)
      sent-dir (str (fs/path tmp "sent"))]
  (write-handoff! sent-dir "00_a.handoff"
                  {:from "coder" :to "cleaner" :type "git_handoff" :task "BL-217-demo"
                   :enqueued_at "2026-07-30T10:00:00.000000Z"})
  (assert= "newest-trail-event-ms reads a single trail file's enqueued_at"
           (.toEpochMilli (java.time.Instant/parse "2026-07-30T10:00:00.000000Z"))
           (chase-sweep-lib/newest-trail-event-ms "BL-217" [sent-dir])))

(let [tmp (mk-tmp)
      sent-dir (str (fs/path tmp "sent"))
      completed-dir (str (fs/path tmp "completed"))]
  (write-handoff! sent-dir "00_a.handoff"
                  {:from "coder" :to "cleaner" :type "git_handoff" :task "BL-217-demo"
                   :enqueued_at "2026-07-30T10:00:00.000000Z"})
  (write-handoff! completed-dir "00_b.handoff"
                  {:from "cleaner" :to "architect" :type "git_handoff" :task "BL-217-demo"
                   :enqueued_at "2026-08-01T10:00:00.000000Z"})
  (assert= "newest-trail-event-ms takes the MAX across multiple trail files"
           (.toEpochMilli (java.time.Instant/parse "2026-08-01T10:00:00.000000Z"))
           (chase-sweep-lib/newest-trail-event-ms "BL-217" [sent-dir completed-dir])))

(let [tmp (mk-tmp)
      sent-dir (str (fs/path tmp "sent"))]
  (write-handoff! sent-dir "00_a.handoff"
                  {:from "coder" :to "cleaner" :type "git_handoff" :task "BL-217-demo"
                   :created_at "2026-07-30T10:00:00.000000Z"})
  (assert= "newest-trail-event-ms falls back to created_at when enqueued_at is absent"
           (.toEpochMilli (java.time.Instant/parse "2026-07-30T10:00:00.000000Z"))
           (chase-sweep-lib/newest-trail-event-ms "BL-217" [sent-dir])))

;; BL-719 invariant 3: the sweep's own prior nudge must never count as a
;; fresh trail event for the SAME item - only real dispatch trail does.
(let [tmp (mk-tmp)
      sent-dir (str (fs/path tmp "sent"))
      coord-outbox (str (fs/path tmp "coord-outbox"))]
  (write-handoff! sent-dir "00_a.handoff"
                  {:from "coder" :to "cleaner" :type "git_handoff" :task "BL-217-demo"
                   :enqueued_at "2026-07-30T10:00:00.000000Z"})
  (write-handoff! coord-outbox "00_nudge.handoff"
                  {:from "coordinator" :to "coordinator" :type "note"
                   :message (chase-sweep-lib/dropped-parcel-note-message "BL-217")
                   :enqueued_at "2026-08-13T10:00:00.000000Z"})
  (assert= "newest-trail-event-ms excludes the sweep's own nudge, even though it is far newer"
           (.toEpochMilli (java.time.Instant/parse "2026-07-30T10:00:00.000000Z"))
           (chase-sweep-lib/newest-trail-event-ms "BL-217" [sent-dir coord-outbox])))

(assert= "newest-trail-event-ms returns nil when nothing references the item"
         nil
         (chase-sweep-lib/newest-trail-event-ms "BL-999" [(str (fs/path (mk-tmp) "empty"))]))

(let [tmp (mk-tmp)
      sent-dir (str (fs/path tmp "sent"))]
  (write-handoff! sent-dir "00_a.handoff"
                  {:from "coder" :to "cleaner" :type "note" :message "unrelated"})
  (assert= "newest-trail-event-ms ignores files that don't reference the item"
           nil
           (chase-sweep-lib/newest-trail-event-ms "BL-217" [sent-dir])))

(let [tmp (mk-tmp)
      sent-dir (str (fs/path tmp "sent"))]
  (write-handoff! sent-dir "00_a.handoff"
                  {:from "coder" :to "cleaner" :type "git_handoff" :task "BL-217-demo"})
  (assert= "newest-trail-event-ms skips a trail file with no parseable timestamp header at all"
           nil
           (chase-sweep-lib/newest-trail-event-ms "BL-217" [sent-dir])))

;; ── dropped-parcel-items (full pipeline, fixture-based) ───────────────────

(def far-future-now-ms (.toEpochMilli (java.time.Instant/parse "2026-08-14T00:00:00.000000Z")))

(let [tmp (mk-tmp)
      active-dir (str (fs/path tmp "active"))
      sent-dir (str (fs/path tmp "sent"))
      coder-new (str (fs/path tmp "coder-new"))]
  (write-active-item! active-dir "BL-719" "coder")
  (write-handoff! sent-dir "00_a.handoff"
                  {:from "documenter" :to "QA" :type "git_handoff" :task "BL-719-demo"
                   :enqueued_at "2020-01-01T00:00:00.000000Z"})
  (assert= "dropped-parcel-items-01: dispatched + no live mail + stale trail → nudge candidate"
           [{:id "BL-719" :assigned-to "coder"}]
           (chase-sweep-lib/dropped-parcel-items
            active-dir [sent-dir] [coder-new] far-future-now-ms 5000)))

(let [tmp (mk-tmp)
      active-dir (str (fs/path tmp "active"))
      sent-dir (str (fs/path tmp "sent"))
      coder-new (str (fs/path tmp "coder-new"))]
  (write-active-item! active-dir "BL-719" "coder")
  (write-handoff! sent-dir "00_a.handoff"
                  {:from "documenter" :to "QA" :type "git_handoff" :task "BL-719-demo"
                   :enqueued_at "2020-01-01T00:00:00.000000Z"})
  (write-handoff! coder-new "00_live.handoff"
                  {:from "documenter" :to "coder" :type "git_handoff" :task "BL-719-demo"})
  (assert= "dropped-parcel-items-02: live mail in new/ excludes the item, however stale its trail"
           []
           (chase-sweep-lib/dropped-parcel-items
            active-dir [sent-dir coder-new] [coder-new] far-future-now-ms 5000)))

(let [tmp (mk-tmp)
      active-dir (str (fs/path tmp "active"))
      sent-dir (str (fs/path tmp "sent"))
      coder-new (str (fs/path tmp "coder-new"))]
  (write-active-item! active-dir "BL-719" "coder")
  (write-handoff! sent-dir "00_a.handoff"
                  {:from "documenter" :to "QA" :type "git_handoff" :task "BL-719-demo"
                   :enqueued_at "2026-08-14T00:00:00.000000Z"})
  (assert= "dropped-parcel-items-03: trail newer than the threshold → not a candidate (ordinary gap)"
           []
           (chase-sweep-lib/dropped-parcel-items
            active-dir [sent-dir]
            [coder-new]
            (.toEpochMilli (java.time.Instant/parse "2026-08-14T00:00:10.000000Z"))
            60000)))

(let [tmp (mk-tmp)
      active-dir (str (fs/path tmp "active"))
      coder-new (str (fs/path tmp "coder-new"))]
  (write-active-item! active-dir "BL-719" "coder")
  (assert= "dropped-parcel-items-04: never dispatched at all (no trail anywhere) → not a candidate here"
           []
           (chase-sweep-lib/dropped-parcel-items
            active-dir [(str (fs/path tmp "empty"))] [coder-new] far-future-now-ms 5000)))

(assert= "dropped-parcel-items returns an empty vector when backlog/active/ does not exist"
         []
         (chase-sweep-lib/dropped-parcel-items
          (str (fs/path (mk-tmp) "nonexistent-active")) [] [] far-future-now-ms 5000))

;; ── report ────────────────────────────────────────────────────────────────
(if (seq @failures)
  (do
    (doseq [f @failures] (binding [*out* *err*] (println f)))
    (println (str "\n" (count @failures) " failure(s)"))
    (System/exit 1))
  (println "ALL PASS: chase_sweep_lib.bb dropped-parcel functions"))
