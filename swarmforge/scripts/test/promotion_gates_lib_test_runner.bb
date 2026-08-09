#!/usr/bin/env bb
;; TDD runner for promotion_gates_lib.bb (BL-663) - the one chokepoint every
;; promotion path must call before a ticket crosses into backlog/active/ or
;; is routed.

(ns promotion-gates-lib-test-runner
  (:require [babashka.fs :as fs]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "promotion_gates_lib.bb")))

(def failures (atom []))

(defn assert= [msg expected actual]
  (when (not= expected actual)
    (swap! failures conj (str "FAIL: " msg "\n  expected: " (pr-str expected) "\n  actual:   " (pr-str actual)))))

(defn assert-nil [msg actual] (assert= msg nil actual))
(defn assert-true [msg actual] (assert= msg true (boolean actual)))
(defn assert-false [msg actual] (assert= msg false (boolean actual)))

(def created-temp-dirs (atom []))
(.addShutdownHook (Runtime/getRuntime)
                  (Thread. (fn [] (doseq [d @created-temp-dirs] (try (fs/delete-tree d) (catch Exception _ nil))))))

(defn mk-root []
  (let [d (str (fs/create-temp-dir {:prefix "promotion-gates-test-"}))]
    (swap! created-temp-dirs conj d)
    d))

(defn write-active! [root id content]
  (fs/create-dirs (fs/path root "backlog" "active"))
  (spit (str (fs/path root "backlog" "active" (str id "-demo.yaml"))) content))

;; ── read-field: comments, quotes, folded blocks ─────────────────────────

(assert= "plain scalar" "approved" (promotion-gates-lib/read-field "human_approval: approved\n" "human_approval"))
(assert= "trailing inline comment stripped"
         "approved"
         (promotion-gates-lib/read-field "human_approval: approved  # human (ldecorps), 2026-07-15: \"ok\"\n" "human_approval"))
(assert= "surrounding quotes stripped" "swarm-reliability" (promotion-gates-lib/read-field "epic: \"swarm-reliability\"\n" "epic"))
(assert-nil "a folded block scalar reads as absent, not literally \">\"" (promotion-gates-lib/read-field "human_approval: >\n  some prose\n" "human_approval"))
(assert-nil "field absent entirely" (promotion-gates-lib/read-field "id: BL-1\n" "human_approval"))
(assert= "priority parses leading zero as decimal, not octal" 4 (promotion-gates-lib/read-priority "priority: 04\n"))
(assert= "priority absent falls back to 999999 (sorts last)" 999999 (promotion-gates-lib/read-priority "id: BL-1\n"))

;; ── human-approval-refusal ───────────────────────────────────────────────

(assert-nil "absent human_approval passes (not applicable)" (promotion-gates-lib/human-approval-refusal "id: BL-1\n"))
(assert-nil "approved passes" (promotion-gates-lib/human-approval-refusal "human_approval: approved\n"))
(let [r (promotion-gates-lib/human-approval-refusal "human_approval: pending\n")]
  (assert= "pending refuses naming the gate" "human_approval" (:gate r))
  (assert-true "pending refusal reason mentions pending" (clojure.string/includes? (:reason r) "pending")))
(assert= "amending refuses" "human_approval" (:gate (promotion-gates-lib/human-approval-refusal "human_approval: amending\n")))
(assert= "rejected refuses" "human_approval" (:gate (promotion-gates-lib/human-approval-refusal "human_approval: rejected\n")))

;; ── expedited? (Article 3.2.4) ────────────────────────────────────────────

(assert-true "defect + high is expedited" (promotion-gates-lib/expedited? "type: defect\nseverity: high\n"))
(assert-true "defect + critical is expedited" (promotion-gates-lib/expedited? "type: defect\nseverity: critical\n"))
(assert-true "legacy type: bug + high is still expedited (transition clause)" (promotion-gates-lib/expedited? "type: bug\nseverity: high\n"))
(assert-false "defect + medium is not expedited" (promotion-gates-lib/expedited? "type: defect\nseverity: medium\n"))
(assert-false "defect with no severity fails CLOSED - not expedited" (promotion-gates-lib/expedited? "type: defect\n"))
(assert-false "feature + high is not expedited (wrong type)" (promotion-gates-lib/expedited? "type: feature\nseverity: high\n"))

;; ── rank-candidates: expedite lane beats priority number ─────────────────

(assert-nil "ranking an empty seq returns nil" (promotion-gates-lib/rank-candidates []))
(let [defect {:file "defect.yaml" :content "id: BL-2\ntype: defect\nseverity: high\npriority: 50\n"}
      feature {:file "feature.yaml" :content "id: BL-1\ntype: feature\npriority: 5\n"}
      winner (promotion-gates-lib/rank-candidates [feature defect])]
  (assert= "the expedited defect wins over a feature with a numerically better priority"
           "defect.yaml" (:file winner)))
(let [a {:file "a.yaml" :content "id: BL-10\npriority: 5\n"}
      b {:file "b.yaml" :content "id: BL-9\npriority: 5\n"}
      winner (promotion-gates-lib/rank-candidates [a b])]
  (assert= "same priority ties break on id, lexically (same tie-break as the pre-existing bash sort)"
           "a.yaml" (:file winner)))
(let [a {:file "a.yaml" :content "id: BL-1\npriority: 10\n"}
      b {:file "b.yaml" :content "id: BL-2\npriority: 5\n"}
      winner (promotion-gates-lib/rank-candidates [a b])]
  (assert= "with no expedited candidates, lower priority number wins as before"
           "b.yaml" (:file winner)))

;; ── route-target ──────────────────────────────────────────────────────────

(assert= "specifier routes to specifier, never rewritten"
         {:route-to "specifier" :rewrite-assigned-to? false}
         (promotion-gates-lib/route-target "specifier"))
(assert= "absent assigned_to routes to coder, rewritten"
         {:route-to "coder" :rewrite-assigned-to? true}
         (promotion-gates-lib/route-target nil))
(assert= "already coder routes to coder, no rewrite (unchanged as today)"
         {:route-to "coder" :rewrite-assigned-to? false}
         (promotion-gates-lib/route-target "coder"))
(assert= "any other value routes to coder, rewritten"
         {:route-to "coder" :rewrite-assigned-to? true}
         (promotion-gates-lib/route-target "documenter"))

;; ── depth-refusal ─────────────────────────────────────────────────────────

(assert-nil "under cap passes" (promotion-gates-lib/depth-refusal 0 1))
(let [r (promotion-gates-lib/depth-refusal 1 1)]
  (assert= "at cap refuses naming active_backlog_max_depth" "active_backlog_max_depth" (:gate r)))
(assert-nil "over cap by config change still passes when count < cap" (promotion-gates-lib/depth-refusal 3 5))

;; ── orthogonality-advisory (BL-854: never refuses, names the tickets) ────

(assert-nil "no candidate epic yields no advisory" (promotion-gates-lib/orthogonality-advisory nil {"epic-a" ["BL-1"]}))
(assert-nil "epic not in the active map yields no advisory" (promotion-gates-lib/orthogonality-advisory "epic-b" {"epic-a" ["BL-1"]}))
(assert-nil "empty active map always yields no advisory (the depth=1 common case)" (promotion-gates-lib/orthogonality-advisory "epic-a" {}))
(let [r (promotion-gates-lib/orthogonality-advisory "epic-a" {"epic-a" ["BL-1" "BL-3"] "epic-c" ["BL-2"]})]
  (assert= "colliding epic produces an advisory naming orthogonality" "orthogonality" (:gate r))
  (assert= "the advisory names every id sharing the epic, not just one" ["BL-1" "BL-3"] (:ids r))
  (assert= "the advisory carries the colliding epic" "epic-a" (:epic r)))

;; ── advisory-line ─────────────────────────────────────────────────────────

(assert= "advisory-line formats gate|reason with every id joined"
         "ADVISORY|orthogonality|epic swarm-reliability is also active on BL-900, BL-901"
         (promotion-gates-lib/advisory-line {:epic "swarm-reliability" :ids ["BL-900" "BL-901"]}))

;; ── hold-refusal ──────────────────────────────────────────────────────────

(assert-nil "not held passes" (promotion-gates-lib/hold-refusal false))
(assert= "held refuses naming hold marker" "hold marker" (:gate (promotion-gates-lib/hold-refusal true)))

;; ── evaluate: the chokepoint, gate precedence and non-vacuous compliant pass ──

(assert= "held short-circuits before any other gate"
         {:ok false :gate "hold marker" :reason "ticket is parked in backlog/hold/, never auto-promoted"}
         (promotion-gates-lib/evaluate {:content "human_approval: pending\n" :held? true
                                         :active-count 0 :max-depth 5 :active-epics {}}))

(assert= "human_approval refusal surfaces before depth/orthogonality"
         "human_approval"
         (:gate (promotion-gates-lib/evaluate {:content "human_approval: pending\nepic: e\n" :held? false
                                                :active-count 0 :max-depth 5 :active-epics {"e" ["BL-1"]}})))

(assert= "depth refusal surfaces when at cap"
         "active_backlog_max_depth"
         (:gate (promotion-gates-lib/evaluate {:content "human_approval: approved\n" :held? false
                                                :active-count 5 :max-depth 5 :active-epics {}})))

(let [r (promotion-gates-lib/evaluate {:content "human_approval: approved\nepic: shared\n" :held? false
                                        :active-count 1 :max-depth 5 :active-epics {"shared" ["BL-9"]}})]
  (assert-true "BL-854 invariant 1: an epic collision with room under cap still allows (never refuses)"
               (:ok r))
  (assert= "the allow carries an orthogonality advisory naming the colliding ticket"
           {:gate "orthogonality" :epic "shared" :ids ["BL-9"]}
           (:advisory r)))

(assert-true "a fully compliant candidate passes"
             (:ok (promotion-gates-lib/evaluate {:content "human_approval: approved\nepic: solo\n" :held? false
                                                  :active-count 0 :max-depth 5 :active-epics {}})))

(assert-nil "a compliant candidate whose epic has no active overlap carries no advisory"
            (:advisory (promotion-gates-lib/evaluate {:content "human_approval: approved\nepic: solo\n" :held? false
                                                        :active-count 0 :max-depth 5 :active-epics {}})))

;; ── active-count / active-epics (impure readers) ─────────────────────────

(let [root (mk-root)]
  (assert= "active-count on a missing backlog/active/ is zero" 0 (promotion-gates-lib/active-count root))
  (assert= "active-epics on a missing backlog/active/ is empty" {} (promotion-gates-lib/active-epics root)))

(let [root (mk-root)]
  (write-active! root "BL-1" "id: BL-1\nepic: alpha\n")
  (write-active! root "BL-2" "id: BL-2\nepic: beta\n")
  (assert= "active-count reflects both files" 2 (promotion-gates-lib/active-count root))
  (assert= "active-epics maps each distinct epic to its own ticket id"
           {"alpha" ["BL-1"] "beta" ["BL-2"]}
           (promotion-gates-lib/active-epics root)))

(let [root (mk-root)]
  (write-active! root "BL-3" "id: BL-3\nepic: shared\n")
  (write-active! root "BL-4" "id: BL-4\nepic: shared\n")
  (assert= "active-epics names every id sharing one epic, sorted"
           {"shared" ["BL-3" "BL-4"]}
           (promotion-gates-lib/active-epics root)))

(if (seq @failures)
  (do
    (doseq [f @failures] (binding [*out* *err*] (println f)))
    (println (str "\n" (count @failures) " failure(s)"))
    (System/exit 1))
  (println "ALL PASS: promotion_gates_lib.bb"))
