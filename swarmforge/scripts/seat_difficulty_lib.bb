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

(defn- window-line-seat [line]
  (when (str/starts-with? (str/trim line) "window ")
    (nth (str/split (str/trim line) #"\s+") 1 nil)))

(defn- seat-stage [seat]
  (first (str/split (str seat) #"@" 2)))

(defn parse-stage-window-seats
  "Set of seat ids for stage from pack conf window lines."
  [conf-text stage]
  (into #{}
        (keep (fn [line]
                (let [seat (window-line-seat line)]
                  (when (and seat (= stage (seat-stage seat)))
                    seat)))
              (str/split-lines (or conf-text "")))))

(defn parse-seat-tiers
  "Map seat-id -> tier from pack conf window lines carrying --seat-tier.
   Pure over conf text. Unknown flag values are ignored (seat stays undeclared)."
  [conf-text]
  (into {}
        (keep (fn [line]
                (let [trimmed (str/trim line)]
                  (when (str/starts-with? trimmed "window ")
                    (let [parts (str/split trimmed #"\s+")
                          seat (nth parts 1 nil)
                          flag-idx (.indexOf parts "--seat-tier")]
                      (when (and seat (>= flag-idx 0) (< (inc flag-idx) (count parts)))
                        (when-let [tier (normalize-tier (nth parts (inc flag-idx)))]
                          [seat tier]))))))
              (str/split-lines (or conf-text "")))))

(defn normalize-model [s]
  (let [m (-> (str s) str/trim str/lower-case)]
    (when (seq m) m)))

(defn parse-seat-models
  "Map seat-id -> model from pack conf window lines carrying --model.
   Pure over conf text. Used for BL-1167 same-model tier bypass."
  [conf-text]
  (into {}
        (keep (fn [line]
                (let [trimmed (str/trim line)]
                  (when (str/starts-with? trimmed "window ")
                    (let [parts (str/split trimmed #"\s+")
                          seat (nth parts 1 nil)
                          flag-idx (.indexOf parts "--model")]
                      (when (and seat (>= flag-idx 0) (< (inc flag-idx) (count parts)))
                        (when-let [model (normalize-model (nth parts (inc flag-idx)))]
                          [seat model]))))))
              (str/split-lines (or conf-text "")))))

(defn stage-models-equivalent?
  "True when every window seat of stage declares --model and all values match
   (BL-1167: tier routing off for model-equivalent stages)."
  [models conf-text stage]
  (let [seats (parse-stage-window-seats conf-text stage)
        values (into #{} (keep models seats))]
    (and (pos? (count seats))
         (= (count seats) (count (filter #(contains? models %) seats)))
         (= 1 (count values)))))

(defn parse-mutation-cost
  "mutation_cost value from ticket YAML text, or nil when absent/unknown."
  [yaml]
  (some (fn [line]
          (when (str/starts-with? (str/trim line) "mutation_cost:")
            (normalize-cost (str/trim (subs (str/trim line) (count "mutation_cost:"))))))
        (str/split-lines (or yaml ""))))

;; ── BL-1316: claim-time effort ─────────────────────────────────────────────
;; A seat's reasoning effort retunes to the claimed ticket's mutation_cost,
;; on top of BL-1001's seat pick and BL-236's static per-role Suggest dial.
;; Pure decision lives entirely here; handoff_lib.bb::apply-claim-effort! is
;; the IO edge that reads/writes the seat's settings file.

(defn effort-for-mutation-cost
  "Pure claim-time map from a ticket's mutation_cost to the reasoning-effort
   token to apply: identity over the same low/medium/high scale
   normalize-cost validates (crank for high, shrink for low). Absent/unknown
   cost -> nil, meaning 'no ticket-driven override' at the call site -
   claim-effort-decision then falls back to the pack/window default rather
   than leaving a prior ticket's effort in place (invariant 3)."
  [cost]
  (normalize-cost cost))

(defn- window-line-backend [line]
  (when (str/starts-with? (str/trim line) "window ")
    (nth (str/split (str/trim line) #"\s+") 2 nil)))

(defn parse-seat-backends
  "Map seat-id -> backend (window line column 3) from pack conf window
   lines. Pure over conf text."
  [conf-text]
  (into {}
        (keep (fn [line]
                (let [seat (window-line-seat line)
                      backend (window-line-backend line)]
                  (when (and seat (seq backend))
                    [seat backend]))))
        (str/split-lines (or conf-text ""))))

(defn parse-seat-efforts
  "Map seat-id -> declared --effort value from pack conf window lines. Pure
   over conf text. This is the pack/window DEFAULT a claim with no
   mutation_cost restores to (BL-1316 invariant 3)."
  [conf-text]
  (into {}
        (keep (fn [line]
                (let [trimmed (str/trim line)]
                  (when (str/starts-with? trimmed "window ")
                    (let [parts (str/split trimmed #"\s+")
                          seat (nth parts 1 nil)
                          flag-idx (.indexOf parts "--effort")]
                      (when (and seat (>= flag-idx 0) (< (inc flag-idx) (count parts)))
                        (when-let [effort (normalize-cost (nth parts (inc flag-idx)))]
                          [seat effort]))))))
              (str/split-lines (or conf-text "")))))

(def effort-lever-backends
  "Backends whose CLI exposes a reasoning-effort lever today (claude
   --effort / settings.json effortLevel). A backend not in this set gets no
   apply attempt at all - never an invented/unsupported flag (invariant 2).
   Cursor effort-bearing model ids and a Copilot equivalent join this set in
   a later ticket, not invented here."
  #{"claude"})

(defn effort-lever-backend?
  [backend]
  (contains? effort-lever-backends (some-> backend str/trim str/lower-case)))

(defn claim-effort-decision
  "Pure BL-1316 claim-time decision. Reads ONLY backend, the claimed
   ticket's mutation_cost, and the pack/window declared default effort -
   never a seat name, idle time, or any other schema field (invariant 1).
   A backend with no known lever always decides :apply? false (invariant 2).
   mutation_cost present -> its mapped effort; absent -> the pack/window
   default, so a prior claim's effort never rides into this one unchanged
   (invariant 3). No resolvable effort at all (no cost, no pack default) is
   also :apply? false - nothing to write."
  [{:keys [backend cost pack-default-effort]}]
  (if-not (effort-lever-backend? backend)
    {:apply? false}
    (let [effort (or (effort-for-mutation-cost cost) pack-default-effort)]
      (if effort
        {:apply? true :effort effort}
        {:apply? false}))))

;; ── BL-1317: Adapt tier ────────────────────────────────────────────────────
;; BL-236 shipped Suggest-only and explicitly deferred Adapt. BL-1316 (above)
;; sets the CLAIM-TIME baseline from the held ticket's mutation_cost. Adapt is
;; the tier that moves effort around that baseline from OUTCOME signals, so a
;; hard ticket that keeps bouncing can climb without a human turning the dial.
;;
;; The movement is deliberately asymmetric (declared invariant 2): a bounce
;; climbs ONE notch immediately, a drop needs a whole streak of clean
;; completions and never lands below the BL-1316 baseline. That is BL-545's
;; descent-ladder hysteresis - the cost of thinking too little is a bounced
;; parcel, the cost of thinking too much is only tokens, so evidence to climb
;; is cheap and evidence to descend is expensive.
;;
;; Pure, like claim-effort-decision above: no IO, no respawn, no file write.
;; handoff_lib.bb::record-effort-adapt! is the single IO edge over it.
;;
;; SINGLE POLICY, MIRRORED ACROSS A LANGUAGE BOUNDARY. The same ladder and the
;; same streak default are stated in TypeScript at
;; extension/src/tools/effortDialAdapt.ts (ADAPT_EFFORT_LADDER,
;; ADAPT_DEFAULT_CLEAN_STREAK) because the UI/launch paths decide there while
;; this consumer decides here. A comment claiming the two agree is not a gate,
;; so test/test_bl1317_effort_ladder_parity.sh asserts both literals agree
;; (the constant-across-a-language-boundary rule, BL-897).

(def adapt-effort-ladder
  "The effort ladder, weakest first. Derived from cost-rank rather than
   restated, so the two can never drift apart within this file."
  (mapv key (sort-by val cost-rank)))

(def adapt-default-clean-streak
  "Clean completions required before a single notch may be given back.
   Asymmetric with the one-signal climb by design (invariant 2)."
  3)

(defn- adapt-rank [effort]
  (get cost-rank (some-> effort str str/trim str/lower-case)))

(defn adapt-effort-decision
  "Pure BL-1317 Adapt decision: where a seat's effort moves given the effort
   it is running at, the BL-1316 claim-time baseline for the held ticket, and
   one outcome signal (\"bounce\" or \"clean\").

   :apply? is true ONLY when the effort actually changes - there is nothing to
   write otherwise, and an unchanged rung must not look like a retune. A
   backend with no reasoning-effort lever decides :apply? false and names no
   effort at all, so no unsupported flag can be built from this (BL-1316
   invariant 2, carried forward). An unknown prior effort or an unknown signal
   fails closed for the same reason: an effort token this ladder does not know
   is not a rung, and guessing one writes a flag the backend may reject."
  [{:keys [backend prior-effort baseline-effort signal clean-streak
           clean-streak-required]}]
  (if-not (effort-lever-backend? backend)
    {:apply? false :reason "backend has no reasoning-effort lever"}
    (let [prior (adapt-rank prior-effort)]
      (if (nil? prior)
        {:apply? false :effort prior-effort
         :reason (str "unknown prior effort " (pr-str prior-effort))}
        ;; An absent baseline is read as the CURRENT effort, never as the
        ;; bottom rung: reading "no baseline" as low would let a clean streak
        ;; drag a high-cost seat all the way down, which is exactly the floor
        ;; invariant 2 exists to hold.
        (let [floor (or (adapt-rank baseline-effort) prior)
              top (dec (count adapt-effort-ladder))
              sig (some-> signal str str/trim str/lower-case)]
          (case sig
            "bounce"
            (let [next (min (inc prior) top)]
              (if (= next prior)
                {:apply? false :effort prior-effort
                 :reason "already at the top of the ladder"}
                {:apply? true :effort (nth adapt-effort-ladder next)
                 :reason "bounce: climbing one notch"}))

            "clean"
            (let [required (or clean-streak-required adapt-default-clean-streak)
                  streak (or clean-streak 0)]
              (if (< streak required)
                {:apply? false :effort prior-effort
                 :reason (str "clean streak " streak "/" required)}
                (let [next (max (dec prior) floor)]
                  (if (= next prior)
                    {:apply? false :effort prior-effort
                     :reason "already at the claim-time baseline"}
                    {:apply? true :effort (nth adapt-effort-ladder next)
                     :reason "clean streak met: dropping one notch"}))))

            {:apply? false :effort prior-effort
             :reason (str "unknown signal " (pr-str signal))}))))))

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
                   (= stage (seat-stage seat)))
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
   When every seat shares the same --model, tier rules are off (BL-1167).
   sibling-states: [{:role :tier :busy?}] — other seats of the same stage."
  [{:keys [me my-tier cost stage tiers sibling-states models conf-text]}]
  (cond
    (stage-models-equivalent? models conf-text stage)
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
