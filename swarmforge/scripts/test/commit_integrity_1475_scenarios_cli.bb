#!/usr/bin/env bb
;; BL-1475 acceptance test seam: drives the REAL commit_integrity_lib.bb's
;; commit-with-integrity! against a REAL git fixture repo, simulating "a
;; second writer holds .git/index.lock for an injected duration" via the
;; SAME retry-delay-fn! seam commit-with-integrity! already calls for its
;; own backoff - never a real wait, mirrors the existing BL-856 acceptance
;; seam (commit_integrity_856_scenarios_cli.bb) precedent for this same
;; library: inject only the ONE thing needed to reproduce a named scenario
;; deterministically, every other path (add/commit/rev-parse/show/
;; snapshot/restore) is the real git-backed implementation.
;;
;; Usage: commit_integrity_1475_scenarios_cli.bb <project-root>
;;          --message <msg> --path <path>
;;          --scenario <hold-then-release|hold-past-bound|landed-elsewhere>
;;          [--held-seconds <n>]
;;
;; Prints one JSON line: the raw commit-with-integrity! result.

(ns commit-integrity-1475-scenarios-cli
  (:require [babashka.fs :as fs]
            [cheshire.core :as json]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "commit_integrity_lib.bb")))

(def project-root (first *command-line-args*))

(defn parse-args [args]
  (loop [args args opts {:paths []}]
    (if (empty? args)
      opts
      (let [flag (first args)]
        (case flag
          "--message" (recur (drop 2 args) (assoc opts :message (second args)))
          "--path" (recur (drop 2 args) (update opts :paths conj (second args)))
          "--scenario" (recur (drop 2 args) (assoc opts :scenario (second args)))
          "--held-seconds" (recur (drop 2 args) (assoc opts :held-seconds (parse-long (second args))))
          (recur (drop 1 args) opts))))))

(def opts (parse-args (rest *command-line-args*)))

(def LOCK-STDERR "fatal: Unable to create '.git/index.lock': File exists.")

;; Simulated elapsed wait time, advanced only by retry-delay-fn! below -
;; never a real Thread/sleep, so this whole CLI runs near-instantly
;; regardless of how many "seconds" a scenario simulates the lock held for
;; (BL-1390: no real waits).
(def elapsed-ms (atom 0))

(defn held-past? [held-seconds]
  (>= @elapsed-ms (* held-seconds 1000)))

;; No-real-wait backoff: tracks the SAME cumulative delay the real
;; production default would have actually slept for
;; (min(attempt*250,5000)ms), so "held for N seconds" measures against the
;; identical schedule commit_integrity_lib.bb itself uses.
(defn fake-retry-delay! [attempt]
  (swap! elapsed-ms + (min (* attempt 250) 5000)))

(def seams
  (case (:scenario opts)
    "hold-then-release"
    {:commit-fn! (fn [pr message paths]
                   (if (held-past? (:held-seconds opts))
                     (commit-integrity-lib/default-commit! pr message paths)
                     {:exit 1 :err LOCK-STDERR}))
     :retry-delay-fn! fake-retry-delay!}

    "hold-past-bound"
    {:commit-fn! (fn [& _] {:exit 1 :err LOCK-STDERR})
     :retry-delay-fn! fake-retry-delay!}

    "landed-elsewhere"
    (do
      ;; the "other writer": commits the caller's own already-written
      ;; content directly, BEFORE the caller's own (always-losing) attempt.
      (commit-integrity-lib/default-add! project-root (:paths opts))
      (commit-integrity-lib/default-commit! project-root "another writer's commit" (:paths opts))
      {:add-fn! (fn [& _] {:exit 1 :err LOCK-STDERR})
       :commit-fn! (fn [& _] {:exit 1 :err LOCK-STDERR})
       :retry-delay-fn! (fn [_] nil)
       :max-retries 0})

    {}))

(def result
  (commit-integrity-lib/commit-with-integrity!
   (merge {:project-root project-root
           :paths (:paths opts)
           :message (:message opts)}
          seams)))

(println (json/generate-string result))

;; Mirrors the production CLI's own exit-code contract: never exit 0 on a
;; dropped edit. :landed-elsewhere is :success true, so it never reaches here.
(when-not (:success result)
  (System/exit 1))
