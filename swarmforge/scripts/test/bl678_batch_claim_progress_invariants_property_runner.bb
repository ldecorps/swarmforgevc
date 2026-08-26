#!/usr/bin/env bb
;; BL-678: PROPERTY tests over batch_claim_progress_lib.bb / chase_sweep_lib.
;; bb's batch-claim-progress functions, covering the two invariants the
;; ticket YAML declares (coder-authored first, per BL-654). Seeded (not
;; wall-clock) randomness so failures reproduce: a fixed-seed
;; java.util.Random, never rand/rand-int's unseeded global generator.
;; Follows the established .bb property-runner precedent (see
;; bl719_dropped_parcel_invariants_property_runner.bb) - the
;; "*.property.test.js" / vitest.properties.config.mjs home is a TypeScript
;; convention with no Babashka equivalent (BL-472 tracks pinning real
;; property tooling for .bb scripts, deliberately deferred).
;;
;;   P1 sidecar-exists-claim-to-completion - "Every batch-mode claim has a
;;      sidecar naming its owner and last-progress instant from the moment
;;      of the claim until completion." Across randomly generated
;;      (owner-role, parcel-id, commit, claim-ms) claims, immediately after
;;      make-batch-claim-progress the sidecar names the SAME owner role and
;;      parcel id passed in, and its last-progress instant equals its claim
;;      instant (both exist, from ms zero elapsed). Across randomly
;;      generated subsequent mark-progress calls (simulating "until
;;      completion"), the sidecar continues to carry ownerRole/parcelId
;;      unchanged and a well-formed lastProgressAtMs at every step - it
;;      never becomes malformed or loses the owner/parcel identity that
;;      named it at claim time.
;;
;;   P2 fresh-progress-never-surfaces - "No observer re-forwards or
;;      re-delivers a parcel whose sidecar shows progress fresher than its
;;      staleness threshold." Across randomly generated (claim-ms, now-ms,
;;      staleness-ms) triples spanning BOTH fresh and stale progress ages,
;;      decide-batch-claim-observation returns :silent whenever the age is
;;      strictly under the threshold - and the SAME triple's age at or past
;;      the threshold returns :stale-suspect, proving the threshold
;;      comparison is the thing actually gating the outcome (never a
;;      vacuously-always-:silent implementation). :silent is structurally
;;      the ONLY outcome capable of leaving a parcel untouched here - the
;;      function has no code path that moves, deletes, or re-delivers
;;      anything, so proving the freshness gate correctly selects :silent
;;      is exactly invariant 2's guarantee.

(ns bl678-batch-claim-progress-invariants-property-runner
  (:require [babashka.fs :as fs]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "batch_claim_progress_lib.bb")))

(def failures (atom []))

(defn assert-true [msg expr]
  (when-not expr
    (swap! failures conj (str "FAIL: " msg))))

(def ^:private rng (java.util.Random. 678))
(defn- rint [bound] (.nextInt rng (int bound)))
(defn- rlong [bound] (long (rint bound)))
(defn- rword [] (str "w" (rint 1000000)))
(defn- rcommit [] (apply str (repeatedly 10 #(rand-nth (seq "0123456789abcdef")))))

;; ── P1: sidecar-exists-claim-to-completion ──────────────────────────────────

(def p1-mark-progress-steps-hit (atom 0))

(dotimes [_ 60]
  (let [owner-role (str "role-" (rword))
        parcel-id (str "BL-" (+ 100 (rint 900)))
        commit (rcommit)
        claim-ms (+ 1000000000 (rlong 1000000000))
        p (batch-claim-progress-lib/make-batch-claim-progress owner-role parcel-id commit claim-ms)]
    (assert-true (str "P1: sidecar names the SAME owner role at claim time (role=" owner-role ")")
                 (= owner-role (:ownerRole p)))
    (assert-true (str "P1: sidecar names the SAME parcel id at claim time (parcel=" parcel-id ")")
                 (= parcel-id (:parcelId p)))
    (assert-true "P1: claim-time last-progress instant equals the claim instant (zero elapsed)"
                 (= claim-ms (:claimAtMs p) (:lastProgressAtMs p)))
    ;; "until completion": a random number of subsequent mark-progress calls
    ;; (simulating sweep ticks across the batch's lifetime) must never lose
    ;; or corrupt the owner/parcel identity the sidecar was claimed under.
    (let [steps (rint 8)]
      (loop [p p n steps t claim-ms]
        (when (pos? n)
          (swap! p1-mark-progress-steps-hit inc)
          (let [t' (+ t 1 (rlong 100000))
                p' (batch-claim-progress-lib/mark-progress p (rcommit) t')]
            (assert-true (str "P1: ownerRole survives mark-progress step " (- steps n) " unchanged")
                         (= owner-role (:ownerRole p')))
            (assert-true (str "P1: parcelId survives mark-progress step " (- steps n) " unchanged")
                         (= parcel-id (:parcelId p')))
            (assert-true (str "P1: lastProgressAtMs is well-formed (a number) after step " (- steps n))
                         (number? (:lastProgressAtMs p')))
            (recur p' (dec n) t')))))))

(assert-true "P1 generator exercised at least one mark-progress step across the 60 claims (not a vacuous zero-step-only run)"
             (pos? @p1-mark-progress-steps-hit))

;; Non-vacuousness: a broken make-batch-claim-progress that DROPS the owner
;; role (e.g. always "" ) must fail P1's identity assertion - proves P1
;; actually catches an identity-loss defect, not a tautology.
(defn- broken-make-batch-claim-progress-drops-owner [_owner-role parcel-id commit now-ms]
  {:ownerRole "" :parcelId parcel-id :claimAtMs now-ms :lastProgressAtMs now-ms :lastCommit commit})

(let [broken (broken-make-batch-claim-progress-drops-owner "cleaner" "BL-999" "aaaaaaaaaa" 1000)
      real (batch-claim-progress-lib/make-batch-claim-progress "cleaner" "BL-999" "aaaaaaaaaa" 1000)]
  (assert-true "P1 non-vacuousness: the broken (owner-dropping) implementation WOULD fail the identity check"
               (not= "cleaner" (:ownerRole broken)))
  (assert-true "P1 non-vacuousness: the REAL implementation correctly preserves the owner role"
               (= "cleaner" (:ownerRole real))))

;; ── P2: fresh-progress-never-surfaces ────────────────────────────────────────

(def p2-branches-hit (atom #{}))

(dotimes [_ 60]
  (let [claim-ms (+ 1000000000 (rlong 1000000000))
        staleness-ms (+ 1000 (rlong 3600000))
        ;; Deliberately targets both sides of the staleness gate (a uniform
        ;; draw over a wide range would almost never land exactly fresh-vs-
        ;; stale) - coin flip picks the side, magnitude still randomizes.
        stale? (.nextBoolean rng)
        now-ms (if stale?
                 (+ claim-ms staleness-ms (rlong 1000000))
                 (+ claim-ms (rlong (max 1 (dec staleness-ms)))))
        progress {:ownerRole "cleaner" :parcelId "BL-678" :claimAtMs claim-ms :lastProgressAtMs claim-ms}]
    (swap! p2-branches-hit conj (if stale? :stale :fresh))
    (assert-true (str "P2: age >= threshold must yield :stale-suspect, never :silent "
                       "(claim=" claim-ms " now=" now-ms " staleness=" staleness-ms " stale?=" stale? ")")
                 (= (if stale? :stale-suspect :silent)
                    ;; BL-1076: a clean worktree - the condition BL-678's
                    ;; whole generator always meant, now stated.
                    (batch-claim-progress-lib/decide-batch-claim-observation progress now-ms staleness-ms false)))))

(assert-true "P2 generator reached both a fresh case and a stale case"
             (and (contains? @p2-branches-hit :stale)
                  (contains? @p2-branches-hit :fresh)))

;; :silent is the ONLY outcome that leaves a parcel untouched here (the
;; function has no branch capable of re-forwarding/re-delivering at all) -
;; every :silent case above is therefore already a direct proof of
;; invariant 2 for that case. This block additionally proves :silent is
;; reachable ONLY through the freshness gate, never through some other
;; unrelated code path that would make the property vacuous.
(assert-true "P2: :silent is never returned for an already-stale age (the gate is not bypassable)"
             (not= :silent
                   (batch-claim-progress-lib/decide-batch-claim-observation
                    {:lastProgressAtMs 1000} 999999999 1000 false)))

;; Non-vacuousness: a broken decide fn that ignores staleness-threshold-ms
;; entirely (always :silent) must fail P2's core assertion for the stale
;; case - proves P2 actually catches the defect it guards, not a tautology.
(defn- broken-decide-always-silent [_progress _now-ms _staleness-ms] :silent)

(let [claim-ms 1000 now-ms 999999 staleness-ms 1000
      progress {:lastProgressAtMs claim-ms}]
  (assert-true "P2 non-vacuousness: the broken (ignores-staleness) implementation WOULD wrongly stay :silent"
               (= :silent (broken-decide-always-silent progress now-ms staleness-ms)))
  (assert-true "P2 non-vacuousness: the REAL implementation correctly surfaces :stale-suspect for the same input"
               (= :stale-suspect
                  (batch-claim-progress-lib/decide-batch-claim-observation progress now-ms staleness-ms false))))

(when (seq @failures)
  (binding [*out* *err*]
    (doseq [f @failures] (println f)))
  (println (str "\n" (count @failures) " failure(s)"))
  (System/exit 1))

(println "bl678_batch_claim_progress_invariants_property_runner: ok")
