#!/usr/bin/env bb
;; BL-2095 declared invariants, coder-first (BL-654). Generative sweep over
;; the PURE decision layer (seat_difficulty_lib.bb) - the layer
;; ready_for_next_task.bb's claim path funnels through for both the
;; claimable/tier-skipped partition and the new diagnostic line. The
;; end-to-end wiring through the real ready_for_next_task.bb is BL-2095's
;; own acceptance feature (3 scenarios), the same split BL-1004's own
;; property runner already uses for its sibling decision.
;;
;;   Invariant 1 ("what a seat claims, defers or leaves is unchanged: the
;;     line is printed for exactly the parcels the tier filter already
;;     leaves, and for no other"): a candidate is NOT eligible (tier-
;;     skipped) exactly when difficulty-claim-decision answers
;;     :skip-ineligible, or :defer-better-fit with no own-task override -
;;     :skip-ineligible is NEVER eligible whatever own-tasks says (the
;;     override only ever reaches :defer-better-fit), and :claim is ALWAYS
;;     eligible.
;;   Invariant 2 ("the line names no seat of the stage"): tier-skip-line,
;;     swept over adversarial seat-id-shaped strings never passed into it,
;;     never renders one - while still carrying every field it WAS given
;;     (basename, ticket, cost), so the check is not vacuously satisfied by
;;     an empty line.
;;
;; Generator reach: draws are CONSTRUCTED per shape (each
;; difficulty-claim-decision branch forced by construction, not hoped for
;; by a uniform draw over independent axes - BL-1572's own posture), never
;; sampled.

(require '[babashka.fs :as fs]
         '[clojure.string :as str])

(def script-dir (str (fs/parent (fs/canonicalize *file*))))
(load-file (str (fs/path script-dir ".." "seat_difficulty_lib.bb")))

(def runs (or (some-> (System/getenv "PROPERTY_RUNS") parse-long) 400))
(def seed (or (some-> (System/getenv "PROPERTY_SEED") parse-long) (System/nanoTime)))
(def rng (java.util.Random. seed))
(defn rand-int* [n] (.nextInt rng n))
(defn rand-nth* [xs] (nth xs (rand-int* (count xs))))
(defn rand-bool* [] (.nextBoolean rng))

(def failures (atom []))
(defn fail! [msg] (swap! failures conj msg))

;; ── invariant 1: eligibility set membership ──────────────────────────────
;; The SAME boolean wrap ready_for_next_task.bb's own (private)
;; difficulty-allows-claim? applies around difficulty-claim-decision - the
;; own-tasks override never reaches :skip-ineligible, only :defer-better-fit
;; (BL-1843).

(defn eligible? [decision own-tasks task]
  (boolean (or (= :claim decision)
               (and (= :defer-better-fit decision) (contains? own-tasks task)))))

(def task-pool ["BL-9001" "BL-9002" "BL-9003"])
(def SHAPES [:no-tiers :undeclared :tier-vs-cost :better-fit])
(def ALL-TIERS ["easy" "hard"])
(def ALL-COSTS ["low" "medium" "high"])
(def coverage (atom {:claim 0 :skip-ineligible 0 :defer-better-fit-overridden 0 :defer-better-fit-plain 0}))

(dotimes [i runs]
  (let [me "coder"
        task (rand-nth* task-pool)
        own-tasks (if (rand-bool*) #{task} #{})
        ;; Shape first, every input DERIVED from it - reach by construction
        ;; (BL-1572), never a uniform draw hoping to land on each of
        ;; difficulty-claim-decision's branches. :tier-vs-cost sweeps EVERY
        ;; (tier, cost) combination so the ground-truth cross-check below
        ;; is not limited to one hand-picked ineligible/eligible pair.
        shape (rand-nth* SHAPES)
        my-tier (case shape (:no-tiers :undeclared) nil (:tier-vs-cost :better-fit) (rand-nth* ALL-TIERS))
        cost (if (= shape :better-fit) "low" (rand-nth* ALL-COSTS))
        ;; :undeclared: a STAGE-MATE (same stage, different seat) has a
        ;; declared tier - so stage-tiers-active? is true and "me" having
        ;; none is a genuine undeclared-on-an-active-stage case, not a
        ;; stage-with-no-tiers-at-all one (that is :no-tiers, above).
        tiers-map (case shape
                    :no-tiers {}
                    :undeclared {"coder@2" "hard"}
                    :tier-vs-cost {me my-tier}
                    :better-fit {me my-tier "sibling" "easy"})
        sibling-states (if (= shape :better-fit) [{:role "sibling" :tier "easy" :busy? false}] [])
        decision (seat-difficulty-lib/difficulty-claim-decision
                  {:me me :my-tier my-tier :cost cost :stage "coder"
                   :tiers tiers-map :sibling-states sibling-states
                   :models {} :conf-text ""})
        elig (eligible? decision own-tasks task)]
    (when (not= elig (eligible? decision own-tasks task))
      (fail! (str "draw " i ": eligible? is not deterministic for " (pr-str {:decision decision :own-tasks own-tasks :task task}))))
    (when (and (= :skip-ineligible decision) elig)
      (fail! (str "draw " i ": :skip-ineligible was eligible (own-tasks must never override a tier refusal): " (pr-str {:own-tasks own-tasks :task task}))))
    (when (and (= :claim decision) (not elig))
      (fail! (str "draw " i ": :claim was not eligible, whatever else is true")))
    ;; Ground-truth cross-check (:tier-vs-cost only, no sibling in play):
    ;; :skip-ineligible fires IFF cost-rank genuinely exceeds the declared
    ;; tier's ceiling - read from seat-difficulty-lib's own PUBLIC maps,
    ;; never re-derived from difficulty-claim-decision itself (the thing
    ;; under test), so this cannot be tautologically true.
    (when (= shape :tier-vs-cost)
      (let [truly-ineligible (> (get seat-difficulty-lib/cost-rank cost) (get seat-difficulty-lib/tier-ceiling my-tier))]
        (when (and truly-ineligible (not= :skip-ineligible decision))
          (fail! (str "draw " i ": cost " cost " truly exceeds tier " my-tier "'s ceiling but decision was " decision)))
        (when (and (not truly-ineligible) (not= :claim decision))
          (fail! (str "draw " i ": cost " cost " is genuinely within tier " my-tier "'s ceiling but decision was " decision)))))
    (case decision
      :claim (swap! coverage update :claim inc)
      :skip-ineligible (swap! coverage update :skip-ineligible inc)
      :defer-better-fit (swap! coverage update (if (contains? own-tasks task) :defer-better-fit-overridden :defer-better-fit-plain) inc))))

;; Reach floors are ABSOLUTE (never scaled to PROPERTY_RUNS): each of the 5
;; shapes is drawn ~1/5 of 400 by construction; :defer-better-fit further
;; splits ~50/50 on own-tasks within its own ~1/5 share.
(doseq [[k floor] {:claim 20 :skip-ineligible 20 :defer-better-fit-overridden 10 :defer-better-fit-plain 10}]
  (when (< (get @coverage k) floor)
    (fail! (str "generator coverage: " (name k) " reached only " (get @coverage k) " of " runs " (floor " floor ")"))))

;; ── invariant 2: no seat identity ever renders ───────────────────────────
;; Mirrors bl1004_seat_affinity_property_runner.bb's own seat-pool sweep
;; for deferral-line/cross-seat-claim-line, applied to tier-skip-line.
;; tier-skip-line receives no seat field at all (basename/ticket/cost
;; only) - the strongest form of the invariant - so this also proves the
;; check is non-vacuous: every field actually GIVEN still appears.

(def seat-pool ["coder@2" "coder@sonnet2" "hardener@zz9" "cleaner@b" "coder@iq3"])
(def basename-pool
  ["50_20261009T174953Z_000_from_coordinator_to_coder_for_coder.handoff"
   "10_20261009T140109Z_017595_from_coordinator_to_coder_for_coder.handoff"])
(def cost-pool ["low" "medium" "high"])

(dotimes [i runs]
  (let [basename (rand-nth* basename-pool)
        ticket (rand-nth* task-pool)
        cost (rand-nth* cost-pool)
        line (seat-difficulty-lib/tier-skip-line {:basename basename :ticket ticket :cost cost})]
    (when-not (str/includes? line basename)
      (fail! (str "draw " i ": line dropped the basename it was given (non-vacuity breach): " line)))
    (when-not (str/includes? line ticket)
      (fail! (str "draw " i ": line dropped the ticket it was given (non-vacuity breach): " line)))
    (when-not (str/includes? line cost)
      (fail! (str "draw " i ": line dropped the cost it was given (non-vacuity breach): " line)))
    (doseq [seat seat-pool]
      (when (str/includes? line seat)
        (fail! (str "draw " i ": seat id " seat " leaked into tier-skip-line: " line))))))

(println (str "  seed " seed " runs " runs " coverage " (pr-str @coverage)))
(if (empty? @failures)
  (do (println (str "bl2095 tier-skip properties: " runs " draws over the pure eligibility wrap and the diagnostic renderer"))
      (println "ALL PROPERTIES HOLD"))
  (do (doseq [f @failures] (println f))
      (System/exit 1)))
