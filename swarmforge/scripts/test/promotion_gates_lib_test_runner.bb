#!/usr/bin/env bb
;; TDD runner for promotion_gates_lib.bb (BL-663) - the one chokepoint every
;; promotion path must call before a ticket crosses into backlog/active/ or
;; is routed.

(ns promotion-gates-lib-test-runner
  (:require [babashka.fs :as fs]
            [clojure.string :as str]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "promotion_gates_lib.bb")))
(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "slice_size_envelope_gate_lib.bb")))

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
(assert-false "retired type: bug + high is not expedited" (promotion-gates-lib/expedited? "type: bug\nseverity: high\n"))
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

;; ── BL-1128: depth/cap/throttle preference inside the non-expedited bucket ─
(let [depth {:file "depth.yaml"
             :content "id: BL-683\ntitle: \"handoff depth warning off-by-one\"\npriority: 90\n"}
      unrelated {:file "other.yaml"
                 :content "id: BL-9000\ntitle: unrelated low-priority work\npriority: 1\n"}
      winner (promotion-gates-lib/rank-candidates [unrelated depth])]
  (assert= "BL-1128: depth/cap/throttle title preferred over better-priority unrelated"
           "depth.yaml" (:file winner)))
(let [defect {:file "defect.yaml" :content "id: BL-2\ntype: defect\nseverity: high\npriority: 50\n"}
      depth {:file "depth.yaml" :content "id: BL-683\ntitle: backlog depth cap wiring\npriority: 1\n"}
      winner (promotion-gates-lib/rank-candidates [depth defect])]
  (assert= "BL-1128: expedite lane still beats depth preference"
           "defect.yaml" (:file winner)))

;; ── epic-priority / epic-priority-index (BL-900) ─────────────────────────

(assert= "epic-priority resolves through the index when the epic has a tracker"
         5 (promotion-gates-lib/epic-priority "id: BL-1\nepic: alpha\npriority: 90\n" {"alpha" 5}))
(assert= "epic-priority falls back to own priority when the epic has no tracker in the index"
         90 (promotion-gates-lib/epic-priority "id: BL-1\nepic: alpha\npriority: 90\n" {}))
(assert= "epic-priority falls back to own priority when the candidate has no epic: field at all"
         90 (promotion-gates-lib/epic-priority "id: BL-1\npriority: 90\n" {"alpha" 5}))

(let [root (mk-root)]
  (assert= "epic-priority-index on a missing backlog tree is empty" {} (promotion-gates-lib/epic-priority-index root)))

(defn- write-yaml! [root stage id content]
  (fs/create-dirs (fs/path root "backlog" stage))
  (spit (str (fs/path root "backlog" stage (str id "-fixture.yaml"))) content))

(let [root (mk-root)]
  (write-yaml! root "paused" "BL-1" "id: BL-1\ntype: epic\nepic: alpha\npriority: 5\n")
  (write-yaml! root "active" "BL-2" "id: BL-2\ntype: feature\nepic: alpha\npriority: 90\n")
  (assert= "epic-priority-index reads a tracker from paused/, ignores a non-epic-type candidate sharing the epic"
           {"alpha" 5} (promotion-gates-lib/epic-priority-index root)))

(let [root (mk-root)]
  (write-yaml! root "paused" "BL-1" "id: BL-1\ntype: epic\nepic: alpha\npriority: 40\n")
  (write-yaml! root "done" "BL-2" "id: BL-2\ntype: epic\nepic: alpha\npriority: 5\n")
  (assert= "epic-priority-index: two+ trackers for one epic resolve to the most urgent (lowest) priority (decision 1)"
           {"alpha" 5} (promotion-gates-lib/epic-priority-index root)))

(let [root (mk-root)]
  (fs/create-dirs (fs/path root "backlog" "done" "M2-fixture-milestone"))
  (spit (str (fs/path root "backlog" "done" "M2-fixture-milestone" "BL-3-fixture.yaml"))
        "id: BL-3\ntype: epic\nepic: nested\npriority: 12\n")
  (assert= "epic-priority-index finds trackers nested one level under a done/<milestone> subdir"
           {"nested" 12} (promotion-gates-lib/epic-priority-index root)))

(let [root (mk-root)]
  (write-yaml! root "paused" "BL-1" "id: BL-1\ntype: epic\nepic: alpha\npriority: not-a-number\n")
  (assert= "epic-priority-index: an unparseable tracker priority falls back to 999999 (sorts last), like read-priority elsewhere"
           {"alpha" 999999} (promotion-gates-lib/epic-priority-index root)))

(let [root (mk-root)]
  (write-yaml! root "paused" "BL-1" "id: BL-1\ntype: epic\npriority: 5\n")
  (assert= "epic-priority-index: a tracker with no epic: field of its own contributes nothing"
           {} (promotion-gates-lib/epic-priority-index root)))

;; ── rank-candidates: epic-priority is compared before own-priority (BL-900) ──

(let [a {:file "a.yaml" :content "id: BL-A\nepic: e1\npriority: 90\n"}
      b {:file "b.yaml" :content "id: BL-B\nepic: e2\npriority: 1\n"}
      epic-index {"e1" 5 "e2" 40}
      winner (promotion-gates-lib/rank-candidates [a b] epic-index)]
  (assert= "a more urgent epic wins even against a numerically better own priority"
           "a.yaml" (:file winner)))

(let [a {:file "a.yaml" :content "id: BL-D\ntype: defect\nseverity: high\nepic: e900\npriority: 50\n"}
      b {:file "b.yaml" :content "id: BL-E\nepic: e1\npriority: 1\n"}
      epic-index {"e900" 900 "e1" 1}
      winner (promotion-gates-lib/rank-candidates [a b] epic-index)]
  (assert= "an expedited defect still outranks a candidate from a more urgent epic (invariant 2)"
           "a.yaml" (:file winner)))

(let [a {:file "a.yaml" :content "id: BL-F\npriority: 20\n"}
      b {:file "b.yaml" :content "id: BL-G\nepic: e50\npriority: 90\n"}
      epic-index {"e50" 50}
      winner (promotion-gates-lib/rank-candidates [a b] epic-index)]
  (assert= "a candidate whose epic has no tracker keeps its own priority (decision 3)"
           "a.yaml" (:file winner)))

(let [a {:file "a.yaml" :content "id: BL-H\nepic: sil\npriority: 90\n"}
      b {:file "b.yaml" :content "id: BL-I\nepic: e33\npriority: 1\n"}
      epic-index {"sil" 30 "e33" 33}
      winner (promotion-gates-lib/rank-candidates [a b] epic-index)]
  (assert= "an epic with several trackers ranks by its most urgent tracker (decision 1, threaded through ranking)"
           "a.yaml" (:file winner)))

(let [a {:file "a.yaml" :content "id: BL-A\nepic: e40\npriority: 50\n"}
      b {:file "b.yaml" :content "id: BL-B\nepic: e40\npriority: 50\n"}
      epic-index {"e40" 40}
      winner (promotion-gates-lib/rank-candidates [a b] epic-index)]
  (assert= "equal epic priority AND equal own priority falls through to id, same as before BL-900"
           "a.yaml" (:file winner)))

(let [defect {:file "defect.yaml" :content "id: BL-2\ntype: defect\nseverity: high\npriority: 50\n"}
      feature {:file "feature.yaml" :content "id: BL-1\ntype: feature\npriority: 5\n"}
      winner (promotion-gates-lib/rank-candidates [feature defect])]
  (assert= "rank-candidates called with no epic-index (1-arity) still lets the expedited bucket win, unchanged"
           "defect.yaml" (:file winner)))

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

;; ── BL-1145: epic-type / blocked-status refusals (structured, on evaluate) ──

(assert-nil "non-epic type passes epic-type-refusal"
            (promotion-gates-lib/epic-type-refusal "type: feature\n"))
(assert= "type: epic refuses naming gate epic"
         "epic"
         (:gate (promotion-gates-lib/epic-type-refusal "type: epic\n")))
(assert-nil "non-blocked status passes blocked-status-refusal"
            (promotion-gates-lib/blocked-status-refusal "status: todo\n"))
(assert= "status: blocked refuses naming gate blocked"
         "blocked"
         (:gate (promotion-gates-lib/blocked-status-refusal "status: blocked\n")))
(assert= "BL-1145: evaluate refuses type: epic before human_approval"
         "epic"
         (:gate (promotion-gates-lib/evaluate
                 {:content "type: epic\nhuman_approval: pending\n" :held? false
                  :active-count 0 :max-depth 5 :active-epics {}})))
(assert= "BL-1145: evaluate refuses status: blocked before human_approval"
         "blocked"
         (:gate (promotion-gates-lib/evaluate
                 {:content "type: feature\nstatus: blocked\nhuman_approval: pending\n" :held? false
                  :active-count 0 :max-depth 5 :active-epics {}})))
(assert= "BL-1145: hold still beats epic when both would fire"
         "hold marker"
         (:gate (promotion-gates-lib/evaluate
                 {:content "type: epic\n" :held? true
                  :active-count 0 :max-depth 5 :active-epics {}})))

;; ── BL-957: read-depends-on, the gate's OWN reader ───────────────────────
;; read-field is unusable here by documented design (nil for a blank value,
;; so a block list reads as NO dependencies - fail-open on exactly the
;; tickets the gate exists to catch). Every live form measured 2026-08-19.

(assert= "read-depends-on: flow list"
         {:ids ["BL-620" "BL-948"] :unparseable? false}
         (promotion-gates-lib/read-depends-on "depends_on: [BL-620, BL-948]\n"))
(assert= "read-depends-on: explicit empty list means NO dependencies (118 live tickets)"
         {:ids [] :unparseable? false}
         (promotion-gates-lib/read-depends-on "depends_on: []\n"))
(assert= "read-depends-on: absent field means no dependencies"
         {:ids [] :unparseable? false}
         (promotion-gates-lib/read-depends-on "id: BL-1\n"))
(assert= "read-depends-on: block list is READ, never treated as absent (the fail-open trap)"
         {:ids ["BL-547" "BL-556"] :unparseable? false}
         (promotion-gates-lib/read-depends-on "depends_on:\n  - BL-547\n  - BL-556\n"))
(assert= "read-depends-on: block list stops at the first non-indented line"
         {:ids ["BL-547"] :unparseable? false}
         (promotion-gates-lib/read-depends-on "depends_on:\n  - BL-547\npriority: 3\n"))
(assert= "read-depends-on: bare scalar with trailing prose reads the ids and ignores the prose"
         {:ids ["BL-090" "BL-091"] :unparseable? false}
         (promotion-gates-lib/read-depends-on "depends_on: BL-090, BL-091 (both must land first)\n"))
(assert= "read-depends-on: GH-seeded ids are read too"
         {:ids ["GH-12"] :unparseable? false}
         (promotion-gates-lib/read-depends-on "depends_on: [GH-12]\n"))
(assert= "read-depends-on: duplicates collapse, first occurrence order kept"
         {:ids ["BL-620" "BL-948"] :unparseable? false}
         (promotion-gates-lib/read-depends-on "depends_on: [BL-620, BL-948, BL-620]\n"))
(assert= "read-depends-on: an inline comment never contributes ids"
         {:ids [] :unparseable? false}
         (promotion-gates-lib/read-depends-on "depends_on: []  # unblocks after BL-620 lands\n"))
(assert= "read-depends-on: a present, non-empty value with no parseable id is UNPARSEABLE, never silently empty (invariant 2)"
         {:ids [] :unparseable? true}
         (promotion-gates-lib/read-depends-on "depends_on: someday maybe\n"))

;; ── BL-957: done-ids (flat files AND done/<Mx>/ subfolders) ──────────────

(let [root (mk-root)]
  (fs/create-dirs (fs/path root "backlog" "done" "M7"))
  (spit (str (fs/path root "backlog" "done" "BL-700-flat.yaml")) "id: BL-700\n")
  (spit (str (fs/path root "backlog" "done" "M7" "BL-333-nested.yaml")) "id: BL-333\n")
  (spit (str (fs/path root "backlog" "done" "oddly-named.yaml")) "id: BL-444\n")
  (let [ids (promotion-gates-lib/done-ids root)]
    (assert-true "done-ids: a flat done file resolves" (contains? ids "BL-700"))
    (assert-true "done-ids: a done/<Mx>/ nested file resolves (close-into-done/Mx convention)" (contains? ids "BL-333"))
    (assert-true "done-ids: a file whose NAME carries no id still resolves via its id: field" (contains? ids "BL-444"))))

(assert= "done-ids: no done/ directory at all is the empty set, never a crash"
         #{} (promotion-gates-lib/done-ids (mk-root)))

;; ── BL-957: depends-on-refusal ────────────────────────────────────────────

(assert-nil "every dependency landed in done/ passes"
            (promotion-gates-lib/depends-on-refusal "depends_on: [BL-700]\n" #{"BL-700"}))
(assert-nil "no dependencies at all passes"
            (promotion-gates-lib/depends-on-refusal "depends_on: []\n" #{}))
(let [r (promotion-gates-lib/depends-on-refusal "depends_on: [BL-620]\n" #{"BL-700"})]
  (assert= "an unlanded dependency refuses naming the gate" "depends_on" (:gate r))
  (assert-true "the refusal names the unsatisfied id" (clojure.string/includes? (:reason r) "BL-620")))
(let [r (promotion-gates-lib/depends-on-refusal "depends_on: [BL-700, BL-620, BL-948]\n" #{"BL-700"})]
  (assert-true "the refusal names every unsatisfied id" (and (clojure.string/includes? (:reason r) "BL-620")
                                                             (clojure.string/includes? (:reason r) "BL-948")))
  (assert-false "the refusal never names a satisfied id" (clojure.string/includes? (:reason r) "BL-700")))
(assert= "a typo id resolving to no ticket anywhere fails CLOSED (approval ruling 2)"
         "depends_on"
         (:gate (promotion-gates-lib/depends-on-refusal "depends_on: [BL-99999]\n" #{"BL-700"})))
(let [r (promotion-gates-lib/depends-on-refusal "depends_on: someday maybe\n" #{"BL-700"})]
  (assert= "an unparseable depends_on fails CLOSED (invariant 2)" "depends_on" (:gate r)))

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

;; BL-957 chain position: after human_approval, before depth - a
;; ticket-property refusal beats a transient global one (ticket's own
;; ordering decision), and the fixed first-failing-gate-wins contract holds.
(assert= "BL-957: human_approval still beats depends_on when both would fire"
         "human_approval"
         (:gate (promotion-gates-lib/evaluate {:content "human_approval: pending\ndepends_on: [BL-620]\n" :held? false
                                                :active-count 0 :max-depth 5 :active-epics {} :done-ids #{}})))
(assert= "BL-957: depends_on beats depth when both would fire"
         "depends_on"
         (:gate (promotion-gates-lib/evaluate {:content "human_approval: approved\ndepends_on: [BL-620]\n" :held? false
                                                :active-count 5 :max-depth 5 :active-epics {} :done-ids #{}})))
(assert-true "BL-957: satisfied dependencies pass straight through the chain"
             (:ok (promotion-gates-lib/evaluate {:content "human_approval: approved\ndepends_on: [BL-700]\n" :held? false
                                                  :active-count 0 :max-depth 5 :active-epics {} :done-ids #{"BL-700"}})))

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

;; ── BL-626: acceptance must resolve to an executable .feature ───────────

(defn- bl626-ticket [acceptance]
  (str "id: BL-6626\nhuman_approval: approved\nepic: solo\n"
       (when acceptance (str "acceptance: " acceptance "\n"))))

(let [root (mk-root)
      feat "specs/features/BL-6626-demo.feature"
      draft (str feat ".draft")]
  (fs/create-dirs (fs/path root "specs" "features"))
  (spit (str (fs/path root draft)) "Feature: draft only\n")
  (let [r (promotion-gates-lib/evaluate
           {:content (bl626-ticket feat) :held? false :root root
            :active-count 0 :max-depth 5 :active-epics {}})]
    (assert-false "BL-626: feature shadowed by draft only is refused" (:ok r))
    (assert= "BL-626: gate name is acceptance" "acceptance" (:gate r))
    (assert-true "BL-626: refusal names the missing feature"
                 (str/includes? (or (:reason r) "") feat))
    (assert-true "BL-626: refusal names the draft"
                 (str/includes? (or (:reason r) "") draft))))

(let [root (mk-root)
      draft "specs/features/BL-6626-parked.feature.draft"]
  (fs/create-dirs (fs/path root "specs" "features"))
  (spit (str (fs/path root draft)) "Feature: parked\n")
  (let [r (promotion-gates-lib/evaluate
           {:content (bl626-ticket draft) :held? false :root root
            :active-count 0 :max-depth 5 :active-epics {}})]
    (assert-false "BL-626: acceptance pointing at a draft is refused" (:ok r))
    (assert-true "BL-626: refusal says the draft is not executable"
                 (boolean (and (str/includes? (or (:reason r) "") "not executable")
                               (str/includes? (or (:reason r) "") draft))))))

(let [root (mk-root)
      feat "specs/features/BL-6626-absent.feature"]
  (fs/create-dirs (fs/path root "specs" "features"))
  (let [r (promotion-gates-lib/evaluate
           {:content (bl626-ticket feat) :held? false :root root
            :active-count 0 :max-depth 5 :active-epics {}})]
    (assert-false "BL-626: missing feature with no draft is refused" (:ok r))
    (assert-true "BL-626: refusal names the missing feature alone"
                 (str/includes? (or (:reason r) "") feat))))

(let [root (mk-root)
      feat "specs/features/BL-6626-ok.feature"]
  (fs/create-dirs (fs/path root "specs" "features"))
  (spit (str (fs/path root feat)) "Feature: ok\n")
  (assert-true "BL-626: resolving acceptance promotes (evaluate allows)"
               (:ok (promotion-gates-lib/evaluate
                     {:content (bl626-ticket feat) :held? false :root root
                      :active-count 0 :max-depth 5 :active-epics {}}))))

(assert-true "BL-626: prose acceptance (no path) is outside the gate"
             (:ok (promotion-gates-lib/evaluate
                   {:content (str (bl626-ticket nil)
                                  "acceptance: |\n  Do the thing manually.\n")
                    :held? false :root (mk-root)
                    :active-count 0 :max-depth 5 :active-epics {}})))

(let [root (mk-root)
      missing "specs/features/BL-6626-dangling.feature"
      sibling "specs/features/BL-6626-other.feature"]
  (fs/create-dirs (fs/path root "specs" "features"))
  (spit (str (fs/path root sibling)) "Feature: decoy\n")
  (let [r (promotion-gates-lib/evaluate
           {:content (bl626-ticket missing) :held? false :root root
            :active-count 0 :max-depth 5 :active-epics {}})]
    (assert-false "BL-626: same-prefix sibling does not rescue a dangling pointer" (:ok r))
    (assert-true "BL-626: refusal still names the missing explicit pointer"
                 (str/includes? (or (:reason r) "") missing))))

(let [root (mk-root)]
  (fs/create-dirs (fs/path root "backlog" "paused"))
  (fs/create-dirs (fs/path root "backlog" "active"))
  (fs/create-dirs (fs/path root "specs" "features"))
  (spit (str (fs/path root "backlog" "paused" "BL-1-a.yaml"))
        "id: BL-1\nhuman_approval: approved\nacceptance: specs/features/BL-1-missing.feature\n")
  (spit (str (fs/path root "backlog" "active" "BL-2-b.yaml"))
        "id: BL-2\nhuman_approval: approved\nacceptance: specs/features/BL-2-missing.feature\n")
  (spit (str (fs/path root "backlog" "paused" "BL-3-ok.yaml"))
        "id: BL-3\nhuman_approval: approved\nacceptance: specs/features/BL-3-ok.feature\n")
  (spit (str (fs/path root "specs" "features" "BL-3-ok.feature")) "Feature: ok\n")
  (let [hits (promotion-gates-lib/acceptance-audit-findings root)
        ids (set (map :id hits))]
    (assert-true "BL-626 audit lists paused dangling" (contains? ids "BL-1"))
    (assert-true "BL-626 audit lists active dangling" (contains? ids "BL-2"))
    (assert-false "BL-626 audit omits resolving ticket" (contains? ids "BL-3"))
    (assert-true "BL-626 audit names the failed path for BL-1"
                 (boolean (some #(and (= "BL-1" (:id %))
                                      (re-find #"BL-1-missing\.feature" (or (:feature-path %) "")))
                                hits)))))

;; ── BL-634: slice size envelope at promotion ─────────────────────────────

(defn- bl634-base []
  "id: BL-6634\nhuman_approval: approved\nepic: solo\n")

(defn- bl634-ticket [& {:keys [insertions band decision mutation-cost]}]
  (str (bl634-base)
       (str "mutation_cost: " (or mutation-cost "medium") "\n")
       (when band (str "slice_size_envelope: " band "\n"))
       (when insertions (str "size_envelope_insertions: " insertions "\n"))
       (when decision (str "size_envelope_decision: " decision "\n"))))

(defn- write-conf! [root body]
  (fs/create-dirs (fs/path root "swarmforge"))
  (spit (str (fs/path root "swarmforge" "swarmforge.conf")) body))

(let [root (mk-root)]
  (write-conf! root "config active_backlog_max_depth 5\n")
  (let [r (promotion-gates-lib/evaluate
           {:content (bl634-ticket :insertions 1929) :held? false :root root
            :active-count 0 :max-depth 5 :active-epics {}})]
    (assert-false "BL-634: BL-590-shaped estimate refused without decision" (:ok r))
    (assert= "BL-634: gate name" "slice_size_envelope" (:gate r))
    (assert-true "BL-634: refusal mentions split-or-justify"
                 (str/includes? (or (:reason r) "") "split-or-justify"))))

(let [root (mk-root)]
  (write-conf! root "config active_backlog_max_depth 5\n")
  (assert-true "BL-634: median-shaped estimate promotes"
               (:ok (promotion-gates-lib/evaluate
                     {:content (bl634-ticket :insertions 65) :held? false :root root
                      :active-count 0 :max-depth 5 :active-epics {}}))))

(let [root (mk-root)]
  (write-conf! root "config active_backlog_max_depth 5\n")
  (let [r (promotion-gates-lib/evaluate
           {:content (bl634-ticket :mutation-cost "high") :held? false :root root
            :active-count 0 :max-depth 5 :active-epics {}})]
    (assert-false "BL-634: high band refused without decision" (:ok r))))

(let [root (mk-root)]
  (write-conf! root "config active_backlog_max_depth 5\n")
  (assert-true "BL-634: high band with decision promotes"
               (:ok (promotion-gates-lib/evaluate
                     {:content (bl634-ticket :mutation-cost "high" :decision "justified")
                      :held? false :root root
                      :active-count 0 :max-depth 5 :active-epics {}}))))

(let [root (mk-root)]
  (write-conf! root (str "config active_backlog_max_depth 5\n"
                         "config slice_size_p90_flag 100\n"))
  (let [r (promotion-gates-lib/evaluate
           {:content (bl634-ticket :insertions 120) :held? false :root root
            :active-count 0 :max-depth 5 :active-epics {}})]
    (assert-false "BL-634: lowered p90 threshold is honored" (:ok r))))

(assert-true "BL-634: QA actual-size recording format"
             (str/includes?
              (slice-size-envelope-gate-lib/format-actual-size-recording 1929 18)
              "actual_insertions: 1929"))

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

;; ── BL-1340: a self-converting draft is admitted, a parked one is not ────
;; Human ruling A: the pin is a required_wiring entry naming a
;; specs/pipeline/steps registration - the ticket saying, in its own charter,
;; that THIS parcel lands the handler that makes the draft executable.

(defn- bl1340-ticket [acceptance & {:keys [pin]}]
  (str "id: BL-6340\nhuman_approval: approved\nepic: solo\n"
       "acceptance: " acceptance "\n"
       (when pin
         (str "required_wiring:\n  - '" pin "'\n"))))

(let [root (mk-root)
      draft "specs/features/BL-6340-self-converting.feature.draft"]
  (fs/create-dirs (fs/path root "specs" "features"))
  (spit (str (fs/path root draft)) "Feature: the slice this ticket builds\n")
  (let [r (promotion-gates-lib/evaluate
           {:content (bl1340-ticket draft :pin "specs/pipeline/steps/index.js::bl6340Steps::registered here")
            :held? false :root root :active-count 0 :max-depth 5 :active-epics {}})]
    (assert-true "BL-1340: a draft the ticket pins itself to converting is admitted" (:ok r))
    (assert= "BL-1340: and carries no acceptance refusal" nil (:gate r))))

(let [root (mk-root)
      draft "specs/features/BL-6340-parked.feature.draft"]
  (fs/create-dirs (fs/path root "specs" "features"))
  (spit (str (fs/path root draft)) "Feature: somebody else's slice\n")
  (let [r (promotion-gates-lib/evaluate
           {:content (bl1340-ticket draft) :held? false :root root
            :active-count 0 :max-depth 5 :active-epics {}})]
    (assert-false "BL-1340: a parked draft with no conversion pinned is still refused" (:ok r))
    (assert= "BL-1340: gate name is acceptance" "acceptance" (:gate r))
    (assert-true "BL-1340: and the refusal says the draft is parked with no conversion pinned"
                 (boolean (and (str/includes? (or (:reason r) "") draft)
                               (str/includes? (or (:reason r) "") "parked")
                               (str/includes? (or (:reason r) "") "no conversion pinned"))))))

;; A required_wiring that pins something else entirely is not a conversion
;; pin - otherwise every ticket with any wiring entry would walk through.
(let [root (mk-root)
      draft "specs/features/BL-6340-unrelated-pin.feature.draft"]
  (fs/create-dirs (fs/path root "specs" "features"))
  (spit (str (fs/path root draft)) "Feature: parked\n")
  (let [r (promotion-gates-lib/evaluate
           {:content (bl1340-ticket draft :pin "swarmforge/scripts/handoff_lib.bb::record-something!::an unrelated anchor")
            :held? false :root root :active-count 0 :max-depth 5 :active-epics {}})]
    (assert-false "BL-1340: an unrelated required_wiring entry is not a conversion pin" (:ok r))
    (assert-true "BL-1340: and it refuses as parked" 
                 (str/includes? (or (:reason r) "") "no conversion pinned"))))

;; The pin does not conjure a file: a draft that is not on disk is still the
;; missing-pointer refusal, never an admitted ghost.
(let [root (mk-root)
      draft "specs/features/BL-6340-absent.feature.draft"]
  (fs/create-dirs (fs/path root "specs" "features"))
  (let [r (promotion-gates-lib/evaluate
           {:content (bl1340-ticket draft :pin "specs/pipeline/steps/index.js::bl6340Steps::registered here")
            :held? false :root root :active-count 0 :max-depth 5 :active-epics {}})]
    (assert-false "BL-1340: a pinned draft that does not exist is still refused" (:ok r))
    (assert-true "BL-1340: and the refusal names the missing draft"
                 (str/includes? (or (:reason r) "") draft))))

(if (seq @failures)
  (do
    (doseq [f @failures] (binding [*out* *err*] (println f)))
    (println (str "\n" (count @failures) " failure(s)"))
    (System/exit 1))
  (println "ALL PASS: promotion_gates_lib.bb"))
