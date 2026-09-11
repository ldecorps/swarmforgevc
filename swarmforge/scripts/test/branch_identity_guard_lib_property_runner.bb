#!/usr/bin/env bb
;; BL-1515: PROPERTY test over branch_identity_guard_lib.bb's decide,
;; covering the ticket YAML's declared invariant 1 (coder-authored first,
;; per BL-654):
;;
;;   "The guard changes a ref only when the declared local branch is absent
;;    and the checked-out branch's tip contains origin/<declared>'s tip or
;;    no origin/<declared> exists, and then only by `git branch -m <actual>
;;    <declared>` (HEAD's commit is unchanged); every other mismatch -
;;    declared ref present, detached HEAD, any git read error - is a
;;    refusal that leaves every ref, HEAD and the index byte-identical."
;;
;; Invariant 2 ("the guard runs before the inbox is read") quantifies over
;; wiring order/process in ready_for_next.bb, not over this pure decision
;; module - it has no executable encoding here; it is covered instead by
;; the feature's own acceptance scenarios (specs/pipeline/steps/
;; bl1515BranchIdentityGuardSteps.js), which run the real dispatcher and
;; assert nothing reaches in_process/ on a refusal. Stated reason recorded
;; per the Invariants contract, not silently skipped.
;;
;; Seeded (not wall-clock) randomness so failures reproduce: a fixed-seed
;; java.util.Random, never rand/rand-int's unseeded global generator.
;; Follows the established .bb property-runner precedent (see
;; worktree_drift_lib_property_runner.bb).
;;
;;   P1 repair-only-in-the-safe-shape - decide returns :repair only when
;;      declared-ref-exists? is false AND (origin-ref-exists? is false OR
;;      origin-tip-ancestor-of-actual? is true) AND actual is neither the
;;      declared branch nor a detached HEAD AND there was no git-read-error
;;      - the exact safe shape invariant 1 names, never a superset of it.
;;   P2 every-other-shape-refuses-or-matches - whenever the safe-repair
;;      predicate does NOT hold and actual != declared (and no read error,
;;      no detached HEAD - those are refusal facts checked directly), the
;;      result is :refuse, never :ok and never :repair.
;;   P3 refuse-and-ok-carry-no-rename - :ok and :refuse verdicts carry no
;;      :from/:to rename instruction (only :repair can ever cause a ref to
;;      change), so a caller that only ever renames on :repair changes
;;      nothing on any other verdict.
;;
;; BL-654 generator-reach: every one of git-read-error?, detached, matched,
;; declared-ref-exists?, origin-ref-exists? and origin-tip-ancestor-of-
;; actual? is an independent coin flip each run, so every combination -
;; including the narrow safe-repair corner - is hit many times across 300
;; runs, not just whichever shape a narrow draw happens to produce.

(ns branch-identity-guard-lib-property-runner
  (:require [babashka.fs :as fs]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "branch_identity_guard_lib.bb")))

(def failures (atom []))

(defn- assert-true [msg expr]
  (when-not expr
    (swap! failures conj (str "FAIL: " msg))))

(def ^:private rng (java.util.Random. 1515))
(defn- rbool [] (.nextBoolean rng))

(def branches-hit (atom #{}))

(dotimes [_ 300]
  (let [git-read-error? (rbool)
        detached? (and (not git-read-error?) (rbool))
        ;; when neither a read error nor detached, decide independently
        ;; whether actual already matches declared (the :ok shape).
        matched? (and (not git-read-error?) (not detached?) (rbool))
        declared-ref-exists? (rbool)
        origin-ref-exists? (rbool)
        origin-tip-ancestor-of-actual? (and origin-ref-exists? (rbool))
        declared "swarmforge-coder"
        actual (cond
                 git-read-error? nil
                 detached? "HEAD"
                 matched? declared
                 :else "side")
        declared-tip (when declared-ref-exists? "declared-tip-sha")
        actual-tip (when-not git-read-error? "actual-tip-sha")
        facts {:declared declared :actual actual
               :declared-ref-exists? declared-ref-exists? :declared-tip declared-tip
               :actual-tip actual-tip :origin-ref-exists? origin-ref-exists?
               :origin-tip-ancestor-of-actual? origin-tip-ancestor-of-actual?
               :git-read-error? git-read-error?}
        verdict (branch-identity-guard-lib/decide facts)
        safe-repair-shape? (and (not git-read-error?)
                                 (not detached?)
                                 (not matched?)
                                 (not declared-ref-exists?)
                                 (or (not origin-ref-exists?) origin-tip-ancestor-of-actual?))]
    (swap! branches-hit conj
           (cond git-read-error? :read-error
                 detached? :detached
                 matched? :matched
                 safe-repair-shape? :safe-repair
                 :else :refuse-other))
    (if safe-repair-shape?
      (assert-true (str "P1: the safe-repair shape always yields :repair (facts=" (pr-str facts) ")")
                   (= :repair (:status verdict)))
      (assert-true (str "P1/P2: outside the safe-repair shape, decide never returns :repair (facts=" (pr-str facts) ")")
                   (not= :repair (:status verdict))))
    (when (= :repair (:status verdict))
      (assert-true "a :repair verdict's :from is the actual checked-out branch"
                   (= actual (:from verdict)))
      (assert-true "a :repair verdict's :to is the declared branch"
                   (= declared (:to verdict))))
    (when (not= :repair (:status verdict))
      (assert-true "a non-:repair verdict carries no :from/:to rename instruction"
                   (and (nil? (:from verdict)) (nil? (:to verdict)))))
    (when git-read-error?
      (assert-true "a git-read error always refuses" (= :refuse (:status verdict))))
    (when (and detached? (not git-read-error?))
      (assert-true "a detached HEAD always refuses" (= :refuse (:status verdict))))
    (when matched?
      (assert-true "a matched branch is always :ok" (= :ok (:status verdict))))))

(assert-true "the generator reached every named branch: read-error, detached, matched, safe-repair, and some other refusal"
             (and (contains? @branches-hit :read-error)
                  (contains? @branches-hit :detached)
                  (contains? @branches-hit :matched)
                  (contains? @branches-hit :safe-repair)
                  (contains? @branches-hit :refuse-other)))

;; ── non-vacuousness: a broken "always repair on any mismatch" implementation
;; must fail P1/P2 - the exact class of bug invariant 1 exists to prevent: a
;; guard that renames on a real conflict (declared ref present at a
;; different tip) instead of refusing, silently destroying the operator's
;; ability to tell which branch was the true one.
(defn- broken-always-repair [{:keys [declared actual]}]
  (if (= actual declared) {:status :ok} {:status :repair :from actual :to declared}))

(let [facts {:declared "swarmforge-coder" :actual "side"
             :declared-ref-exists? true :declared-tip "ccc" :actual-tip "ddd"
             :origin-ref-exists? true :origin-tip-ancestor-of-actual? false
             :git-read-error? false}]
  (assert-true "non-vacuousness: a broken always-repair guard WOULD wrongly rename over a real conflict"
               (= :repair (:status (broken-always-repair facts))))
  (assert-true "non-vacuousness: the REAL decide correctly refuses the same conflict instead"
               (= :refuse (:status (branch-identity-guard-lib/decide facts)))))

(when (seq @failures)
  (binding [*out* *err*]
    (doseq [f @failures] (println f)))
  (println (str "\n" (count @failures) " property failure(s)"))
  (System/exit 1))
(println (str "ALL PROPERTIES HOLD: branch_identity_guard_lib.bb (300 runs)"))
