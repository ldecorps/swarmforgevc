#!/usr/bin/env bb
;; TDD runner for forward_evidence_lib.bb (BL-1609) - pure assertions, no
;; filesystem (sent-handoff-names-ticket-since? is IO and is covered by the
;; feature's real-fixture acceptance scenarios instead, the same split
;; qa_hold_lib_test_runner.bb draws for qa_hold_lib.bb's own reading layer).
;; BL-1645's inbound-window-start is a small, deliberate exception - see
;; below.
(ns forward-evidence-lib-test-runner
  (:require [babashka.fs :as fs]
            [babashka.process :as process]
            [clojure.string :as str]))

(def lib-path (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "forward_evidence_lib.bb")))
(load-file lib-path)

(def failures (atom []))

(defn assert= [msg expected actual]
  (when (not= expected actual)
    (swap! failures conj (str "FAIL: " msg "\n  expected: " (pr-str expected) "\n  actual:   " (pr-str actual)))))

;; ── forward-completion-decision ──────────────────────────────────────────

(assert= "01: forwarding, no evidence, no reason -> refuse"
         :refuse
         (forward-evidence-lib/forward-completion-decision
          {:forwarding? true :master-resident? false :evidenced? false :reason nil}))

(assert= "02a: forwarding, evidenced, no reason -> complete-plain"
         :complete-plain
         (forward-evidence-lib/forward-completion-decision
          {:forwarding? true :master-resident? false :evidenced? true :reason nil}))

(assert= "02b: forwarding, not evidenced, a stated reason -> complete-with-reason"
         :complete-with-reason
         (forward-evidence-lib/forward-completion-decision
          {:forwarding? true :master-resident? false :evidenced? false :reason "waiting on BL-9000"}))

(assert= "a stated reason wins even when also evidenced (recorded, never silently dropped)"
         :complete-with-reason
         (forward-evidence-lib/forward-completion-decision
          {:forwarding? true :master-resident? false :evidenced? true :reason "already superseded"}))

(assert= "03: a non-forwarding inbound completes plain regardless of evidence/reason"
         :complete-plain
         (forward-evidence-lib/forward-completion-decision
          {:forwarding? false :master-resident? false :evidenced? false :reason nil}))

(assert= "a non-forwarding inbound completes plain even with a reason supplied"
         :complete-plain
         (forward-evidence-lib/forward-completion-decision
          {:forwarding? false :master-resident? false :evidenced? false :reason "irrelevant"}))

(assert= "06: a master-resident role's forwarding git_handoff completes plain with no evidence"
         :complete-plain
         (forward-evidence-lib/forward-completion-decision
          {:forwarding? true :master-resident? true :evidenced? false :reason nil}))

(assert= "a master-resident role is never gated even with a reason supplied"
         :complete-plain
         (forward-evidence-lib/forward-completion-decision
          {:forwarding? true :master-resident? true :evidenced? false :reason "irrelevant"}))

;; ── BL-1642: qa-note-evidenced? ──────────────────────────────────────────

(assert= "07: forwarding, no git_handoff evidence, but QA note evidence, no reason -> complete-plain"
         :complete-plain
         (forward-evidence-lib/forward-completion-decision
          {:forwarding? true :master-resident? false :evidenced? false
           :qa-note-evidenced? true :reason nil}))

(assert= "08: forwarding, no evidence of either kind, no reason -> refuse"
         :refuse
         (forward-evidence-lib/forward-completion-decision
          {:forwarding? true :master-resident? false :evidenced? false
           :qa-note-evidenced? false :reason nil}))

(assert= "a stated reason wins over QA note evidence too (recorded, never silently dropped)"
         :complete-with-reason
         (forward-evidence-lib/forward-completion-decision
          {:forwarding? true :master-resident? false :evidenced? false
           :qa-note-evidenced? true :reason "already superseded"}))

(assert= "git_handoff evidence still completes plainly when qa-note-evidenced? is false (BL-1609 unchanged)"
         :complete-plain
         (forward-evidence-lib/forward-completion-decision
          {:forwarding? true :master-resident? false :evidenced? true
           :qa-note-evidenced? false :reason nil}))

;; ── qa-stage? (BL-1642 invariant 3, real behavior) ────────────────────────
;; The tests above give forward-completion-decision a hand-supplied
;; qa-note-evidenced? boolean - they prove the DECISION TABLE, never that
;; qa-stage? itself computes the right answer for a seat. Scenario 02 of
;; the acceptance feature only checks, STATICALLY (source text), that
;; forward-gate! and qa-hold-gate! call the SAME function name - it never
;; runs qa-stage? against a real "QA@2"-shaped SWARMFORGE_ROLE, so the
;; ticket's own invariant 3 ("a QA@2 seat is the QA stage to both") had no
;; behavioral coverage anywhere in the parcel. Confirmed by hand-mutation
;; before writing these: reverting qa-stage? to the pre-fix bare
;; (= "QA" (handoff-lib/current-role)) comparison left BOTH this runner's
;; other 9 cases AND all 9 of the BL-1642 acceptance scenarios green.
;; qa-stage? reads current-role via System/getenv, which cannot be
;; overridden in-process (the same reason BL-1637's sent-dirs-for-seat
;; tests use a real bb subprocess) - drive it the identical way.
(defn qa-stage-subprocess [role]
  (let [program (str "(load-file \"" lib-path "\")"
                     "(println (boolean (forward-evidence-lib/qa-stage?)))")
        result (process/sh {:extra-env {"SWARMFORGE_ROLE" role}} "bb" "-e" program)]
    (= "true" (str/trim (:out result)))))

(assert= "qa-stage? is true for the bare QA role"
         true
         (qa-stage-subprocess "QA"))

(assert= "qa-stage? is true for a QA@2 seat (BL-1642's own invariant 3)"
         true
         (qa-stage-subprocess "QA@2"))

(assert= "qa-stage? is false for a non-QA role"
         false
         (qa-stage-subprocess "architect"))

;; ── inbound-window-start (BL-1645) ───────────────────────────────────────
;; IO (header-field slurps a real file), unlike the pure decision tests
;; above - the same exception this file's own header notes for
;; sent-handoff-names-ticket-since?, small enough here to cover directly
;; with real temp files rather than pushing every case out to the feature.

;; BL-1636/BL-459 sibling: a bb harness creating fs/create-temp-dir roots
;; needs a cleanup mechanism the standing tempDirTrapGuard recognises - an
;; addShutdownHook or a try/finally + delete-tree. This runner has no
;; early-exit path (assert= records failures rather than throwing, so the
;; script always reaches its own end), but the shutdown hook is the
;; established shape for this exact "small, deliberate IO exception"
;; pattern (aps_equivalence_lib_test_runner.bb, ambulance_lib_property_runner.bb).
(def bl1645-created-temp-dirs (atom []))
(.addShutdownHook (Runtime/getRuntime)
                   (Thread. (fn [] (doseq [d @bl1645-created-temp-dirs] (try (fs/delete-tree d) (catch Exception _ nil))))))

(defn write-headers [m]
  (let [dir (fs/create-temp-dir {:prefix "bl1645-window-"})
        f (str (fs/path dir "fixture.handoff"))]
    (swap! bl1645-created-temp-dirs conj dir)
    (spit f (str (str/join "\n" (map (fn [[k v]] (str (name k) ": " v)) m)) "\n\nbody\n"))
    f))

(assert= "10: created_at wins over enqueued_at and dequeued_at"
         "2026-09-18T15:01:12Z"
         (forward-evidence-lib/inbound-window-start
          (write-headers {:created_at "2026-09-18T15:01:12Z"
                           :enqueued_at "2026-09-18T15:01:13Z"
                           :dequeued_at "2026-09-19T02:05:03Z"})))

(assert= "11: no created_at - enqueued_at wins over dequeued_at"
         "2026-09-18T15:01:13Z"
         (forward-evidence-lib/inbound-window-start
          (write-headers {:enqueued_at "2026-09-18T15:01:13Z"
                           :dequeued_at "2026-09-19T02:05:03Z"})))

(assert= "12: neither created_at nor enqueued_at - falls back to dequeued_at"
         "2026-09-19T02:05:03Z"
         (forward-evidence-lib/inbound-window-start
          (write-headers {:dequeued_at "2026-09-19T02:05:03Z"})))

(assert= "13: none of the three - falls back to the epoch"
         "1970-01-01T00:00:00Z"
         (forward-evidence-lib/inbound-window-start (write-headers {:type "note"})))

;; ── report ────────────────────────────────────────────────────────────────
(if (seq @failures)
  (do
    (doseq [f @failures] (binding [*out* *err*] (println f)))
    (println (str "\n" (count @failures) " failure(s)"))
    (System/exit 1))
  (println "ALL PASS: forward_evidence_lib.bb"))
