#!/usr/bin/env bb
;; BL-648 / BL-654: coder-authored PROPERTY tests for the ticket's two
;; declared invariants:
;;
;;   INV1 - No relaunch strands a claimed parcel: if any role holds
;;   in_process work, the resident resumes that role or surfaces the claim
;;   before idling at home.
;;
;;   INV2 - The orphan sweep never touches a claim whose owner is alive or
;;   being resumed - a healthy in-flight parcel is never re-delivered into a
;;   duplicate.
;;
;; The example-based runners (mono_router_lib_test_runner.bb's BL-648-01..06,
;; orphan_claim_lib_test_runner.bb, orphan_claim_sweep_lib_test_runner.bb,
;; test_relaunch_resume_cli.sh's end-to-end runs) check the named cases the
;; ticket and its feature file spell out. This checks the general claims
;; those cases are instances of, over both the pure per-claim decision
;; (orphan-claim-lib/claim-reclaim?) and the composed boot-role + sweep
;; wiring exactly as relaunch_resume_cli.bb's real cmd-sweep/cmd-resolve-
;; boot-role actually drive them.
;;
;; Deterministic by construction: PART A is EXHAUSTIVE (claim-reclaim?'s
;; whole input domain is 3 booleans - 8 rows - so full enumeration is
;; strictly stronger than any sample and needs no seed at all). PART B uses
;; a seeded LCG, never rand, matching expedite_lib_property_runner.bb /
;; operator_lib_bl647_property_runner.bb's own discipline: a property test
;; that flakes is worse than none.
;;
;; NON-VACUITY, made permanent rather than a one-off manual check: every
;; property below also runs against at least one DEFECTIVE variant that a
;; plausible regression would produce, and asserts that variant FAILS the
;; property - so a future change that quietly hollows out either invariant
;; is caught the same run it happens.

(ns bl648-relaunch-resume-property-runner
  (:require [babashka.fs :as fs]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "mono_router_lib.bb")))
(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "orphan_claim_lib.bb")))

(def runs (or (some-> (System/getenv "PROPERTY_RUNS") parse-long) 500))
(def failures (atom []))

(defn- report! [prop input msg]
  (swap! failures conj (str "FAIL " prop "\n  input: " (pr-str input) "\n  " msg)))

;; ══ PART A: claim-reclaim? - exhaustive over its full boolean domain ══════
;;
;; Independent oracle (INV1 + INV2, restated directly from the ticket's own
;; prose, NOT a copy of claim-reclaim?'s `(and has-claim? (not owner-alive?)
;; (not being-resumed?))` boolean expression - a three-way case dispatch
;; instead of a boolean AND, so a mutation to either formulation is caught
;; by comparison rather than both drifting together):
(defn- inv-oracle
  [{:keys [has-claim? owner-alive? being-resumed?]}]
  (cond
    (not has-claim?) :no-claim          ;; nothing to decide
    being-resumed? :left-for-resume     ;; INV1: the resume IS how it finishes
    owner-alive? :left-for-live-owner   ;; INV2: a live owner is never duplicated
    :else :reclaim))                    ;; INV1: nobody left to finish it - surface it

(def all-bool-inputs
  (vec (for [has-claim? [true false]
             owner-alive? [true false]
             being-resumed? [true false]]
         {:has-claim? has-claim? :owner-alive? owner-alive? :being-resumed? being-resumed?})))

;; Pure: every input in all-bool-inputs where impl-fn disagrees with the
;; independent oracle. Side-effect-free so callers decide for themselves
;; whether a mismatch is a real failure (the real impl) or the expected,
;; required outcome (a defective variant's own non-vacuity check).
(defn- oracle-mismatches [impl-fn]
  (vec (keep (fn [input]
               (let [expected-reclaim? (= :reclaim (inv-oracle input))
                     actual (boolean (impl-fn input))]
                 (when (not= expected-reclaim? actual)
                   {:input input :expected expected-reclaim? :actual actual})))
             all-bool-inputs)))

(defn- assert-matches-oracle! [prop-name impl-fn]
  (doseq [{:keys [input expected actual]} (oracle-mismatches impl-fn)]
    (report! prop-name input (str "expected reclaim?=" expected ", got " actual))))

(defn- assert-diverges-from-oracle! [prop-name impl-fn]
  (when (empty? (oracle-mismatches impl-fn))
    (report! prop-name nil "expected at least one oracle mismatch, but the defective variant matched the oracle on every one of the 8 inputs")))

(assert-matches-oracle! "PART A (real impl): claim-reclaim? matches the independent oracle on every one of the 8 possible inputs"
                        orphan-claim-lib/claim-reclaim?)

;; Defective variant 1 (BL-648-01's failure class): ignores being-resumed? -
;; would re-deliver a duplicate of a claim the relaunch is about to resume.
(defn- defective-ignores-being-resumed [{:keys [has-claim? owner-alive?]}]
  (boolean (and has-claim? (not owner-alive?))))

(assert-diverges-from-oracle! "PART A NON-VACUITY (ignores-being-resumed)" defective-ignores-being-resumed)

;; Defective variant 2 (BL-648-05's failure class): ignores owner-alive? -
;; would reclaim a claim whose owner is genuinely still working it.
(defn- defective-ignores-owner-alive [{:keys [has-claim? being-resumed?]}]
  (boolean (and has-claim? (not being-resumed?))))

(assert-diverges-from-oracle! "PART A NON-VACUITY (ignores-owner-alive)" defective-ignores-owner-alive)

;; Defective variant 3: never reclaims anything - the silent-strand bug this
;; whole ticket exists to close (a dead, unresumed claim left invisible
;; forever).
(defn- defective-never-reclaims [_] false)

(assert-diverges-from-oracle! "PART A NON-VACUITY (never-reclaims)" defective-never-reclaims)

(println (str "PART A: exhaustive check over all " (count all-bool-inputs) " claim-reclaim? inputs, "
              "plus 3 defective variants for permanent non-vacuity - "
              (if (zero? (count @failures)) "ALL HOLD" (str (count @failures) " FAILURE(S) SO FAR"))))

;; ══ PART B: the composed wiring - resolve-boot-role + claim-reclaim? ═════
;; exactly as relaunch_resume_cli.bb's real cmd-resolve-boot-role/cmd-sweep
;; drive them: resumed-role is the resolved boot role ONLY under `rotation
;; router` (nil/blank otherwise, so being-resumed? can never match under a
;; non-router pack - BL-648 scenario 06).

(defn- step [s] (mod (+ (* s 1103515245) 12345) 2147483648))
(defn- gen-int [s n] [(mod (quot s 65536) n) (step s)])
(defn- gen-bool [s] (let [[v s'] (gen-int s 2)] [(= 1 v) s']))
(defn- gen-pick [s coll] (let [[i s'] (gen-int s (count coll))] [(nth (vec coll) i) s']))

(defn- check-all [prop gen-fn pred-fn]
  (loop [i 0 s 7]
    (when (< i runs)
      (let [[input s'] (gen-fn s)
            result (pred-fn input)]
        (when-not (true? result)
          (report! prop s (str result)))
        (recur (inc i) s')))))

(def known-roles ["coder" "specifier" "cleaner" "architect" "hardender" "documenter" "QA" "coordinator"])
(def home-role "coder")

(defn- gen-recorded-role
  "Weighted across the four states resolve-boot-role must distinguish:
   missing, blank, a real known role (including home itself sometimes -
   BL-648-01 style), and an unknown/garbled string."
  [s]
  (let [[shape s1] (gen-int s 4)]
    (case shape
      0 [nil s1]
      1 ["   " s1]
      2 (gen-pick s1 known-roles)
      3 ["not-a-real-role" s1])))

(defn- gen-rotation-mode [s]
  (gen-pick s ["router" "router" "router" nil "sequential"]))

(defn- gen-claimed-roles
  "A random non-empty-biased subset of known-roles, each carrying its own
   owner-alive? flag - the set of roles the sweep would find holding
   in_process work this cycle."
  [s]
  (loop [roles known-roles acc [] sx s]
    (if (empty? roles)
      [acc sx]
      (let [[include? s1] (gen-bool sx)
            [alive? s2] (gen-bool s1)]
        (recur (rest roles)
               (if include? (conj acc {:role (first roles) :owner-alive? alive?}) acc)
               s2)))))

(defn- gen-case [s]
  (let [[recorded s1] (gen-recorded-role s)
        [mode s2] (gen-rotation-mode s1)
        [claims s3] (gen-claimed-roles s2)]
    [{:recorded recorded :mode mode :claims claims} s3]))

;; resumed-role exactly as production wires it (relaunch_resume_cli.bb's
;; cmd-sweep argument): the resolved boot role under router, else nil.
(defn- resumed-role-for [{:keys [recorded mode]}]
  (let [boot (mono-router-lib/resolve-boot-role
              {:home-role home-role :recorded-role recorded
               :known-roles known-roles :rotation-mode mode})]
    (when (= mode "router") (:role boot))))

;; Independent oracle for the FULL composed statement (INV1): a claimed
;; role's parcel is left in place iff it is the resumed role or its owner is
;; alive; every other claimed role is reclaimed. Re-derived directly from
;; the ticket's own two invariants, not from claim-reclaim?'s implementation.
(defn- composed-oracle [{:keys [claims] :as input}]
  (let [resumed (resumed-role-for input)]
    (into {}
          (map (fn [{:keys [role owner-alive?]}]
                 [role (if (or (= role resumed) owner-alive?) :left :reclaim)])
               claims))))

(defn- composed-actual [reclaim-fn {:keys [claims] :as input}]
  (let [resumed (resumed-role-for input)]
    (into {}
          (map (fn [{:keys [role owner-alive?]}]
                 [role (if (reclaim-fn {:has-claim? true :owner-alive? owner-alive?
                                         :being-resumed? (= role resumed)})
                         :reclaim :left)])
               claims))))

(defn- composed-pred [reclaim-fn]
  (fn [input]
    (let [expected (composed-oracle input)
          actual (composed-actual reclaim-fn input)]
      (if (= expected actual)
        true
        (str "expected " (pr-str expected) ", got " (pr-str actual))))))

(check-all "PART B (real impl): every claimed role is left iff resumed-or-alive, reclaimed otherwise"
           gen-case (composed-pred orphan-claim-lib/claim-reclaim?))

;; NON-VACUITY: a defective sweep that ignores being-resumed? must diverge
;; from the oracle whenever the resumed role itself actually holds a claim
;; with a dead owner (the exact BL-648-01 shape) - gated so the check is
;; only exercised on inputs where it can possibly fire.
(defn- has-resumed-role-with-dead-claim? [{:keys [claims] :as input}]
  (let [resumed (resumed-role-for input)]
    (boolean (some #(and (= (:role %) resumed) (not (:owner-alive? %))) claims))))

(check-all "PART B NON-VACUITY (ignores-being-resumed): must diverge when the resumed role holds a dead-owner claim"
           gen-case
           (fn [input]
             (if-not (has-resumed-role-with-dead-claim? input)
               true
               (let [r ((composed-pred defective-ignores-being-resumed) input)]
                 (if (true? r) (str "expected a divergence, defective impl matched the oracle for " (pr-str input)) true)))))

;; NON-VACUITY: a defective sweep that ignores owner-alive? must diverge
;; whenever some NON-resumed claimed role has a live owner.
(defn- has-non-resumed-live-claim? [{:keys [claims] :as input}]
  (let [resumed (resumed-role-for input)]
    (boolean (some #(and (not= (:role %) resumed) (:owner-alive? %)) claims))))

(check-all "PART B NON-VACUITY (ignores-owner-alive): must diverge when a non-resumed role has a live owner"
           gen-case
           (fn [input]
             (if-not (has-non-resumed-live-claim? input)
               true
               (let [r ((composed-pred defective-ignores-owner-alive) input)]
                 (if (true? r) (str "expected a divergence, defective impl matched the oracle for " (pr-str input)) true)))))

;; NON-VACUITY: a defective sweep that never reclaims anything must diverge
;; whenever ANY claimed role is neither resumed nor alive-owned (the general
;; "something should have been surfaced" case).
(defn- has-any-reclaimable? [input]
  (boolean (some #(= :reclaim %) (vals (composed-oracle input)))))

(check-all "PART B NON-VACUITY (never-reclaims): must diverge whenever anything should have been surfaced"
           gen-case
           (fn [input]
             (if-not (has-any-reclaimable? input)
               true
               (let [r ((composed-pred defective-never-reclaims) input)]
                 (if (true? r) (str "expected a divergence, defective impl matched the oracle for " (pr-str input)) true)))))

;; ── generator coverage, asserted rather than assumed ─────────────────────
(let [[router-n resumed-claimed-n non-resumed-live-n reclaimable-n unknown-recorded-n known-recorded-n]
      (loop [i 0 s 7 rn 0 rc 0 nl 0 rec 0 unk 0 kn 0]
        (if (= i runs)
          [rn rc nl rec unk kn]
          (let [[input s'] (gen-case s)]
            (recur (inc i) s'
                   (if (= (:mode input) "router") (inc rn) rn)
                   (if (has-resumed-role-with-dead-claim? input) (inc rc) rc)
                   (if (has-non-resumed-live-claim? input) (inc nl) nl)
                   (if (has-any-reclaimable? input) (inc rec) rec)
                   (if (= (:recorded input) "not-a-real-role") (inc unk) unk)
                   (if (contains? (set known-roles) (:recorded input)) (inc kn) kn)))))
      floor (quot runs 20)]
  (println (str "  generator coverage: router-mode=" router-n
                " resumed-role-has-dead-claim=" resumed-claimed-n
                " non-resumed-role-has-live-claim=" non-resumed-live-n
                " something-reclaimable=" reclaimable-n
                " unknown-recorded=" unknown-recorded-n
                " known-recorded=" known-recorded-n " (runs=" runs ")"))
  (doseq [[label n] [["router-mode" router-n] ["resumed-has-dead-claim" resumed-claimed-n]
                     ["non-resumed-has-live-claim" non-resumed-live-n]
                     ["something-reclaimable" reclaimable-n]
                     ["unknown-recorded" unknown-recorded-n] ["known-recorded" known-recorded-n]]]
    (when (< n floor)
      (report! (str "COVERAGE " label) nil
               (str label " is barely exercised (" n "/" runs ") - the generator is skewed")))))

;; ── report ────────────────────────────────────────────────────────────────
(println (str "bl648_relaunch_resume_property_runner: PART A exhaustive (8 inputs) + PART B " runs " runs"))
(if (empty? @failures)
  (println "ALL PROPERTIES HOLD (real impl passes; every defective variant correctly diverges)")
  (do (println (str (count @failures) " PROPERTY FAILURE(S):"))
      (doseq [f (take 20 @failures)] (println f))
      (System/exit 1)))
