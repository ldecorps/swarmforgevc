#!/usr/bin/env bb
;; TDD runner for handoff_lib.bb's BL-218 dedup functions - pure assertions,
;; no real mailbox I/O (per the ticket's own non-behavioral gate).
(ns mailbox-intake-dedup-test-runner
  (:require [babashka.fs :as fs]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "handoff_lib.bb")))

(def failures (atom []))

(defn assert= [msg expected actual]
  (when (not= expected actual)
    (swap! failures conj (str "FAIL: " msg "\n  expected: " (pr-str expected) "\n  actual:   " (pr-str actual)))))

;; ── already-terminal? ─────────────────────────────────────────────────────

(assert= "intake-01a: a basename already in completed/ is terminal"
         true
         (handoff-lib/already-terminal? "00_x.handoff" ["00_x.handoff"] []))

(assert= "intake-01b: a basename already in abandoned/ is terminal"
         true
         (handoff-lib/already-terminal? "00_x.handoff" [] ["00_x.handoff"]))

(assert= "intake-02: a basename in neither set is not terminal"
         false
         (handoff-lib/already-terminal? "00_x.handoff" ["00_y.handoff"] ["00_z.handoff"]))

;; ── dedup-new-candidates ──────────────────────────────────────────────────

(assert= "intake-01: a stale new/ copy of an already-completed handoff is skipped, not dequeued"
         {:skipped ["00_x.handoff"] :dequeueable []}
         (handoff-lib/dedup-new-candidates ["00_x.handoff"] ["00_x.handoff"] []))

(assert= "intake-01 (abandoned variant): a stale new/ copy of an already-abandoned handoff is skipped"
         {:skipped ["00_x.handoff"] :dequeueable []}
         (handoff-lib/dedup-new-candidates ["00_x.handoff"] [] ["00_x.handoff"]))

(assert= "intake-02: a genuinely new handoff still dequeues"
         {:skipped [] :dequeueable ["00_new.handoff"]}
         (handoff-lib/dedup-new-candidates ["00_new.handoff"] ["00_old.handoff"] []))

(assert= "a mix of stale and genuinely-new candidates partitions correctly, preserving order"
         {:skipped ["00_a.handoff" "00_c.handoff"] :dequeueable ["00_b.handoff"]}
         (handoff-lib/dedup-new-candidates ["00_a.handoff" "00_b.handoff" "00_c.handoff"]
                                            ["00_a.handoff"]
                                            ["00_c.handoff"]))

(assert= "an empty new/ listing dedups to nothing skipped, nothing dequeueable"
         {:skipped [] :dequeueable []}
         (handoff-lib/dedup-new-candidates [] ["00_old.handoff"] []))

;; ── report ────────────────────────────────────────────────────────────────
(if (seq @failures)
  (do
    (doseq [f @failures] (binding [*out* *err*] (println f)))
    (println (str "\n" (count @failures) " failure(s)"))
    (System/exit 1))
  (println "ALL PASS: handoff_lib.bb dedup-new-candidates"))
