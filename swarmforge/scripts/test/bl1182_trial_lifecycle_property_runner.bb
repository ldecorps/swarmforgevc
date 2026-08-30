#!/usr/bin/env bb
;; BL-1182's three declared invariants, coder-authored (BL-654), as PROPERTY
;; tests over model_steward_trial_lib.bb.
;;
;; In the Babashka property lane rather than the JS one because that is where
;; the lifecycle lives: driving these decisions from vitest would spawn a `bb`
;; subprocess per draw, and a property that costs a second a run gets its run
;; count cut until it stops finding anything.
;;
;; Deterministic by construction: a seeded LCG, never rand. A property that
;; flakes is worse than none, and a counterexample nobody can reproduce is not
;; a counterexample. Every failure prints the seed and the input.
;;
;; GENERATOR REACH, stated because it is the part that decides whether these
;; prove anything (BL-654, BL-1062):
;;   - scores are drawn from a DELIBERATELY SMALL alphabet, so ties - the case
;;     invariant 1's second clause is entirely about - are common. A wide
;;     numeric range makes an exact tie astronomically rare and the tie branch
;;     would be vacuous while the suite reported green.
;;   - the loser-re-nomination property DERIVES the second nomination from the
;;     first draw's own candidate and evidence, rather than drawing an
;;     independent pair that would collide only by luck.
;;   - cost classes are drawn from the three real classes plus nil, because
;;     unknown cost is a real registry state and its rank is the tie-break's
;;     edge case.
;;
;; Non-vacuity is proven by breaking each invariant and recording the result -
;; see backlog/evidence/BL-1182-property-non-vacuity-20260830.md.

(ns bl1182-trial-lifecycle-property-runner
  (:require [babashka.fs :as fs]
            [clojure.string :as str]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "model_steward_trial_lib.bb")))

(def runs (or (some-> (System/getenv "PROPERTY_RUNS") parse-long) 500))
(def failures (atom []))
(def coverage (atom {}))

(defn- cover! [k] (swap! coverage update k (fnil inc 0)))

;; ── seeded generator ──────────────────────────────────────────────────────

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
        (when-not (true? result)
          (report! prop s input (str result)))
        (recur (inc i) s')))))

;; Three scores only: ties are then ~1 in 3, not ~1 in 2^53.
(def scores [5 6 7])
(def cost-classes ["low" "medium" "high" nil])
(def roles ["coder" "architect" "QA"])

(defn gen-comparison [s]
  (let [[ts s0] (gen-pick s scores)
        [ps s1] (gen-pick s0 scores)
        [tc s2] (gen-pick s1 cost-classes)
        [pc s3] (gen-pick s2 cost-classes)]
    [{:trial-score ts :permanent-score ps :trial-cost tc :permanent-cost pc} s3]))

;; ── invariant 1 ───────────────────────────────────────────────────────────
;; "Promotion stays only when the trial effectively outranks the permanent
;;  model; a tie selects the cheaper cost_class."

(check-all
 "P1: a promotion means the trial outranked, or tied and was cheaper"
 gen-comparison
 (fn [{:keys [trial-score permanent-score trial-cost permanent-cost] :as input}]
   (let [{:keys [decision]} (model-steward-trial-lib/decide input)
         tc (model-factory-lib/cost-class-rank trial-cost)
         pc (model-factory-lib/cost-class-rank permanent-cost)]
     (cond
       (> trial-score permanent-score) (do (cover! :outrank)
                                           (or (= :promote decision)
                                               (str "outranking trial was not promoted: " decision)))
       (< trial-score permanent-score) (do (cover! :outranked)
                                           (or (= :revert decision)
                                               (str "outranked trial was not reverted: " decision)))
       (< tc pc) (do (cover! :tie-cheaper-trial)
                     (or (= :promote decision)
                         (str "tie with a cheaper trial was not promoted: " decision)))
       (> tc pc) (do (cover! :tie-cheaper-permanent)
                     (or (= :revert decision)
                         (str "tie with a cheaper permanent was not reverted: " decision)))
       :else (do (cover! :tie-equal-cost)
                 (or (= :revert decision)
                     (str "a tie on score AND cost must keep the incumbent: " decision)))))))

;; ── invariant 2 ───────────────────────────────────────────────────────────
;; "A losing trial reverts to the permanent model and records steward evidence
;;  against silent re-trial."
;;
;; Every draw is a losing trial BY CONSTRUCTION - the trial's score is drawn
;; strictly below the permanent's - because a uniform draw would spend two
;; thirds of its runs on trials that promote, where this invariant says nothing.

(def permanent {:provider "anthropic" :model "perm-model" :cost_class "medium"})

(defn registry-for [role trial-score trial-cost]
  (-> model-steward-lib/empty-registry
      (model-steward-lib/register-model "anthropic" "perm-model"
                                        {:status "certified" :cost_class "medium"})
      (model-steward-lib/register-model "cerebras" "trial-model"
                                        {:status "certified" :cost_class trial-cost})
      (model-steward-lib/add-role-ranking role "anthropic" "perm-model" 9 "scorecard: perm")
      (model-steward-lib/add-role-ranking role "cerebras" "trial-model" trial-score "scorecard: trial")))

(defn gen-loss [s]
  (let [[role s0] (gen-pick s roles)
        [ts s1] (gen-int s0 9)            ;; 0..8, always below the permanent's 9
        [tc s2] (gen-pick s1 cost-classes)
        [ev s3] (gen-int s2 3)]
    [{:role role :trial-score ts :trial-cost tc
      :evidence (nth ["" "scorecards/a.json" "scorecards/b.json"] ev)}
     s3]))

(check-all
 "P2: a losing trial reverts, records its evidence, and refuses a silent re-trial"
 gen-loss
 (fn [{:keys [role trial-score trial-cost evidence]}]
   (let [reg (registry-for role trial-score trial-cost)
         armed (:trials (model-steward-trial-lib/nominate
                         model-steward-trial-lib/empty-trials reg role
                         {:provider "cerebras" :model "trial-model" :evidence evidence}
                         permanent "2026-08-30T09:00:00Z"))
         {:keys [trials outcome]} (model-steward-trial-lib/assess armed reg role "2026-08-31T09:00:00Z")
         losers (model-steward-trial-lib/losers-for-role trials role)
         ;; DERIVED from this draw, never drawn beside it: the same candidate
         ;; and the same evidence it lost with.
         same (model-steward-trial-lib/nominate trials reg role
                                                {:provider "cerebras" :model "trial-model" :evidence evidence}
                                                permanent "2026-09-01T09:00:00Z")
         fresh (model-steward-trial-lib/nominate trials reg role
                                                 {:provider "cerebras" :model "trial-model"
                                                  :evidence (str evidence "-plus-new")}
                                                 permanent "2026-09-01T09:00:00Z")]
     (cover! :loss)
     (when (str/blank? evidence) (cover! :loss-without-evidence))
     (cond
       (not= :revert (:decision outcome))
       (str "a trial scoring " trial-score " against 9 was not reverted: " (:decision outcome))

       (not= "anthropic/perm-model" (model-steward-trial-lib/seat-id (:seat outcome)))
       (str "the seat did not return to the permanent model: " (:seat outcome))

       (not= 1 (count losers))
       (str "the loss was not recorded exactly once: " (pr-str losers))

       (not= (when-not (str/blank? evidence) evidence) (:evidence (first losers)))
       (str "the recorded loss does not carry the evidence it lost with: " (pr-str (first losers)))

       (nil? (:error same))
       "a re-nomination on the SAME evidence was allowed - the record does not prevent silent re-trial"

       (some? (:error fresh))
       (str "a re-nomination on NEW evidence was refused: " (:error fresh))

       :else true))))

;; ── invariant 3 ───────────────────────────────────────────────────────────
;; "Trial start and end same-role model switches transfer agent memory."
;;
;; What the lib owns is WHICH steps cross a boundary; that the CLI then runs the
;; transfer, and refuses the seat move when it fails, is the shell test's and
;; the acceptance's to show. The property here is the one the lib decides: a
;; boundary is owed exactly when the seat's model actually changes.

(def seats ["anthropic/perm-model" "cerebras/trial-model" "openai/other-model"])

(defn gen-switch [s]
  (let [[from s0] (gen-pick s seats)
        [to s1] (gen-pick s0 seats)
        [stp s2] (gen-pick s1 [:nominate :assess])]
    [{:from from :to to :step stp} s2]))

(check-all
 "P3: a boundary is owed exactly when the same-role seat model changes"
 gen-switch
 (fn [{:keys [from to step]}]
   (let [boundary (model-steward-trial-lib/boundary-for step {:from from :to to})]
     (if (= from to)
       (do (cover! :no-change)
           (or (nil? boundary)
               (str "a step that changes no model owed a transfer: " boundary)))
       (do (cover! (if (= step :nominate) :start-change :end-change))
           (cond
             (nil? boundary) "a same-role model change owed no transfer"
             (and (= step :nominate) (not= "trial-start" boundary))
             (str "arming a trial named the wrong boundary: " boundary)
             (and (= step :assess) (not= "trial-end" boundary))
             (str "assessing a trial named the wrong boundary: " boundary)
             :else true))))))

;; ── reach floors ──────────────────────────────────────────────────────────
;; Without these a generator that quietly stopped producing a case would leave
;; the property green forever - the failure mode BL-1062 exists for.

(def floors {:outrank 40 :outranked 40
             :tie-cheaper-trial 20 :tie-cheaper-permanent 20 :tie-equal-cost 20
             :loss 200 :loss-without-evidence 40
             :no-change 40 :start-change 100 :end-change 100})

(doseq [[k floor] floors]
  (let [drawn (get @coverage k 0)]
    (when (< drawn floor)
      (swap! failures conj (str "FAIL reach floor: " (name k) " drawn " drawn " < " floor)))))

;; ── report ────────────────────────────────────────────────────────────────
(if (empty? @failures)
  (println (str "ALL PASS (" runs " runs each, coverage " (pr-str @coverage) ")"))
  (do (doseq [f @failures] (println f))
      (println (count @failures) "FAILURES")
      (System/exit 1)))
