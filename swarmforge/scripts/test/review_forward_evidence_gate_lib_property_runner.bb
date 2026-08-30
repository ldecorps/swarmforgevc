#!/usr/bin/env bb
;; BL-806 coder pass (BL-654 Invariants): PROPERTY test over
;; review_forward_evidence_gate_lib.bb's `blocked?` encoding the ticket's two
;; declared invariants as one joint property:
;;
;;   invariant 1 - "A forward-direction git_handoff accepted from a review
;;      role (cleaner, architect, hardener, documenter) never names exactly
;;      the commit that role received for the same task, unless the draft
;;      carries a reroute_reason."
;;   BL-1293 invariant - "A review role's forward carries content that role
;;      itself authored - its committed evidence file or its fix. A commit
;;      that introduces nothing of its own over its parents is never a pass,
;;      whatever its shape or subject."
;;   invariant 2 - "The gate's refusal surface is exactly review-role
;;      forward-direction git_handoffs: bounces (backward direction), marked
;;      detours (reroute_reason), notes, rule_proposals, and non-review
;;      senders pass through untouched."
;;
;; Same seeded-LCG convention as this directory's other *_property_runner.bb
;; files (deterministic, never rand - a flaky property is worse than none) -
;; see ambulance_lib_property_runner.bb's header for the Babashka-property-
;; tooling-gap note (BL-472) this one shares: no test.check equivalent is
;; wired for .bb scripts, so this is a hand-rolled generator in the actual
;; enforced gate for .bb code (swarmforge/scripts/test/).
;;
;; `expected-blocked?` below is written independently from blocked?'s own
;; implementation (a fresh statement of the invariants' English text, not a
;; copy-paste of the gate's conjunction) so a mutant in the real function's
;; boolean logic has an independent oracle to diverge against - it still
;; legitimately calls required-stages-lib/routes-forward? for direction,
;; since that predicate (not a reimplementation of it) is the ticket's own
;; specified source of truth for "forward".
;;
;; Non-vacuity proven by hand at authoring time: this property failed (many
;; mismatches) when blocked?'s `(review-roles sender)` conjunct was
;; temporarily deleted (a "coder"-sender same-commit forward was then wrongly
;; blocked) and again when `(str/blank? reroute-reason)` was temporarily
;; deleted (a marked-detour same-commit forward was then wrongly blocked).
;; Both were restored to the adopted implementation before this commit.

(ns review-forward-evidence-gate-lib-property-runner
  (:require [babashka.fs :as fs]
            [clojure.string :as str]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "review_forward_evidence_gate_lib.bb")))

(def runs (or (some-> (System/getenv "PROPERTY_RUNS") parse-long) 1000))
(def failures (atom []))

;; ── seeded generator (mirrors this directory's other property runners) ───

(defn- step [s] (mod (+ (* s 1103515245) 12345) 2147483648))
(defn- gen-int [s n] [(mod (quot s 65536) n) (step s)])
(defn- gen-pick [s coll] (let [[i s'] (gen-int s (count coll))] [(nth (vec coll) i) s']))
(defn- gen-bool [s] (let [[i s'] (gen-int s 2)] [(zero? i) s']))

(defn- report! [prop seed input msg]
  (swap! failures conj (str "FAIL " prop "\n  seed:  " seed "\n  input: " (pr-str input) "\n  " msg)))

(defn- check-all [prop gen-fn pred-fn]
  (loop [i 0 s 7]
    (when (< i runs)
      (let [[input s'] (gen-fn s)
            result (pred-fn input)]
        (when-not (true? result)
          (report! prop s input (str result)))
        (recur (inc i) s')))))

;; ── the input space ───────────────────────────────────────────────────────

(def sender-pool
  ["cleaner" "architect" "hardender" "documenter" ; review roles
   "coder" "QA" "coordinator" "specifier" "unknown-role"]) ; non-review

(def type-pool ["git_handoff" "note" "rule_proposal" "awake"])

;; BL-950: coordinator joins the recipient pool - QA's approval hop is a
;; QA -> coordinator git_handoff, and a pool without coordinator can never
;; generate it (the property would have stayed green over a space that
;; excludes the one new shape entirely - the generator-reach failure mode
;; coder.prompt's Invariants section names). Reachability is ASSERTED below,
;; never hoped for.
(def stage-pool (conj required-stages-lib/canonical-order "coordinator"))

(defn gen-recipients [s]
  (let [[n s1] (gen-int s 3)]
    (case n
      0 (let [[r s2] (gen-pick s1 stage-pool)] [[r] s2])              ; 1 recipient
      1 (let [[r1 s2] (gen-pick s1 stage-pool)
              [r2 s3] (gen-pick s2 stage-pool)]
          [[r1 r2] s3])                                               ; 2 recipients
      2 [[] s1])))                                                    ; 0 recipients

(defn gen-commit-pair [s]
  ;; :same - commit equals received-commit; :diff - a different commit;
  ;; :absent - no received-commit on file at all (fail-open case).
  (let [[kind s1] (gen-pick s [:same :diff :absent])
        commit "bbbbbbbbbb"]
    (case kind
      :same [{:commit commit :received-commit commit} s1]
      :diff [{:commit commit :received-commit "cccccccccc"} s1]
      :absent [{:commit commit :received-commit nil} s1])))

(defn gen-scenario [s]
  (let [[sender s1] (gen-pick s sender-pool)
        [type s2] (gen-pick s1 type-pool)
        [recipients s3] (gen-recipients s2)
        [{:keys [commit received-commit]} s4] (gen-commit-pair s3)
        [has-reroute? s5] (gen-bool s4)
        [has-task? s6] (gen-bool s5)
        ;; BL-1293: nil is a real value here, not a gap - it is what an
        ;; unreadable commit produces, and it must never block.
        [nothing-own s7] (gen-pick s6 [true false nil])]
    [{:type type
      :sender sender
      :recipients recipients
      :task-name (if has-task? "BL-T" "")
      :commit commit
      :reroute-reason (if has-reroute? "operator asked for a reroute" nil)
      :received-commit received-commit
      :introduces-nothing-own? nothing-own}
     s7]))

;; ── independent oracle ────────────────────────────────────────────────────

(defn expected-blocked?
  "A fresh statement of the declared invariants' English text - not a
   copy of blocked?'s own conjunction. BL-950 extends BL-806's invariant 1:
   the refused surface is a review role's forward-direction git_handoff OR
   QA's approval git_handoff to the coordinator (invariant 1: 'the gate
   refuses exactly one shape... every other QA send passes untouched');
   invariant 2's fail-open shapes are unchanged (a nil received-commit can
   never equal a non-blank commit)."
  [{:keys [type sender recipients task-name commit reroute-reason received-commit
           introduces-nothing-own?]}]
  (let [is-review-role? (contains? #{"cleaner" "architect" "hardender" "documenter"} sender)
        is-git-handoff? (= type "git_handoff")
        single-recipient? (= (count recipients) 1)
        moves-forward? (and single-recipient?
                            (or (and is-review-role?
                                     (required-stages-lib/routes-forward? sender (first recipients)))
                                (and (= sender "QA") (= (first recipients) "coordinator"))))
        detour-marked? (not (str/blank? reroute-reason))
        has-task? (not (str/blank? task-name))
        has-commit? (not (str/blank? commit))
        names-received-commit? (and has-commit? (= commit received-commit))
        ;; BL-1293, stated fresh: carrying none of the role's own work is
        ;; refused on the same surface, whatever the commit id happens to be.
        ;; Only an explicit true counts - false and nil are "not established".
        carries-nothing-own? (and has-commit? (true? introduces-nothing-own?))]
    (boolean (and is-git-handoff? moves-forward? (not detour-marked?)
                  has-task?
                  (or names-received-commit? carries-nothing-own?)))))

;; ── the property ──────────────────────────────────────────────────────────

(check-all "blocked? matches the independently-stated invariant text"
           gen-scenario
           (fn [scenario]
             (let [actual (review-forward-evidence-gate-lib/blocked? scenario)
                   expected (expected-blocked? scenario)]
               (if (= expected actual)
                 true
                 (format "expected %s, got %s" expected actual)))))

;; ── BL-950: the QA approval hop, BY CONSTRUCTION ──────────────────────────
;; The broad generator above reaches the exact refused shape (git_handoff +
;; QA + [coordinator] + same commit + no reroute + task present) at roughly
;; 1-in-9000 per run - measured at authoring time: a gate with the QA-hop
;; disjunct deleted still passed 1000 broad runs, because the fixed seed
;; never landed the full conjunction (coder.prompt's own named failure
;; shape: a deep state technically reachable but astronomically rare). So
;; the new hop gets its own by-construction pass: sender/recipient/type are
;; FIXED to the hop and only the discriminating fields (commit kind,
;; reroute, task) vary - every generated case is a hop candidate by
;; construction, and both the refused shape and each exclusion are asserted
;; reached, never hoped for.
(def qa-hop-refused-shapes-reached (atom 0))
(def qa-hop-excluded-shapes-reached (atom 0))

(defn gen-qa-hop-scenario [s]
  (let [[{:keys [commit received-commit]} s1] (gen-commit-pair s)
        [has-reroute? s2] (gen-bool s1)
        [has-task? s3] (gen-bool s2)]
    [{:type "git_handoff"
      :sender "QA"
      :recipients ["coordinator"]
      :task-name (if has-task? "BL-T" "")
      :commit commit
      :reroute-reason (if has-reroute? "operator asked for a reroute" nil)
      :received-commit received-commit}
     s3]))

(check-all "BL-950: the QA approval hop matches the invariant text, by construction"
           gen-qa-hop-scenario
           (fn [scenario]
             (let [expected (expected-blocked? scenario)]
               (if expected
                 (swap! qa-hop-refused-shapes-reached inc)
                 (swap! qa-hop-excluded-shapes-reached inc))
               (let [actual (review-forward-evidence-gate-lib/blocked? scenario)]
                 (if (= expected actual)
                   true
                   (format "expected %s, got %s" expected actual))))))

(when (zero? @qa-hop-refused-shapes-reached)
  (swap! failures conj "FAIL BL-950 reachability: the by-construction generator never produced the REFUSED shape (same commit, no reroute, task present)"))
(when (zero? @qa-hop-excluded-shapes-reached)
  (swap! failures conj "FAIL BL-950 reachability: the by-construction generator never produced an EXCLUDED shape"))

;; ── BL-1293: the empty-merge shape, BY CONSTRUCTION ──────────────────────
;; The broad generator reaches "review role + forward + single recipient +
;; task + no reroute + nothing-own" only when six independent draws line up,
;; which is the same astronomically-rare deep state BL-950's note above
;; records. So the new shape gets its own generator with sender, recipient
;; and type FIXED to the gated hop: every case is a candidate by
;; construction, and the commit id is deliberately DIFFERENT from the
;; received one in the discriminating rows - an empty merge that also
;; happened to name the received hash would be caught by BL-806's old
;; identity check and prove nothing about this one.

(def nothing-own-refused-reached (atom 0))
(def nothing-own-allowed-reached (atom 0))

(defn gen-nothing-own-scenario [s]
  (let [[nothing-own s1] (gen-pick s [true false nil])
        [has-reroute? s2] (gen-bool s1)
        [has-task? s3] (gen-bool s2)]
    [{:type "git_handoff"
      :sender "architect"
      :recipients ["hardender"]
      :task-name (if has-task? "BL-T" "")
      ;; a DESCENDANT id, never the received one: identity can never explain
      ;; a refusal here, so only the contribution fact can.
      :commit "cccccccccc"
      :reroute-reason (if has-reroute? "operator asked for a reroute" nil)
      :received-commit "bbbbbbbbbb"
      :introduces-nothing-own? nothing-own}
     s3]))

(check-all "BL-1293: a forward carrying none of the role's own work matches the invariant text, by construction"
           gen-nothing-own-scenario
           (fn [scenario]
             (let [expected (expected-blocked? scenario)]
               (if expected
                 (swap! nothing-own-refused-reached inc)
                 (swap! nothing-own-allowed-reached inc))
               (let [actual (review-forward-evidence-gate-lib/blocked? scenario)]
                 (if (= expected actual)
                   true
                   (format "expected %s, got %s" expected actual))))))

(when (zero? @nothing-own-refused-reached)
  (swap! failures conj "FAIL BL-1293 reachability: the by-construction generator never produced the REFUSED shape (nothing-own true, no reroute, task present)"))
(when (zero? @nothing-own-allowed-reached)
  (swap! failures conj "FAIL BL-1293 reachability: the by-construction generator never produced an ALLOWED shape (nothing-own false/nil, or an exclusion)"))

;; The fail-open half stated on its own: an unreadable commit (nil) is not a
;; refusal. A gate that treated nil as "nothing own" would strand every send
;; whose commit git cannot read.
(let [unreadable {:type "git_handoff" :sender "architect" :recipients ["hardender"]
                  :task-name "BL-T" :commit "cccccccccc" :reroute-reason nil
                  :received-commit "bbbbbbbbbb" :introduces-nothing-own? nil}]
  (when (review-forward-evidence-gate-lib/blocked? unreadable)
    (swap! failures conj "FAIL BL-1293: an unknown contribution (nil) blocked the send - the gate must fail open")))

;; ── BL-1293 non-vacuity: the pre-fix identity-only gate fails this property ──
;; This is BL-806's exact decision, kept here as a live mutant: if the real
;; gate ever regresses to comparing ids alone, the assertion below goes red
;; rather than the suite quietly staying green.

(defn identity-only-blocked?
  [{:keys [type sender recipients task-name commit reroute-reason received-commit]}]
  (boolean (and (= type "git_handoff")
                (contains? #{"cleaner" "architect" "hardender" "documenter"} sender)
                (= (count recipients) 1)
                (required-stages-lib/routes-forward? sender (first recipients))
                (str/blank? reroute-reason)
                (not (str/blank? task-name))
                (not (str/blank? commit))
                (= commit received-commit))))

(let [empty-merge {:type "git_handoff" :sender "architect" :recipients ["hardender"]
                   :task-name "BL-T" :commit "cccccccccc" :reroute-reason nil
                   :received-commit "bbbbbbbbbb" :introduces-nothing-own? true}]
  (when (identity-only-blocked? empty-merge)
    (swap! failures conj "FAIL BL-1293 non-vacuity setup: identity-only was expected to MISS the empty merge"))
  (when-not (review-forward-evidence-gate-lib/blocked? empty-merge)
    (swap! failures conj "FAIL BL-1293: the real gate let an empty merge through"))
  (when (= (identity-only-blocked? empty-merge) (review-forward-evidence-gate-lib/blocked? empty-merge))
    (swap! failures conj "FAIL BL-1293 non-vacuity: identity-only and the real gate agree on the empty merge - the property would not have caught the pre-fix mutant")))

;; ── non-vacuity companion: a naive "block every review-role same-commit
;;    send, ignoring reroute_reason" gate would fail this same property ────

(defn naive-ignores-reroute? [{:keys [type sender recipients task-name commit received-commit]}]
  (boolean (and (= type "git_handoff")
                (contains? #{"cleaner" "architect" "hardender" "documenter"} sender)
                (= (count recipients) 1)
                (required-stages-lib/routes-forward? sender (first recipients))
                (not (str/blank? task-name))
                (not (str/blank? commit))
                (= commit received-commit))))

(let [scenario {:type "git_handoff" :sender "architect" :recipients ["hardender"]
                :task-name "BL-T" :commit "bbbbbbbbbb"
                :reroute-reason "operator asked for a reroute"
                :received-commit "bbbbbbbbbb"}]
  (when-not (naive-ignores-reroute? scenario)
    (swap! failures conj "FAIL non-vacuity setup: naive-ignores-reroute? was expected true on this scenario"))
  (when (review-forward-evidence-gate-lib/blocked? scenario)
    (swap! failures conj "FAIL non-vacuity: the real gate wrongly blocked a marked detour"))
  (when (= (naive-ignores-reroute? scenario) (review-forward-evidence-gate-lib/blocked? scenario))
    (swap! failures conj "FAIL non-vacuity: naive and real gate agree on the reroute_reason case - the property would not have caught this mutant")))

(if (seq @failures)
  (do
    (doseq [f @failures] (binding [*out* *err*] (println f)))
    (println (str "\n" (count @failures) " failure(s)"))
    (System/exit 1))
  (println "ALL PASS: review_forward_evidence_gate_lib.bb (property)"))
