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
           :tiers {} :sibling-states []}))

(if (seq @failures)
  (do (doseq [f @failures] (binding [*out* *err*] (println f)))
      (println (str (count @failures) " failure(s)"))
      (System/exit 1))
  (println "ALL PASS: seat_difficulty_lib.bb"))
