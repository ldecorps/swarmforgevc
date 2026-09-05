#!/usr/bin/env bb
;; Unit tests for rotation_telemetry_lib.bb (BL-596).

(require '[babashka.fs :as fs]
         '[cheshire.core :as json]
         '[clojure.string :as str])

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "rotation_telemetry_lib.bb")))

(def failures (atom []))

(def created-temp-dirs (atom []))
(.addShutdownHook (Runtime/getRuntime)
                   (Thread. (fn [] (doseq [d @created-temp-dirs] (try (fs/delete-tree d) (catch Exception _ nil))))))

(defn assert= [label expected actual]
  (when (not= expected actual)
    (swap! failures conj (str "FAIL: " label "\n  expected: " (pr-str expected) "\n  actual:   " (pr-str actual)))))

(defn assert-true [label expr]
  (when-not expr
    (swap! failures conj (str "FAIL: " label))))

(let [root (fs/create-temp-dir)
      _ (swap! created-temp-dirs conj root)
      at-ms (.toEpochMilli (java.time.Instant/parse "2026-08-27T10:00:00Z"))]
  (rotation-telemetry-lib/append-rotation-event!
   (str root)
   {:from "coder" :to "cleaner" :reason "handoff-forward" :at-ms at-ms})
  (let [file (rotation-telemetry-lib/rotation-telemetry-file (str root) at-ms)
        lines (str/split-lines (slurp (str file)))]
    (assert= "one line appended" 1 (count lines))
    (let [parsed (json/parse-string (first lines) true)]
      (assert= "from role" "coder" (:from parsed))
      (assert= "to role" "cleaner" (:to parsed))
      (assert= "reason" "handoff-forward" (:reason parsed))
      (assert-true "timestamp present" (seq (:at parsed))))))

(assert= "normalize-event requires from/to/at"
         {:from "a" :to "b" :reason "rotate" :at "2026-08-27T10:00:00Z"}
         (rotation-telemetry-lib/normalize-event
          {:from "a" :to "b" :at "2026-08-27T10:00:00Z"}))

(if (seq @failures)
  (do (doseq [f @failures] (println f))
      (println (str "\n" (count @failures) " failure(s)"))
      (System/exit 1))
  (println "ALL PASS: rotation_telemetry_lib.bb"))
