#!/usr/bin/env bb
;; BL-1497 property encoding (BL-654 invariants) over the REAL
;; commit_integrity_lib.bb - reap-decision (the pure invariant-1 predicate
;; acquire-lock! itself calls) and reap-stale-lock! (the invariant-2
;; re-verify-before-delete guard) - never a reimplementation.
;;
;;   P1 (invariant 1): reap-decision is queried directly across generated
;;      (record-shape, alive?, age) combinations - a live owner's record is
;;      NEVER a reap decision whatever the age; a dead owner's record
;;      always is (:dead-owner, naming its pid); a record-less lock is a
;;      decision only once age >= record-less-lock-age-bound-ms
;;      (:record-less-past-bound), never before it.
;;
;;   P2 (invariant 2): reap-stale-lock! re-verifies immediately before
;;      deleting. Simulated deterministically (never a real thread race,
;;      which would be flaky): plant a genuinely stale lock, then - before
;;      calling reap-stale-lock! - swap in a fresh, live-owned lock in its
;;      place, the exact interleaving a losing concurrent caller hits when
;;      another caller's create-dir has already won between this caller's
;;      decision and its delete. The loser's delete must never touch that
;;      fresh lock; a lock left genuinely untouched (never overtaken) must
;;      still be reaped.
;;
;; Non-vacuity, checked by hand before landing (see the parcel's own
;; evidence file): P2 fails if reap-stale-lock!'s re-check is removed
;; (unconditional delete-tree) - the overtaken case then deletes the fresh
;; live lock out from under its holder.

(ns bl1497-lock-reap-property-runner
  (:require [babashka.fs :as fs]
            [babashka.process :as process]
            [cheshire.core :as json]
            [clojure.string :as str]))

(def SCRIPT-DIR (str (fs/parent (fs/canonicalize *file*))))
(load-file (str (fs/path SCRIPT-DIR ".." "commit_integrity_lib.bb")))

(def failures (atom []))
(defn- report-fail [prop n input msg]
  (swap! failures conj (str "FAIL " prop " case " n "\n  input: " (pr-str input) "\n  " msg)))

(def ^:private rng (java.util.Random. 1497))
(defn- rint [bound] (.nextInt rng (int bound)))
(defn- rbool [] (.nextBoolean rng))
(defn- rpid [] (inc (rint 100000)))

;; A guaranteed-DEAD pid: a real subprocess's own pid, read from its own
;; output after process/sh has already waited for it to exit. A random
;; integer is NOT safe here - PIDs recycle quickly under Linux, and this
;; property forks many subprocesses of its own (P2's real pid-alive? calls
;; below), so a random "dead" pid can coincidentally collide with a
;; currently-live process and silently turn a P2 case vacuous (observed:
;; ~50% false "not reaped" failures before this fix).
(defn- dead-pid! []
  (Integer/parseInt (str/trim (:out (process/sh "sh" "-c" "echo $$")))))

;; This process's own pid - always alive - stands in for "a concurrent
;; winner's fresh, live lock" in P2 without needing a second real process.
(def SELF-PID (.pid (java.lang.ProcessHandle/current)))

;; ── P1: invariant 1 - reap-decision's pure contract ─────────────────────
(def P1-RUNS 60)
(dotimes [n P1-RUNS]
  (let [shape (nth [:live :dead :record-less-past :record-less-within] (rint 4))
        age-ms (case shape
                 :record-less-within (rint commit-integrity-lib/record-less-lock-age-bound-ms)
                 :record-less-past (+ commit-integrity-lib/record-less-lock-age-bound-ms
                                       1 (rint 1000000))
                 (rint 10000000)) ; live/dead: the decision must not depend on age at all
        pid (rpid)
        record (when (#{:live :dead} shape) {:pid pid :created_at_ms 0})
        alive? (= shape :live)
        decision (commit-integrity-lib/reap-decision
                  {:record record :age-ms age-ms :alive-fn (fn [_] alive?)})
        input {:shape shape :age-ms age-ms :pid pid}]
    (case shape
      :live
      (when (some? decision)
        (report-fail "P1" n input
                      (str "a live owner's record must never be a reap decision, whatever the age, got "
                           (pr-str decision))))

      :dead
      (when (or (nil? decision) (not= :dead-owner (:reason decision)) (not= pid (:pid decision)))
        (report-fail "P1" n input
                      (str "a dead owner's record must always decide :dead-owner naming its own pid, got "
                           (pr-str decision))))

      :record-less-past
      (when (or (nil? decision) (not= :record-less-past-bound (:reason decision)))
        (report-fail "P1" n input
                      (str "a record-less lock past the age bound must decide :record-less-past-bound, got "
                           (pr-str decision))))

      :record-less-within
      (when (some? decision)
        (report-fail "P1" n input
                      (str "a record-less lock within the age bound must never be a reap decision, got "
                           (pr-str decision)))))))

;; ── P2: invariant 2 - reap-stale-lock! re-verifies before deleting ──────
(def P2-RUNS 24)
(dotimes [n P2-RUNS]
  (let [root (fs/create-temp-dir {:prefix "bl1497-p2-"})
        lock-dir (str (fs/path root "swarmforge-commit-integrity.lock"))
        overtaken? (rbool)]
    (try
      ;; A genuinely stale lock - this caller, reading it, would decide to
      ;; reap it (dead owner).
      (fs/create-dir lock-dir)
      (spit (str (fs/path lock-dir "owner.json"))
            (json/generate-string {:pid (dead-pid!) :created_at_ms (System/currentTimeMillis)}))
      (when overtaken?
        ;; Simulate a concurrent winner: between this caller's decision and
        ;; its delete call, the stale lock was already reaped and
        ;; re-acquired by a live holder (SELF-PID, always alive).
        (fs/delete-tree lock-dir)
        (fs/create-dir lock-dir)
        (spit (str (fs/path lock-dir "owner.json"))
              (json/generate-string {:pid SELF-PID :created_at_ms (System/currentTimeMillis)})))
      ((deref #'commit-integrity-lib/reap-stale-lock!) lock-dir)
      (let [still-exists? (fs/exists? lock-dir)
            record (when still-exists?
                     (json/parse-string (slurp (str (fs/path lock-dir "owner.json"))) true))]
        (if overtaken?
          (when-not (and still-exists? (= SELF-PID (:pid record)))
            (report-fail "P2" n {:overtaken? true}
                          "a loser's reap must never delete a fresh, live-owned lock that overtook its stale decision"))
          (when still-exists?
            (report-fail "P2" n {:overtaken? false}
                          "a genuinely stale lock, never overtaken, must still be reaped"))))
      (finally (when (fs/exists? root) (fs/delete-tree root))))))

;; ── report ───────────────────────────────────────────────────────────────
(if (seq @failures)
  (do
    (doseq [f @failures] (binding [*out* *err*] (println f)))
    (println (str "\n" (count @failures) " failure(s)"))
    (System/exit 1))
  (println (str "ALL PASS: bl1497_lock_reap_property_runner.bb ("
                (+ P1-RUNS P2-RUNS) " cases)")))
