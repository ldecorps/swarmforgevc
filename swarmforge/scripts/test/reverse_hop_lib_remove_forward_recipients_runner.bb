#!/usr/bin/env bb
;; BL-1605: unit assertions for reverse_hop_lib.bb's remove-forward-
;; recipients - the forward's own recipients must never also receive a
;; non-forwarding reverse copy of the same send.
(ns reverse-hop-lib-remove-forward-recipients-runner
  (:require [babashka.fs :as fs]))

(def script-dir (str (fs/parent (fs/canonicalize *file*))))
(load-file (str (fs/path script-dir ".." "reverse_hop_lib.bb")))

(def failures (atom []))

(defn assert= [msg expected actual]
  (when (not= expected actual)
    (swap! failures conj (str "FAIL: " msg "\n  expected: " (pr-str expected) "\n  actual:   " (pr-str actual)))))

;; A bounce to the role the forward already names (architect bouncing to
;; cleaner under back-one, cleaner immediately precedes architect) must
;; drop that role from the reverse set entirely - one file, not two.
(assert= "back-one: the sole reverse candidate IS the forward's own recipient - reverse set empties"
         []
         (reverse-hop-lib/remove-forward-recipients ["cleaner"] ["cleaner"]))

;; A forward hop whose recipients are LATER roles (never in the reverse
;; candidate set to begin with) leaves the reverse set byte-identical to
;; today - the subtraction is a no-op when nothing overlaps.
(assert= "forward hop to a later role: the earlier roles' reverse set is unchanged"
         ["coder" "cleaner"]
         (reverse-hop-lib/remove-forward-recipients ["coder" "cleaner"] ["hardender"]))

;; back-all bounce to a MIDDLE earlier role: only that one role drops out
;; of the reverse set, every other earlier role still gets its copy.
(assert= "back-all: only the bounced-to role drops out, other earlier roles unchanged"
         ["coder" "architect"]
         (reverse-hop-lib/remove-forward-recipients ["coder" "cleaner" "architect"] ["cleaner"]))

;; A multi-recipient forward removes every one of its own recipients from
;; the reverse set, not just the first.
(assert= "multiple forward recipients are all subtracted"
         []
         (reverse-hop-lib/remove-forward-recipients ["coder" "cleaner"] ["coder" "cleaner"]))

;; No forward recipients overlap at all: candidates pass through unchanged.
(assert= "no overlap: candidates pass through unchanged"
         ["coder" "cleaner" "architect"]
         (reverse-hop-lib/remove-forward-recipients ["coder" "cleaner" "architect"] []))

(if (seq @failures)
  (do (doseq [f @failures] (println f))
      (println (str "\n" (count @failures) " failure(s)"))
      (System/exit 1))
  (println "reverse_hop_lib_remove_forward_recipients_runner: all assertions passed"))
