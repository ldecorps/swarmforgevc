#!/usr/bin/env bb
;; BL-372: TDD runner for swarm_detach_lib.bb's pure sighup-ignored?/
;; decide-launch-outcome decisions. No real processes, no real tmux - just
;; data, so every case (including the "still owned by the caller" failure
;; path) is deterministic and instant.

(ns swarm-detach-lib-test-runner
  (:require [babashka.fs :as fs]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "swarm_detach_lib.bb")))

(def failures (atom []))

(defn assert= [msg expected actual]
  (when (not= expected actual)
    (swap! failures conj (str "FAIL: " msg "\n  expected: " (pr-str expected) "\n  actual:   " (pr-str actual)))))

;; ── parse-hex ─────────────────────────────────────────────────────────────
;; check_swarm_detached.bb feeds this both /proc/<pid>/status's SigIgn field
;; (no 0x prefix) and macOS/BSD's `ps -o sigignore=` output (format
;; unverified on a real macOS host in this environment - see
;; swarm_detach_lib.bb's header) - cover both shapes plus the "process
;; already gone" blank/nil case so this pure parsing step is unit-test-blind
;; no longer, even though the shell-outs around it still aren't.

(assert= "a bare hex string with no 0x prefix (the /proc/<pid>/status SigIgn shape)"
         0x7
         (swarm-detach-lib/parse-hex "7"))

(assert= "a 0x-prefixed hex string (a plausible ps -o sigignore= shape)"
         0x7
         (swarm-detach-lib/parse-hex "0x7"))

(assert= "an uppercase 0X prefix is accepted the same way"
         0x7
         (swarm-detach-lib/parse-hex "0X7"))

(assert= "surrounding whitespace (a raw ps/cat field) is trimmed before parsing"
         0x6
         (swarm-detach-lib/parse-hex "  6\n"))

(assert= "a blank string (the field was empty) parses to nil, never raises"
         nil
         (swarm-detach-lib/parse-hex ""))

(assert= "nil input (the process vanished before it could be read) parses to nil, never raises"
         nil
         (swarm-detach-lib/parse-hex nil))

;; ── sighup-ignored? ───────────────────────────────────────────────────────
;; Real observed masks from this session: `sleep 30 &` (no nohup) shows
;; SigIgn=0x6 (bit 0 clear); `nohup sleep 30 >/dev/null 2>&1 &` shows
;; SigIgn=0x7 (bit 0 set) - these two literal values are the actual
;; mechanical proof, not synthetic round numbers.

(assert= "a mask with SIGHUP's bit set is ignored (the real nohup'd value observed this session)"
         true
         (swarm-detach-lib/sighup-ignored? 0x7))

(assert= "a mask with SIGHUP's bit clear is not ignored (the real non-nohup'd value observed this session)"
         false
         (swarm-detach-lib/sighup-ignored? 0x6))

(assert= "a mask of exactly SIGHUP's bit alone is ignored"
         true
         (swarm-detach-lib/sighup-ignored? 0x1))

(assert= "a mask of zero (nothing ignored) is not ignored"
         false
         (swarm-detach-lib/sighup-ignored? 0x0))

(assert= "a large mask with other signals ignored but NOT SIGHUP's bit is not ignored"
         false
         (swarm-detach-lib/sighup-ignored? 0xFFFFFFFE))

(assert= "a missing mask (process vanished before it could be read) can never be judged ignored"
         false
         (swarm-detach-lib/sighup-ignored? nil))

;; ── decide-launch-outcome: BL-372 scenario 01/02 (ready + detached) ────────

(assert= "ready and detached is a clean pass"
         {:ok? true :message "swarm is up and its launch is detached from the caller"}
         (swarm-detach-lib/decide-launch-outcome {:ready? true :detached? true}))

;; ── decide-launch-outcome: BL-372 scenario 02 (still owned by caller) ─────

(assert= "ready but never detached fails loudly, naming the cause"
         {:ok? false
          :message "swarm launch is still owned by the caller - it will die when the caller exits"}
         (swarm-detach-lib/decide-launch-outcome {:ready? true :detached? false}))

;; ── decide-launch-outcome: BL-372 scenario 03 (readiness gate survives) ───

(assert= "never-ready fails on readiness alone, even if detachment somehow looked fine"
         {:ok? false :message "swarm did not become ready"}
         (swarm-detach-lib/decide-launch-outcome {:ready? false :detached? true}))

(assert= "never-ready AND not detached still reports the readiness failure first"
         {:ok? false :message "swarm did not become ready"}
         (swarm-detach-lib/decide-launch-outcome {:ready? false :detached? false}))

;; ── report ────────────────────────────────────────────────────────────────
(if (empty? @failures)
  (println "swarm_detach_lib (BL-372): ALL TESTS PASSED")
  (do (println (str "swarm_detach_lib (BL-372): " (count @failures) " FAILURE(S):"))
      (doseq [f @failures] (println f))
      (System/exit 1)))
