#!/usr/bin/env bb
;; BL-556 / BL-547 Slice 2 — pure evaluate ingest. Reads captured recruiter
;; scorecard / bake-off JSON (no subprocess, no network) and produces registry
;; updates + an evidence-backed certification report. Capture wrappers MUST
;; carry a stable id field — never fabricate one:
;;   scorecard: top-level :scorecard_id beside BatteryScorecard fields
;;   bake-off:  top-level :bakeoff_run_id beside LabeledRecruiterReport fields
;;
;;   (load-file ".../model_steward_evaluate_lib.bb")
(ns model-steward-evaluate-lib
  (:require [babashka.fs :as fs]
            [clojure.string :as str]))

;; model_steward_lib is load-file'd here too (BL-1427: idempotent re-load,
;; free for a caller that already did it - CLI loads it before this file -
;; and load-bearing for a standalone analysis probe or any future caller
;; that does not). Fully-qualified calls below assume that binding.
(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "model_steward_lib.bb")))

(def capability-dimensions
  ["coding_quality" "protocol_compliance" "tool_usage" "autonomy" "cost_latency"])

(def passing-statuses
  #{"pass" "PASS" "swarm-compliant" "human-verdict-compliant"})

(defn entry-passed?
  [entry]
  (contains? passing-statuses (str (:status entry))))

(defn- require-artifact-id
  "Capture wrapper contract: `id-key` is mandatory. Missing → refuse;
   never invent a recruiter-scorecard:… / bakeoff-run:… pointer."
  [artifact id-key label]
  (let [id (get artifact id-key)]
    (when (or (nil? id) (str/blank? (str id)))
      (throw (ex-info (str "evaluate refused: captured " label " missing " (name id-key))
                       {:keys (keys artifact)})))
    (str id)))

(defn require-scorecard-id
  [artifact]
  (require-artifact-id artifact :scorecard_id "scorecard"))

(defn require-bakeoff-run-id
  [artifact]
  (require-artifact-id artifact :bakeoff_run_id "bake-off"))

(defn scorecard-body
  "BatteryScorecard fields may sit at the top level of the capture wrapper
   or under :scorecard — both are the existing emitted shape plus the id."
  [artifact]
  (or (:scorecard artifact)
      (select-keys artifact [:model :entries :overall])))

(defn bakeoff-body
  [artifact]
  (or (:report artifact)
      (select-keys artifact [:roles :escalated])))

(defn gates-from-scorecard
  "One gate per scorecard entry — competency name, pass/fail, raw status."
  [scorecard]
  (mapv (fn [e]
          {:gate (:competency e)
           :passed? (entry-passed? e)
           :status (:status e)
           :reason (:reason e)})
        (or (:entries scorecard) [])))

(defn- pass-rate [entries]
  (if (seq entries)
    (double (/ (count (filter entry-passed? entries)) (count entries)))
    0.0))

(defn- competency->dimension [competency]
  (let [c (str/lower-case (str competency))]
    (cond
      (str/includes? c "protocol") "protocol_compliance"
      (str/includes? c "tool") "tool_usage"
      (str/includes? c "autonom") "autonomy"
      (or (str/includes? c "cost") (str/includes? c "latenc")) "cost_latency"
      :else "coding_quality")))

(defn capabilities-from-scorecard
  "Map BatteryScorecard entries onto Slice-1 capability dimensions. Explicit
   competency→dimension hits average among themselves; untouched dimensions
   fall back to the overall pass rate so every dimension is populated."
  [scorecard]
  (let [entries (or (:entries scorecard) [])
        rate (pass-rate entries)
        grouped (group-by #(competency->dimension (:competency %)) entries)
        from-hits (into {}
                        (map (fn [dim]
                               (let [es (get grouped dim)]
                                 [dim {:score (if (seq es) (pass-rate es) rate)}]))
                             capability-dimensions))]
    from-hits))

(defn bakeoff-capability-for-model
  "Best capability score for `model` across bake-off role leaderboards."
  [bakeoff-body model]
  (let [scores (for [role (:roles bakeoff-body)
                     entry (get-in role [:leaderboard :ranked] [])
                     :when (= model (:model entry))]
                 (double (or (:capability entry) 0)))]
    (when (seq scores)
      (apply max scores))))

(defn merge-bakeoff-into-capabilities
  [capabilities bakeoff-score]
  (if bakeoff-score
    ;; Normalize integer capability counts into 0..1 by capping at 10 gates.
    (let [norm (min 1.0 (/ (double bakeoff-score) 10.0))]
      (assoc capabilities "coding_quality" {:score norm :bakeoff_capability bakeoff-score}))
    capabilities))

(defn gate-index [gates]
  (into {} (map (fn [g] [(:gate g) g]) gates)))

(defn regression-diff
  "Prior report gates vs current gates → which gates flipped pass→fail."
  [prior-report current-gates]
  (let [prior (gate-index (or (:gates prior-report) []))
        cur (gate-index current-gates)]
    (vec (for [[gate cg] cur
               :let [pg (get prior gate)]
               :when (and pg (:passed? pg) (not (:passed? cg)))]
           {:gate gate
            :from "pass"
            :to "fail"
            :prior_status (:status pg)
            :current_status (:status cg)}))))

(defn evidence-pointer
  [scorecard-id bakeoff-run-id]
  (if bakeoff-run-id
    (str scorecard-id "+" bakeoff-run-id)
    scorecard-id))

(defn overall-score-from-capabilities
  [capabilities]
  (let [scores (map #(get-in % [:score] 0.0) (vals capabilities))]
    (if (seq scores)
      (/ (reduce + scores) (count scores))
      0.0)))

(defn build-evaluate-report
  "Evidence-backed certification report: non-empty gates, scorecard/bakeoff
   ids, optional regression diff vs prior report."
  [provider model gates timestamp
   {:keys [scorecard-id bakeoff-run-id overall prior-report regressions]}]
  (cond-> {:provider provider
           :model model
           :timestamp timestamp
           :result (if (seq regressions) "regressed" "certified")
           :gates (vec gates)
           :scorecard_id scorecard-id}
    bakeoff-run-id (assoc :bakeoff_run_id bakeoff-run-id)
    overall (assoc :overall overall)
    (seq regressions) (assoc :regression_diff regressions)
    prior-report (assoc :prior_report prior-report)))

(defn apply-evaluate
  "Pure ingest: given registry + parsed artifacts (+ optional prior report),
   return {:registry :report :regressions :evidence :capabilities :score}."
  [registry provider model role scorecard-artifact bakeoff-artifact prior-report timestamp]
  (let [scorecard-id (require-scorecard-id scorecard-artifact)
        scorecard (scorecard-body scorecard-artifact)
        bakeoff-id (when bakeoff-artifact (require-bakeoff-run-id bakeoff-artifact))
        bakeoff (when bakeoff-artifact (bakeoff-body bakeoff-artifact))
        gates (gates-from-scorecard scorecard)
        caps (-> (capabilities-from-scorecard scorecard)
                 (merge-bakeoff-into-capabilities
                  (when bakeoff (bakeoff-capability-for-model bakeoff (:model scorecard)))))
        regressions (regression-diff prior-report gates)
        evidence (evidence-pointer scorecard-id bakeoff-id)
        score (overall-score-from-capabilities caps)
        report (build-evaluate-report provider model gates timestamp
                                       {:scorecard-id scorecard-id
                                        :bakeoff-run-id bakeoff-id
                                        :overall (:overall scorecard)
                                        :prior-report prior-report
                                        :regressions regressions})
        registry' (-> registry
                      (model-steward-lib/set-capability-entry provider model caps)
                      (model-steward-lib/add-role-ranking role provider model score evidence))]
    {:registry registry'
     :report report
     :regressions regressions
     :evidence evidence
     :capabilities caps
     :score score
     :scorecard-id scorecard-id
     :bakeoff-run-id bakeoff-id}))
