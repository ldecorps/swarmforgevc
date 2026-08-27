#!/usr/bin/env bb
;; BL-780: property encoding of rotation-actionability vs flow_watchdog_warn
;; ordering (architect bounce D1). Seeded RNG — never wall-clock.

(ns bl780-rotation-actionability-ordering-property-runner
  (:require [babashka.fs :as fs]
            [clojure.string :as str]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "mono_router_lib.bb")))

(def failures (atom []))
(defn assert-true [msg expr]
  (when-not expr (swap! failures conj (str "FAIL: " msg))))

(def ^:private rng (java.util.Random. 780))
(defn- rint [lo hi] (+ lo (.nextInt rng (int (inc (- hi lo))))))

(def hit-sound (atom 0))
(def hit-inverted (atom 0))

(dotimes [_ 200]
  (let [warn (rint 60000 3600000)
        note (rint 1 (max 1 (dec warn)))
        starve (if (.nextBoolean rng) :off (rint 1 (max 1 (dec warn))))
        t {:note-actionable-after-ms note
           :rotation-starve-after-ms starve
           :flow-watchdog-warn-ms warn}
        ws (mono-router-lib/rotation-actionability-ordering-warnings t)]
    (swap! hit-sound inc)
    (assert-true (str "sound triple must warn empty: " (pr-str t) " got " (pr-str ws))
                 (empty? ws))))

(dotimes [_ 200]
  (let [warn (rint 60000 1800000)
        note (rint warn (+ warn 900000))
        t {:note-actionable-after-ms note
           :rotation-starve-after-ms :off
           :flow-watchdog-warn-ms warn}
        ws (mono-router-lib/rotation-actionability-ordering-warnings t)]
    (swap! hit-inverted inc)
    (assert-true (str "inverted note must warn: " (pr-str t))
                 (seq ws))
    (assert-true (str "warning names note_actionable_after_ms: " (pr-str ws))
                 (some #(str/includes? % "note_actionable_after_ms=") ws))))

;; Non-vacuous: a silenced implementation would pass inverted cases.
(let [broken (fn [_] [])
      inverted {:note-actionable-after-ms 1200000
                :rotation-starve-after-ms :off
                :flow-watchdog-warn-ms 900000}]
  (assert-true "non-vacuous: broken silent path accepts inverted pair"
               (empty? (broken inverted)))
  (assert-true "live path rejects inverted pair"
               (seq (mono-router-lib/rotation-actionability-ordering-warnings inverted))))

(assert-true "generator reached sound cases" (pos? @hit-sound))
(assert-true "generator reached inverted cases" (pos? @hit-inverted))

(when (seq @failures)
  (doseq [f @failures] (println f))
  (System/exit 1))
(println "BL-780 rotation-actionability ordering property: ALL PASS")
