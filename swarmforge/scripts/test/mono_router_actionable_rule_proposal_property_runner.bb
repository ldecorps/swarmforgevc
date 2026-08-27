#!/usr/bin/env bb
;; BL-795 coder pass (BL-654 Invariants): PROPERTY test over
;; mono_router_lib.bb's actionable-mail?, encoding the ticket's first
;; declared invariant:
;;
;;   "A directed rule_proposal in a role's inbox/new is immediately
;;    actionable for mono-router rotation — the same class as git_handoff —
;;    and never sits forever behind chase-rotate-skip-broadcast."
;;
;; actionable-mail? is a pure function of a counts map; this property drives
;; it over every combination of {in-process-count git-handoff-count
;; rule-proposal-count aged-note-count} the seeded generator can produce
;; (including nil/0/positive per key, and keys entirely absent from the
;; map - the real call sites sometimes omit a key rather than pass 0) and
;; asserts the function's answer always equals the plain boolean OR of
;; "any count present and positive" - i.e. rule-proposal-count is treated
;; as an equal peer of git-handoff-count and in-process-count, never
;; excluded, and its absence never silently counts as actionable (no
;; regression on the pre-fix shape). This generalizes
;; mono_router_lib_test_runner.bb's three fixed examples (in_process alone,
;; git_handoff alone, empty) to every count-map combination.
;;
;; Deterministic by construction: a seeded LCG, never rand (mirrors
;; mono_router_lib_property_runner.bb's own generator shape).
;;
;; Non-vacuity proven by hand at authoring time: ran this property against
;; the pre-fix actionable-mail? (destructuring only :in-process-count
;; :git-handoff-count :aged-note-count, rule-proposal-count unbound) - every
;; run where rule-proposal-count was the ONLY positive count failed (the
;; function returned false, the oracle expected true) - then the file was
;; restored to the adopted fix before this commit.

(ns mono-router-actionable-rule-proposal-property-runner
  (:require [babashka.fs :as fs]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "mono_router_lib.bb")))

(def runs (or (some-> (System/getenv "PROPERTY_RUNS") parse-long) 500))
(def failures (atom []))

;; ── seeded generator (mirrors mono_router_lib_property_runner.bb) ─────────

(defn- step [s] (mod (+ (* s 1103515245) 12345) 2147483648))
(defn- gen-int [s n] [(mod (quot s 65536) n) (step s)])

(defn- report! [prop seed input msg]
  (swap! failures conj (str "FAIL " prop "\n  seed:  " seed "\n  input: " (pr-str input) "\n  " msg)))

;; Each key independently: 0 absent-from-map, 1 present-as-nil, 2 present-as-0,
;; 3 present-as-positive (1..5) - covers every shape a real call site could
;; hand actionable-mail?, not just the "always all four keys, always ints"
;; shape a hand-written example defaults to.
(defn gen-key-value [s]
  (let [[kind s1] (gen-int s 4)]
    (case kind
      0 [:absent s1]
      1 [nil s1]
      2 [0 s1]
      (let [[n s2] (gen-int s1 5)] [(inc n) s2]))))

(defn gen-counts [s]
  (let [[ip s1] (gen-key-value s)
        [gh s2] (gen-key-value s1)
        [rp s3] (gen-key-value s2)
        [an s4] (gen-key-value s3)]
    [(cond-> {}
       (not= ip :absent) (assoc :in-process-count ip)
       (not= gh :absent) (assoc :git-handoff-count gh)
       (not= rp :absent) (assoc :rule-proposal-count rp)
       (not= an :absent) (assoc :aged-note-count an))
     s4]))

(defn- oracle [counts]
  (boolean
   (or (pos? (or (:in-process-count counts) 0))
       (pos? (or (:git-handoff-count counts) 0))
       (pos? (or (:rule-proposal-count counts) 0))
       (pos? (or (:aged-note-count counts) 0)))))

(loop [i 0 s 7]
  (when (< i runs)
    (let [[counts s'] (gen-counts s)
          actual (boolean (mono-router-lib/actionable-mail? counts))
          expected (oracle counts)]
      (when (not= actual expected)
        (report! "P (invariant 1): actionable-mail? == OR of every count key, rule-proposal-count an equal peer" 7 counts
                  (str "expected=" expected " actual=" actual)))
      (recur (inc i) s'))))

;; A rule_proposal-only mailbox (the exact starve scenario) must be
;; actionable regardless of run luck - not left to generator chance.
(let [only-rp (mono-router-lib/actionable-mail? {:in-process-count 0 :git-handoff-count 0
                                                  :rule-proposal-count 1 :aged-note-count 0})]
  (when-not (true? only-rp)
    (report! "P (invariant 1): rule_proposal-only mailbox is actionable (fixed regression pin)" 7 {} (str "got " only-rp))))

;; ── generator coverage, asserted rather than assumed ─────────────────────

(let [rp-only-count (loop [i 0 s 7 n 0]
                       (if (= i runs)
                         n
                         (let [[counts s'] (gen-counts s)]
                           (recur (inc i) s'
                                  (if (and (pos? (or (:rule-proposal-count counts) 0))
                                           (zero? (or (:in-process-count counts) 0))
                                           (zero? (or (:git-handoff-count counts) 0))
                                           (zero? (or (:aged-note-count counts) 0)))
                                    (inc n) n)))))
      floor (max 1 (quot runs 100))]
  (println (str "  generator coverage: rule-proposal-only-actionable=" rp-only-count "/" runs))
  (when (< rp-only-count floor)
    (report! "COVERAGE rule-proposal-only branch" 7 rp-only-count "rule-proposal-only branch barely exercised")))

(println (str "mono_router_lib actionable-mail? rule_proposal property: " runs " runs"))
(if (empty? @failures)
  (println "ALL PROPERTIES HOLD")
  (do (println (str (count @failures) " PROPERTY FAILURE(S):"))
      (doseq [f (take 10 @failures)] (println f))
      (System/exit 1)))
