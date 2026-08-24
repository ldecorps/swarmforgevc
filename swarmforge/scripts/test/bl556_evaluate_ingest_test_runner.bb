#!/usr/bin/env bb
;; BL-556 unit checks for pure evaluate ingest.
(require '[babashka.fs :as fs]
         '[cheshire.core :as json]
         '[clojure.string :as str])

(def script-dir (fs/parent (fs/canonicalize *file*)))
(def scripts-dir (fs/parent script-dir))
(load-file (str (fs/path scripts-dir "model_steward_lib.bb")))
(load-file (str (fs/path scripts-dir "model_steward_evaluate_lib.bb")))

(def failures (atom []))
(defn assert= [label expected actual]
  (when (not= expected actual)
    (swap! failures conj (str "FAIL " label ": expected " (pr-str expected) " got " (pr-str actual)))))
(defn assert-true [label actual]
  (when-not actual
    (swap! failures conj (str "FAIL " label))))

(def scorecard-art
  {:scorecard_id "recruiter-scorecard:winner-01"
   :model "winner-model"
   :entries [{:competency "receive" :status "pass"}
             {:competency "protocol-compliance" :status "pass"}
             {:competency "tool-usage" :status "pass"}]
   :overall "swarm-compliant"})

(def prior-report
  {:gates [{:gate "receive" :passed? true :status "pass"}
           {:gate "send-handoff" :passed? true :status "pass"}]})

(def regressed-art
  {:scorecard_id "recruiter-scorecard:winner-02"
   :model "winner-model"
   :entries [{:competency "receive" :status "pass"}
             {:competency "send-handoff" :status "fail" :reason "stale"}]
   :overall "fail"})

(let [reg (model-steward-lib/register-model model-steward-lib/empty-registry
                                            "test" "winner-model"
                                            {:status "candidate" :context_window 1000 :cost_class "medium"})
      out (model-steward-evaluate-lib/apply-evaluate
           reg "test" "winner-model" "coder" scorecard-art nil nil "2026-08-24T00:00:00Z")]
  (assert-true "capabilities populated" (some? (get-in out [:capabilities "coding_quality" :score])))
  (assert= "evidence is scorecard id" "recruiter-scorecard:winner-01" (:evidence out))
  (assert-true "gates non-empty" (seq (get-in out [:report :gates])))
  (assert= "report references scorecard id"
           "recruiter-scorecard:winner-01"
           (get-in out [:report :scorecard_id]))
  (assert= "role matrix evidence"
           "recruiter-scorecard:winner-01"
           (:evidence (first (get-in out [:registry :role_matrix "coder"])))))

(let [diffs (model-steward-evaluate-lib/regression-diff
             prior-report
             (model-steward-evaluate-lib/gates-from-scorecard (model-steward-evaluate-lib/scorecard-body regressed-art)))]
  (assert= "one gate regressed" 1 (count diffs))
  (assert= "send-handoff regressed" "send-handoff" (:gate (first diffs))))

(assert-true "missing scorecard_id throws"
             (try (model-steward-evaluate-lib/require-scorecard-id {:model "x" :entries []})
                  false
                  (catch Exception _ true)))

(let [bake {:bakeoff_run_id "bakeoff-run:b1"
            :roles [{:leaderboard {:ranked [{:model "winner-model" :capability 8}]}}]}
      reg (model-steward-lib/register-model model-steward-lib/empty-registry
                                            "test" "winner-model"
                                            {:status "candidate" :context_window 1000 :cost_class "medium"})
      out (model-steward-evaluate-lib/apply-evaluate
           reg "test" "winner-model" "coder" scorecard-art bake nil "t")]
  (assert= "evidence joins ids"
           "recruiter-scorecard:winner-01+bakeoff-run:b1"
           (:evidence out))
  (assert= "report bakeoff id" "bakeoff-run:b1" (get-in out [:report :bakeoff_run_id]))
  (assert-true "bakeoff capability merged"
               (some? (get-in out [:capabilities "coding_quality" :bakeoff_capability]))))

(if (empty? @failures)
  (println "ALL PASS")
  (do (doseq [f @failures] (println f))
      (System/exit 1)))
