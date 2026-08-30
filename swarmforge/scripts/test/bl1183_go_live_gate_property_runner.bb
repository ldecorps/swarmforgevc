#!/usr/bin/env bb
;; BL-1183's two declared invariants, coder-authored (BL-654), as PROPERTY
;; tests over model_steward_trial_lib.bb's go-live checklist.
;;
;; Deterministic by construction: a seeded LCG, never rand.
;;
;; GENERATOR REACH. The space is four independent facts - is each of the two
;; models SCORED, and is each ASSESSED - so it is enumerated rather than
;; sampled: sixteen combinations, drawn uniformly, with a floor on the fully
;; ready one and on each individual gap. A wide draw over evidence strings
;; would spend nearly every run in "everything missing", where invariant 1 is
;; trivially satisfied and invariant 2 has only one gap to name.
;;
;; Evidence strings are drawn from BOTH sides of the assessor predicate -
;; battery/scorecard/bake-off citations and plausible non-citations - because
;; "assessed" is decided by that predicate, and a generator that only ever
;; produced one kind would never exercise the boundary.
;;
;; Non-vacuity is proven by breaking each invariant and recording the result -
;; see backlog/evidence/BL-1183-go-live-gate-20260830.md.

(ns bl1183-go-live-gate-property-runner
  (:require [babashka.fs :as fs]
            [clojure.string :as str]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "model_steward_trial_lib.bb")))

(def runs (or (some-> (System/getenv "PROPERTY_RUNS") parse-long) 400))
(def failures (atom []))
(def coverage (atom {}))
(defn- cover! [k] (swap! coverage update k (fnil inc 0)))

(defn- step [s] (mod (+ (* s 1103515245) 12345) 2147483648))
(defn- gen-int [s n] [(mod (quot s 65536) n) (step s)])
(defn- gen-pick [s coll] (let [[i s'] (gen-int s (count coll))] [(nth (vec coll) i) s']))

(defn- report! [prop seed input msg]
  (swap! failures conj (str "FAIL " prop "\n  seed:  " seed "\n  input: " (pr-str input) "\n  " msg)))

(defn- check-all [prop gen-fn pred-fn]
  (loop [i 0 s 42]
    (when (< i runs)
      (let [[input s'] (gen-fn s)
            result (pred-fn input)]
        (when-not (true? result) (report! prop s input (str result)))
        (recur (inc i) s')))))

(def role "coder")
(def permanent {:provider "anthropic" :model "perm-model" :cost_class "medium"})
(def candidate {:provider "cerebras" :model "trial-model"})

;; Both sides of the assessor predicate, so the boundary is actually crossed.
(def citing-evidence ["battery: coder-battery-2026-08" "scorecard: run-17" "bake-off: alpha vs beta"])
(def non-citing-evidence ["the operator likes it" "seemed fine last week" "" nil])

(defn gen-case [s]
  (let [[perm-scored s0] (gen-int s 2)
        [trial-scored s1] (gen-int s0 2)
        [perm-cites s2] (gen-int s1 2)
        [trial-cites s3] (gen-int s2 2)
        [perm-ev s4] (gen-pick s3 (if (= 1 perm-cites) citing-evidence non-citing-evidence))
        [trial-ev s5] (gen-pick s4 (if (= 1 trial-cites) citing-evidence non-citing-evidence))]
    [{:perm-scored (= 1 perm-scored) :trial-scored (= 1 trial-scored)
      :perm-ev perm-ev :trial-ev trial-ev
      :perm-assessed (and (= 1 perm-scored) (= 1 perm-cites))
      :trial-assessed (and (= 1 trial-scored) (= 1 trial-cites))}
     s5]))

(defn- registry-for [{:keys [perm-scored trial-scored perm-ev trial-ev]}]
  (cond-> (-> model-steward-lib/empty-registry
              (model-steward-lib/register-model "anthropic" "perm-model" {:status "certified" :cost_class "medium"})
              (model-steward-lib/register-model "cerebras" "trial-model" {:status "certified" :cost_class "low"}))
    perm-scored (model-steward-lib/add-role-ranking role "anthropic" "perm-model" 7 perm-ev)
    trial-scored (model-steward-lib/add-role-ranking role "cerebras" "trial-model" 8 trial-ev)))

(defn- checklist-for [input]
  (model-steward-trial-lib/go-live-checklist
   (model-steward-trial-lib/go-live-readiness (registry-for input) role candidate permanent)))

;; ── invariant 1 ───────────────────────────────────────────────────────────
;; "Production day-long trials refuse to start when the go-live checklist is
;;  not satisfied."
;;
;; Stated as an EQUIVALENCE, so both directions are checked on every draw: the
;; checklist is ready exactly when all four facts hold. A gate that refused
;; everything would satisfy the refusal half and be useless; a gate that
;; allowed everything would satisfy nothing.

(check-all
 "P1: the checklist is satisfied exactly when both models are scored AND assessed"
 gen-case
 (fn [{:keys [perm-scored trial-scored perm-assessed trial-assessed] :as input}]
   (let [{:keys [ready?]} (checklist-for input)
         should-be-ready (and perm-scored trial-scored perm-assessed trial-assessed)]
     (when should-be-ready (cover! :fully-ready))
     (when-not perm-scored (cover! :perm-unscored))
     (when-not trial-scored (cover! :trial-unscored))
     (when (and perm-scored (not perm-assessed)) (cover! :perm-unassessed))
     (when (and trial-scored (not trial-assessed)) (cover! :trial-unassessed))
     (cond
       (and should-be-ready (not ready?)) "a fully ready pairing was refused"
       (and (not should-be-ready) ready?) "an unready pairing was allowed into a live trial"
       :else true))))

;; ── invariant 2 ───────────────────────────────────────────────────────────
;; "Checklist failure names the missing telemetry or assessor - never a silent
;;  skip into live trial."
;;
;; Three claims per unready draw: there IS a named gap, every gap names which
;; model it is about, and the refusal text carries all of them. A refusal that
;; said only "not ready" costs the operator the same search as no gate.

(check-all
 "P2: every unready checklist names its gaps, and the refusal carries all of them"
 gen-case
 (fn [{:keys [perm-scored trial-scored perm-assessed trial-assessed] :as input}]
   (let [{:keys [ready? missing] :as checklist} (checklist-for input)
         refusal (model-steward-trial-lib/go-live-refusal checklist)]
     (if ready?
       (if (some? refusal) "a satisfied checklist still produced a refusal" true)
       (cond
         (empty? missing) "an unready checklist named no gap at all - a silent skip"
         (str/blank? (str refusal)) "an unready checklist produced no refusal text"

         (not (every? #(or (str/includes? % "cerebras/trial-model")
                           (str/includes? % "anthropic/perm-model"))
                      missing))
         (str "a gap names no model: " (pr-str missing))

         (not (every? #(or (str/includes? % "telemetry") (str/includes? % "assessor")) missing))
         (str "a gap says neither telemetry nor assessor: " (pr-str missing))

         (not (every? #(str/includes? refusal %) missing))
         (str "the refusal dropped a gap: " (pr-str missing) " vs " refusal)

         ;; ...and the gap it names is the one that is actually missing.
         (and (not trial-scored)
              (not (some #(and (str/includes? % "telemetry") (str/includes? % "cerebras/trial-model")) missing)))
         "an unscored candidate produced no telemetry gap for it"

         (and trial-scored (not trial-assessed)
              (not (some #(and (str/includes? % "assessor") (str/includes? % "cerebras/trial-model")) missing)))
         "an unassessed candidate produced no assessor gap for it"

         :else true)))))

(def floors {:fully-ready 20 :perm-unscored 80 :trial-unscored 80 :perm-unassessed 40 :trial-unassessed 40})

(doseq [[k floor] floors]
  (let [drawn (get @coverage k 0)]
    (when (< drawn floor)
      (swap! failures conj (str "FAIL reach floor: " (name k) " drawn " drawn " < " floor)))))

(if (empty? @failures)
  (println (str "ALL PASS (" runs " runs each, coverage " (pr-str @coverage) ")"))
  (do (doseq [f @failures] (println f))
      (println (count @failures) "FAILURES")
      (System/exit 1)))
