#!/usr/bin/env bb
;; BL-1846 scenario 03 driver: runs handoffd.bb's REAL open-slot-nudge-sweep!
;; N times WITHIN ONE process, so its in-memory escalation state
;; (open-slot-escalation-state) accumulates exactly as it does across ticks
;; of the real daemon's main loop. N separate `bb handoffd.bb --sweep-once`
;; process invocations (the mechanism the other scenarios in this feature
;; use) would each start that atom over at nil - fine for a single tick, but
;; it can never reach a >1 escalation threshold, since every tick would
;; report count 1 and decide :nudge again.
;;
;; handoffd.bb's own (-main) call is BL-1395-guarded ((when (= *file*
;; (System/getProperty "babashka.file")) (-main))), so load-file here
;; analyses it silently and never starts the daemon loop or its main
;; command-line-arg-dependent one-shot flags (bl1494's own field runner
;; establishes this exact technique: `binding [*command-line-args*
;; [<root>]]` around the load-file).
;;
;; Usage: bb bl1846MultiTickSweepCli.bb <root> <ticks>

(require '[babashka.fs :as fs])

(def root (first *command-line-args*))
(def ticks (Long/parseLong (or (second *command-line-args*) "3")))

(def repo-root (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." ".." ".." "..")))
(def handoffd-path (str (fs/path repo-root "swarmforge" "scripts" "handoffd.bb")))

(binding [*command-line-args* [root]]
  (load-file handoffd-path))

(def cooldown-file (fs/path root ".swarmforge" "daemon" "open-slot-nudge-cooldown.json"))

;; The cooldown file records a real wall-clock timestamp; a fast test never
;; waits out the real cooldown window between ticks, so it is cleared
;; between ticks instead - the escalation STATE this driver exists to
;; accumulate is a separate, in-memory concern from the cooldown gate.
(dotimes [_ ticks]
  (handoffd/open-slot-nudge-sweep! (handoffd/load-roles))
  (fs/delete-if-exists cooldown-file))

(println "MULTI_TICK_SWEEP_DONE")
