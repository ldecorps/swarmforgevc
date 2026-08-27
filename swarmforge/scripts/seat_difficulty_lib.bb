#!/usr/bin/env bb
;; BL-1001: stage seats claim by ticket mutation_cost against each seat's
;; DECLARED tier (--seat-tier on the pack window line). Pure decision;
;; ready_for_next_task.bb applies it inside the mailbox claim loop so seat
;; identity never escapes (BL-983 invariant 3).
;;
;; Tiers: easy (low only) | hard (low/medium/high). Asymmetric spill:
;;   - above-tier never lands (wait), however idle the cheap seat is
;;   - easy may spill UP to hard when easy is busy
;; Prefer the least-capable idle eligible seat when several can take it.
(ns seat-difficulty-lib
  (:require [clojure.string :as str]))

(def cost-rank
  {"low" 0 "medium" 1 "high" 2})

(def tier-ceiling
  "Highest mutation_cost rank a declared tier may accept."
  {"easy" 0 "hard" 2})

(defn normalize-tier
  "easy|hard only; unknown/blank -> nil (undeclared)."
  [s]
  (let [t (-> (str s) str/trim str/lower-case)]
    (when (contains? tier-ceiling t) t)))

(defn normalize-cost
  [s]
  (let [c (-> (str s) str/trim str/lower-case)]
    (when (contains? cost-rank c) c)))

(defn- window-flag-map
  "Parse `window <seat> … --flag value` lines into seat-id -> value map.
   `normalize` returns nil to drop the seat (unknown/blank value)."
  [conf-text flag-name normalize]
  (into {}
        (keep (fn [line]
                (let [trimmed (str/trim line)]
                  (when (str/starts-with? trimmed "window ")
                    (let [parts (str/split trimmed #"\s+")
                          seat (nth parts 1 nil)
                          flag-idx (.indexOf parts flag-name)]
                      (when (and seat (>= flag-idx 0) (< (inc flag-idx) (count parts)))
                        (when-let [val (normalize (nth parts (inc flag-idx)))]
                          [seat val]))))))
              (str/split-lines (or conf-text "")))))

(defn parse-seat-tiers
  "Map seat-id -> tier from pack conf window lines carrying --seat-tier.
   Pure over conf text. Unknown flag values are ignored (seat stays undeclared)."
  [conf-text]
  (window-flag-map conf-text "--seat-tier" normalize-tier))

(defn normalize-model
  "Non-blank --model token, lower-cased. Blank/whitespace -> nil."
  [s]
  (let [m (-> (str s) str/trim str/lower-case)]
    (when (seq m) m)))

(defn parse-seat-models
  "Map seat-id -> model from pack conf window lines carrying --model.
   Pure over conf text. Blank model tokens are ignored."
  [conf-text]
  (window-flag-map conf-text "--model" normalize-model))

(defn parse-window-seats
  "Seat ids appearing on pack conf `window` lines (any flags)."
  [conf-text]
  (into #{}
        (keep (fn [line]
                (let [trimmed (str/trim line)]
                  (when (str/starts-with? trimmed "window ")
                    (nth (str/split trimmed #"\s+") 1 nil))))
              (str/split-lines (or conf-text "")))))

(defn stage-seat-ids
  "Seat ids in `coll` whose stage prefix equals `stage` (before first @)."
  [coll stage]
  (filter (fn [seat] (= stage (first (str/split seat #"@" 2))))
          coll))

(defn stage-models-uniform?
  "BL-1167: true when every window seat of `stage` declares a --model and
   all those models are identical. Fewer than two stage seats → false
   (nothing to equate; keep BL-1001 / BL-983 as-is).
   `all-seats` is the full set of window seat ids (parse-window-seats)."
  [models all-seats stage]
  (let [seats (vec (stage-seat-ids all-seats stage))
        vals (mapv #(get models %) seats)]
    (and (>= (count seats) 2)
         (every? some? vals)
         (apply = vals))))
(defn parse-mutation-cost
  "mutation_cost value from ticket YAML text, or nil when absent/unknown."
  [yaml]
  (some (fn [line]
          (when (str/starts-with? (str/trim line) "mutation_cost:")
            (normalize-cost (str/trim (subs (str/trim line) (count "mutation_cost:"))))))
        (str/split-lines (or yaml ""))))

(defn seat-accepts?
  "True when declared tier may take cost. Undeclared tier accepts everything
   (single-seat / legacy window lines stay BL-983-identical)."
  [tier cost]
  (let [c (normalize-cost cost)
        t (normalize-tier tier)]
    (cond
      (nil? c) true
      (nil? t) true
      :else (<= (cost-rank c) (tier-ceiling t)))))

(defn stage-tiers-active?
  "True when any seat of stage has a declared tier in the map."
  [tiers stage]
  (boolean (some (fn [[seat _]]
                   (= stage (first (str/split seat #"@" 2))))
                 tiers)))

(defn- tier-ceil [tier]
  (get tier-ceiling (normalize-tier tier) 2))

(defn- idle-better-fit-sibling?
  "True when an idle sibling with a declared, strictly lower ceiling also
   accepts cost. Undeclared siblings never count as a better fit."
  [me my-ceil cost sibling-states]
  (boolean
   (some (fn [{:keys [role tier busy?]}]
           (and (not busy?)
                (not= role me)
                (some? (normalize-tier tier))
                (seat-accepts? tier cost)
                (< (tier-ceil tier) my-ceil)))
         sibling-states)))

(defn difficulty-claim-decision
  "Pure: may THIS seat claim this candidate now?
     :claim              - take it
     :skip-ineligible    - cost above my tier, or I have no declared tier on a
                           stage that uses tiers (declaration is mandatory to
                           participate — BL-1001 architect bounce)
     :defer-better-fit   - an idle sibling with a lower ceiling also accepts
                           (prefer easy for low when both idle)
   When the stage has no declared tiers at all, always :claim (BL-983 path).
   BL-1167: when every stage seat declares the same --model, tier filtering
   is bypassed — always :claim (idle-first among seats still via BL-983 race).
   sibling-states: [{:role :tier :busy?}] — other seats of the same stage.
   Optional :models map from parse-seat-models."
  [{:keys [me my-tier cost stage tiers sibling-states models window-seats]}]
  (cond
    (stage-models-uniform? (or models {}) (or window-seats #{}) stage)
    :claim

    (not (stage-tiers-active? tiers stage))
    :claim

    ;; Tier-active stage: undeclared seats do not participate (never infer open).
    (nil? (normalize-tier my-tier))
    :skip-ineligible

    (not (seat-accepts? my-tier cost))
    :skip-ineligible

    (idle-better-fit-sibling? me (tier-ceil my-tier) cost sibling-states)
    :defer-better-fit

    :else
    :claim))
