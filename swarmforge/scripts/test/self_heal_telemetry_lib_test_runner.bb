#!/usr/bin/env bb
;; Unit tests for self_heal_telemetry_lib.bb (BL-597).

(require '[babashka.fs :as fs]
         '[cheshire.core :as json]
         '[clojure.string :as str])

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "self_heal_telemetry_lib.bb")))

(def failures (atom []))

(defn assert= [label expected actual]
  (when (not= expected actual)
    (swap! failures conj (str "FAIL: " label "\n  expected: " (pr-str expected) "\n  actual:   " (pr-str actual)))))

(defn assert-true [label expr]
  (when-not expr
    (swap! failures conj (str "FAIL: " label))))

(let [root (fs/create-temp-dir)
      at-ms (.toEpochMilli (java.time.Instant/parse "2026-08-27T10:00:00Z"))]
  (self-heal-telemetry-lib/append-self-heal-event!
   (str root)
   {:type "stale-build-recompile"
    :subject "front-desk-supervisor"
    :reason "recompiling before respawn"
    :at-ms at-ms})
  (let [file (self-heal-telemetry-lib/self-heal-telemetry-file (str root) at-ms)
        lines (str/split-lines (slurp (str file)))]
    (assert= "one line appended" 1 (count lines))
    (let [parsed (json/parse-string (first lines) true)]
      (assert= "type" "stale-build-recompile" (:type parsed))
      (assert= "subject" "front-desk-supervisor" (:subject parsed))
      (assert= "reason" "recompiling before respawn" (:reason parsed))
      (assert-true "at present" (seq (:at parsed))))))

(let [root (fs/create-temp-dir)]
  (self-heal-telemetry-lib/append-self-heal-event!
   (str (fs/path root "readonly"))
   {:type "claim-heal" :subject "handoffd" :reason "resume orphaned in_process"})
  (assert-true "swallowed write to bad path without throwing" true))

(when (seq @failures)
  (doseq [f @failures] (println f))
  (System/exit 1))

(println "ALL PASS: self_heal_telemetry_lib.bb")
