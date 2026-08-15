#!/usr/bin/env bb
;; BL-806 coder pass (BL-654 Invariants): PROPERTY test over
;; review_forward_evidence_gate_lib.bb's `blocked?` encoding the ticket's two
;; declared invariants as one joint property:
;;
;;   invariant 1 - "A forward-direction git_handoff accepted from a review
;;      role (cleaner, architect, hardener, documenter) never names exactly
;;      the commit that role received for the same task, unless the draft
;;      carries a reroute_reason."
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

(def stage-pool required-stages-lib/canonical-order) ; ["coder" cleaner architect hardender documenter "QA"]

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
        [has-task? s6] (gen-bool s5)]
    [{:type type
      :sender sender
      :recipients recipients
      :task-name (if has-task? "BL-T" "")
      :commit commit
      :reroute-reason (if has-reroute? "operator asked for a reroute" nil)
      :received-commit received-commit}
     s6]))

;; ── independent oracle ────────────────────────────────────────────────────

(defn expected-blocked?
  "A fresh statement of the two declared invariants' English text - not a
   copy of blocked?'s own conjunction."
  [{:keys [type sender recipients task-name commit reroute-reason received-commit]}]
  (let [is-review-role? (contains? #{"cleaner" "architect" "hardender" "documenter"} sender)
        is-git-handoff? (= type "git_handoff")
        single-recipient? (= (count recipients) 1)
        moves-forward? (and single-recipient?
                            (required-stages-lib/routes-forward? sender (first recipients)))
        detour-marked? (not (str/blank? reroute-reason))
        has-task? (not (str/blank? task-name))
        has-commit? (not (str/blank? commit))
        names-received-commit? (and has-commit? (= commit received-commit))]
    (boolean (and is-git-handoff? is-review-role? moves-forward? (not detour-marked?)
                  has-task? names-received-commit?))))

;; ── the property ──────────────────────────────────────────────────────────

(check-all "blocked? matches the independently-stated invariant text"
           gen-scenario
           (fn [scenario]
             (let [actual (review-forward-evidence-gate-lib/blocked? scenario)
                   expected (expected-blocked? scenario)]
               (if (= expected actual)
                 true
                 (format "expected %s, got %s" expected actual)))))

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
