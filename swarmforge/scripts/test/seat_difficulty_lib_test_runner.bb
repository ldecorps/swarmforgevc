#!/usr/bin/env bb
;; Unit assertions for seat_difficulty_lib.bb (BL-1001).
(ns seat-difficulty-lib-test-runner
  (:require [babashka.fs :as fs]
            [clojure.string :as str]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "seat_difficulty_lib.bb")))

(def failures (atom []))

(defn assert= [msg expected actual]
  (when (not= expected actual)
    (swap! failures conj (str "FAIL: " msg "\n  expected: " (pr-str expected) "\n  actual:   " (pr-str actual)))))

(assert= "parse tiers from window --seat-tier"
         {"coder" "hard" "coder@sonnet2" "easy"}
         (seat-difficulty-lib/parse-seat-tiers
          (str "window coder claude coder --model x --seat-tier hard\n"
               "window coder@sonnet2 claude coder-s --model y --seat-tier easy\n"
               "window cleaner claude cleaner --model z\n")))

(assert= "unknown tier flag ignored"
         {}
         (seat-difficulty-lib/parse-seat-tiers "window coder claude coder --seat-tier medium\n"))

(assert= "mutation_cost parse"
         "high"
         (seat-difficulty-lib/parse-mutation-cost "id: BL-1\nmutation_cost: high\n"))

(assert= "easy rejects high"
         false
         (seat-difficulty-lib/seat-accepts? "easy" "high"))

(assert= "easy accepts low"
         true
         (seat-difficulty-lib/seat-accepts? "easy" "low"))

(assert= "hard accepts medium"
         true
         (seat-difficulty-lib/seat-accepts? "hard" "medium"))

(assert= "undeclared accepts high"
         true
         (seat-difficulty-lib/seat-accepts? nil "high"))

(let [tiers {"coder" "hard"}]
  (assert= "undeclared seat on tiered stage skips high (architect bounce)"
           :skip-ineligible
           (seat-difficulty-lib/difficulty-claim-decision
            {:me "coder@sonnet2" :my-tier nil :cost "high" :stage "coder"
             :tiers tiers
             :sibling-states [{:role "coder" :tier "hard" :busy? true}]}))
  (assert= "undeclared seat on tiered stage skips low too (declaration required)"
           :skip-ineligible
           (seat-difficulty-lib/difficulty-claim-decision
            {:me "coder@sonnet2" :my-tier nil :cost "low" :stage "coder"
             :tiers tiers
             :sibling-states [{:role "coder" :tier "hard" :busy? true}]}))
  (assert= "hard does not defer-better-fit to an undeclared idle sibling"
           :claim
           (seat-difficulty-lib/difficulty-claim-decision
            {:me "coder" :my-tier "hard" :cost "low" :stage "coder"
             :tiers tiers
             :sibling-states [{:role "coder@sonnet2" :tier nil :busy? false}]})))

(let [tiers {"coder" "hard" "coder@sonnet2" "easy"}
      sibs [{:role "coder@sonnet2" :tier "easy" :busy? false}]]
  (assert= "low prefers idle easy over hard"
           :defer-better-fit
           (seat-difficulty-lib/difficulty-claim-decision
            {:me "coder" :my-tier "hard" :cost "low" :stage "coder"
             :tiers tiers :sibling-states sibs}))
  (assert= "easy claims low when hard would defer"
           :claim
           (seat-difficulty-lib/difficulty-claim-decision
            {:me "coder@sonnet2" :my-tier "easy" :cost "low" :stage "coder"
             :tiers tiers :sibling-states [{:role "coder" :tier "hard" :busy? false}]}))
  (assert= "easy skips high"
           :skip-ineligible
           (seat-difficulty-lib/difficulty-claim-decision
            {:me "coder@sonnet2" :my-tier "easy" :cost "high" :stage "coder"
             :tiers tiers :sibling-states [{:role "coder" :tier "hard" :busy? true}]}))
  (assert= "hard claims high when easy idle (easy ineligible)"
           :claim
           (seat-difficulty-lib/difficulty-claim-decision
            {:me "coder" :my-tier "hard" :cost "high" :stage "coder"
             :tiers tiers :sibling-states [{:role "coder@sonnet2" :tier "easy" :busy? false}]}))
  (assert= "hard claims low when easy busy (spill up)"
           :claim
           (seat-difficulty-lib/difficulty-claim-decision
            {:me "coder" :my-tier "hard" :cost "low" :stage "coder"
             :tiers tiers :sibling-states [{:role "coder@sonnet2" :tier "easy" :busy? true}]})))

(assert= "no declared tiers → always claim (BL-983)"
         :claim
         (seat-difficulty-lib/difficulty-claim-decision
          {:me "coder" :my-tier nil :cost "high" :stage "coder"
           :tiers {} :sibling-states [] :models {} :conf-text ""}))

(let [same-model-conf (str "window coder claude coder --model auto --seat-tier hard\n"
                           "window coder@cursor2 claude coder-s --model auto --seat-tier easy\n")
      same-models (seat-difficulty-lib/parse-seat-models same-model-conf)
      diff-model-conf (str "window coder claude coder --model auto --seat-tier hard\n"
                           "window coder@cursor2 claude coder-s --model claude-sonnet-5 --seat-tier easy\n")
      diff-models (seat-difficulty-lib/parse-seat-models diff-model-conf)
      tiers {"coder" "hard" "coder@cursor2" "easy"}]
  (assert= "parse models from window --model"
           {"coder" "auto" "coder@cursor2" "auto"}
           same-models)
  (assert= "same-model stage detected"
           true
           (seat-difficulty-lib/stage-models-equivalent? same-models same-model-conf "coder"))
  (assert= "different models not equivalent"
           false
           (seat-difficulty-lib/stage-models-equivalent? diff-models diff-model-conf "coder"))
  (assert= "easy claims medium when same model (BL-1167)"
           :claim
           (seat-difficulty-lib/difficulty-claim-decision
            {:me "coder@cursor2" :my-tier "easy" :cost "medium" :stage "coder"
             :tiers tiers :models same-models :conf-text same-model-conf
             :sibling-states [{:role "coder" :tier "hard" :busy? false}]}))
  (assert= "easy claims high when same model and hard busy"
           :claim
           (seat-difficulty-lib/difficulty-claim-decision
            {:me "coder@cursor2" :my-tier "easy" :cost "high" :stage "coder"
             :tiers tiers :models same-models :conf-text same-model-conf
             :sibling-states [{:role "coder" :tier "hard" :busy? true}]}))
  (assert= "easy skips high when models differ (BL-1001 unchanged)"
           :skip-ineligible
           (seat-difficulty-lib/difficulty-claim-decision
            {:me "coder@cursor2" :my-tier "easy" :cost "high" :stage "coder"
             :tiers tiers :models diff-models :conf-text diff-model-conf
             :sibling-states [{:role "coder" :tier "hard" :busy? true}]})))

;; ── BL-1316: claim-time effort ─────────────────────────────────────────────

(assert= "effort-for-mutation-cost is an identity map over the cost scale"
         "high"
         (seat-difficulty-lib/effort-for-mutation-cost "high"))

(assert= "effort-for-mutation-cost: unknown/absent cost -> nil"
         nil
         (seat-difficulty-lib/effort-for-mutation-cost nil))

(assert= "parse backends from window column 3"
         {"coder" "claude" "coder@cursor2" "cursor"}
         (seat-difficulty-lib/parse-seat-backends
          (str "window coder claude coder --model x\n"
               "window coder@cursor2 cursor coder-s --model y\n")))

(assert= "parse effort defaults from window --effort"
         {"coder" "high"}
         (seat-difficulty-lib/parse-seat-efforts
          (str "window coder claude coder --effort high\n"
               "window cleaner claude cleaner --model z\n")))

(assert= "claude has an effort lever" true (seat-difficulty-lib/effort-lever-backend? "claude"))
(assert= "cursor has no effort lever yet" false (seat-difficulty-lib/effort-lever-backend? "cursor"))
(assert= "copilot has no effort lever yet" false (seat-difficulty-lib/effort-lever-backend? "copilot"))
(assert= "nil backend has no lever" false (seat-difficulty-lib/effort-lever-backend? nil))

(assert= "claim-effort-decision: mutation_cost maps directly to effort"
         {:apply? true :effort "low"}
         (seat-difficulty-lib/claim-effort-decision
          {:backend "claude" :cost "low" :pack-default-effort "high"}))

(assert= "claim-effort-decision: absent cost restores the pack default"
         {:apply? true :effort "high"}
         (seat-difficulty-lib/claim-effort-decision
          {:backend "claude" :cost nil :pack-default-effort "high"}))

(assert= "claim-effort-decision: no lever backend never applies (invariant 2)"
         {:apply? false}
         (seat-difficulty-lib/claim-effort-decision
          {:backend "cursor" :cost "high" :pack-default-effort "low"}))

(assert= "claim-effort-decision: no cost and no pack default -> nothing to apply"
         {:apply? false}
         (seat-difficulty-lib/claim-effort-decision
          {:backend "claude" :cost nil :pack-default-effort nil}))

;; ── BL-1317: Adapt tier ────────────────────────────────────────────────────

(assert= "adapt ladder is exactly the cost-rank order, weakest first"
         ["low" "medium" "high"]
         seat-difficulty-lib/adapt-effort-ladder)

(assert= "a bounce climbs exactly one notch"
         {:apply? true :effort "high" :reason "bounce: climbing one notch"}
         (seat-difficulty-lib/adapt-effort-decision
          {:backend "claude" :prior-effort "medium" :baseline-effort "medium" :signal "bounce"}))

(assert= "a bounce from low climbs to medium, not straight to high"
         "medium"
         (:effort (seat-difficulty-lib/adapt-effort-decision
                   {:backend "claude" :prior-effort "low" :baseline-effort "low" :signal "bounce"})))

(assert= "a bounce at the top of the ladder does not overflow, and applies nothing"
         {:apply? false :effort "high" :reason "already at the top of the ladder"}
         (seat-difficulty-lib/adapt-effort-decision
          {:backend "claude" :prior-effort "high" :baseline-effort "medium" :signal "bounce"}))

(assert= "a clean completion short of the streak changes nothing"
         false
         (:apply? (seat-difficulty-lib/adapt-effort-decision
                   {:backend "claude" :prior-effort "high" :baseline-effort "medium"
                    :signal "clean" :clean-streak 2})))

(assert= "meeting the clean streak drops exactly one notch"
         {:apply? true :effort "medium" :reason "clean streak met: dropping one notch"}
         (seat-difficulty-lib/adapt-effort-decision
          {:backend "claude" :prior-effort "high" :baseline-effort "medium"
           :signal "clean" :clean-streak 3}))

(assert= "a drop never goes below the BL-1316 claim-time baseline"
         {:apply? false :effort "medium" :reason "already at the claim-time baseline"}
         (seat-difficulty-lib/adapt-effort-decision
          {:backend "claude" :prior-effort "medium" :baseline-effort "medium"
           :signal "clean" :clean-streak 99}))

(assert= "a high-cost ticket keeps its high baseline however long the clean run"
         false
         (:apply? (seat-difficulty-lib/adapt-effort-decision
                   {:backend "claude" :prior-effort "high" :baseline-effort "high"
                    :signal "clean" :clean-streak 500})))

(assert= "an explicit clean-streak-required overrides the default"
         true
         (:apply? (seat-difficulty-lib/adapt-effort-decision
                   {:backend "claude" :prior-effort "high" :baseline-effort "low"
                    :signal "clean" :clean-streak 1 :clean-streak-required 1})))

(assert= "a lever-less backend applies nothing and names no effort (invariant 2)"
         {:apply? false :reason "backend has no reasoning-effort lever"}
         (seat-difficulty-lib/adapt-effort-decision
          {:backend "cursor" :prior-effort "medium" :baseline-effort "medium" :signal "bounce"}))

(assert= "an unknown prior effort is not guessed at"
         false
         (:apply? (seat-difficulty-lib/adapt-effort-decision
                   {:backend "claude" :prior-effort "turbo" :baseline-effort "medium" :signal "bounce"})))

(assert= "an unknown signal changes nothing"
         false
         (:apply? (seat-difficulty-lib/adapt-effort-decision
                   {:backend "claude" :prior-effort "medium" :baseline-effort "medium" :signal "shrug"})))

(assert= "an absent baseline is read as the prior effort, never as the bottom rung"
         false
         (:apply? (seat-difficulty-lib/adapt-effort-decision
                   {:backend "claude" :prior-effort "high" :baseline-effort nil
                    :signal "clean" :clean-streak 9})))

(if (seq @failures)
  (do (doseq [f @failures] (binding [*out* *err*] (println f)))
      (println (str (count @failures) " failure(s)"))
      (System/exit 1))
  (println "ALL PASS: seat_difficulty_lib.bb"))
