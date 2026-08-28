#!/usr/bin/env bb
;; TDD runner for idle_clear_fullness_lib.bb (BL-1238).

(ns idle-clear-fullness-lib-test-runner
  (:require [babashka.fs :as fs]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "idle_clear_fullness_lib.bb")))

(def failures (atom []))
(defn assert= [msg expected actual]
  (when (not= expected actual)
    (swap! failures conj (str "FAIL: " msg "\n  expected: " (pr-str expected) "\n  actual:   " (pr-str actual)))))
(defn assert-true [msg actual] (assert= msg true actual))
(defn assert-false [msg actual] (assert= msg false actual))

;; ── resolve-fullness ──────────────────────────────────────────────────────

(assert= "telemetry wins when present"
         {:percent 90 :source :telemetry}
         (idle-clear-fullness-lib/resolve-fullness {:telemetry-percent 90 :proxy-percent 10}))
(assert= "proxy used when telemetry absent"
         {:percent 60 :source :proxy}
         (idle-clear-fullness-lib/resolve-fullness {:telemetry-percent nil :proxy-percent 60}))
(assert= "unavailable when neither present"
         {:percent nil :source :unavailable}
         (idle-clear-fullness-lib/resolve-fullness {:telemetry-percent nil :proxy-percent nil}))
(assert= "telemetry clamped to [0,100]"
         {:percent 100 :source :telemetry}
         (idle-clear-fullness-lib/resolve-fullness {:telemetry-percent 150 :proxy-percent nil}))
(assert= "proxy clamped to [0,100]"
         {:percent 0 :source :proxy}
         (idle-clear-fullness-lib/resolve-fullness {:telemetry-percent nil :proxy-percent -5}))
(assert= "telemetry of exactly 0 still wins over a present proxy (0 is not nil)"
         {:percent 0 :source :telemetry}
         (idle-clear-fullness-lib/resolve-fullness {:telemetry-percent 0 :proxy-percent 90}))

;; ── should-idle-clear? / decide — the acceptance matrix, scenario 01 ──────

(defn- input [opt-in? percent source threshold]
  {:opt-in? opt-in? :fullness {:percent percent :source source} :threshold-percent threshold})

(assert-true "enabled + 90% (threshold 75) -> respawns"
             (idle-clear-fullness-lib/should-idle-clear? (input true 90 :proxy 75)))
(assert-true "enabled + exactly at threshold (75%) -> respawns"
             (idle-clear-fullness-lib/should-idle-clear? (input true 75 :proxy 75)))
(assert-false "enabled + just under threshold (74%) -> stays"
              (idle-clear-fullness-lib/should-idle-clear? (input true 74 :proxy 75)))
(assert-false "enabled + far under threshold (10%) -> stays"
              (idle-clear-fullness-lib/should-idle-clear? (input true 10 :proxy 75)))
(assert-false "disabled opt-in, even at 90% -> stays (opt-in is authoritative)"
              (idle-clear-fullness-lib/should-idle-clear? (input false 90 :proxy 75)))

;; ── scenario 02: threshold is a parameter, not a literal ──────────────────

(assert-true "configured threshold 50%, fullness 60% -> respawns"
             (idle-clear-fullness-lib/should-idle-clear? (input true 60 :proxy 50)))
(assert-false "configured threshold 50%, fullness 40% -> stays"
              (idle-clear-fullness-lib/should-idle-clear? (input true 40 :proxy 50)))

;; ── scenario 03: proxy honoured identically to telemetry ──────────────────

(assert-true "telemetry 80% (threshold 75) -> respawns"
             (idle-clear-fullness-lib/should-idle-clear? (input true 80 :telemetry 75)))
(assert-true "proxy 80% (threshold 75) -> respawns, same as telemetry"
             (idle-clear-fullness-lib/should-idle-clear? (input true 80 :proxy 75)))
(assert= "decide records :telemetry as the source"
         :telemetry (:source (idle-clear-fullness-lib/decide (input true 80 :telemetry 75))))
(assert= "decide records :proxy as the source"
         :proxy (:source (idle-clear-fullness-lib/decide (input true 80 :proxy 75))))

;; ── scenario 04: unavailable reading never clears, locked human decision ─

(assert-false "unavailable reading (nil percent) never clears, even opted in"
              (idle-clear-fullness-lib/should-idle-clear?
                {:opt-in? true :fullness {:percent nil :source :unavailable} :threshold-percent 0}))
(assert= "decide records :unavailable and respawn? false"
         {:respawn? false :source :unavailable :percent nil}
         (idle-clear-fullness-lib/decide
           {:opt-in? true :fullness {:percent nil :source :unavailable} :threshold-percent 0}))

;; Non-vacuity sanity: threshold-percent 0 with a real reading DOES clear -
;; confirms the unavailable case above is refused by the nil-percent guard
;; specifically, not merely because threshold 0 always refuses everything.
(assert-true "threshold 0 with a real 0% reading still clears (opt-in true)"
             (idle-clear-fullness-lib/should-idle-clear? (input true 0 :proxy 0)))

(if (seq @failures)
  (do (doseq [f @failures] (binding [*out* *err*] (println f)))
      (println (str "\n" (count @failures) " failure(s)"))
      (System/exit 1))
  (println "ALL PASS: idle_clear_fullness_lib.bb"))
