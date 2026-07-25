#!/usr/bin/env bb

;; BL-328: pure staleness decision for "merged code never reaches the
;; running daemons" - a long-lived process (compiled Node OR interpreted
;; Babashka) loads its code once at startup and holds it in memory exactly
;; like Node does; a merge to main never reaches it without an explicit
;; recompile+restart. This file decides ONLY "is this process's own
;; captured build identity behind main's own HEAD" - no filesystem, no
;; git, no process I/O. The real state-gathering (reading each process's
;; own status file, running `git rev-parse main`) and the recompile+
;; restart action live in build_freshness_cli.bb, the coordinator-invoked
;; entry point (mirrors quiet_period_gate_cli.bb/role_lifecycle_cli.bb's
;; own CLI-wrapper shape).

(ns build-freshness-lib
  (:require [clojure.string :as str]))

(defn- blank->nil [s]
  (when-not (str/blank? s) s))

;; A process whose OWN captured sha is unresolvable (build_sha missing,
;; empty, or the compile/stamp step never ran) is never reported as stale -
;; the conservative default this codebase always uses when it genuinely
;; cannot know (never fabricate an answer from a "we don't know" state).
;; Only a REAL mismatch between two REAL shas counts.
(defn stale? [running-sha main-sha]
  (let [running (blank->nil running-sha)
        main (blank->nil main-sha)]
    (boolean (and running main (not= running main)))))

(defn freshness-entry
  "One process's freshness report: {:name :running_sha :main_sha :stale}."
  [{:keys [name running-sha]} main-sha]
  {:name name
   :running_sha (blank->nil running-sha)
   :main_sha (blank->nil main-sha)
   :stale (stale? running-sha main-sha)})

(defn freshness-report
  "Given every tracked process's {:name :running-sha} and main's own
   current HEAD sha, the whole swarm's freshness report - one entry per
   process, in the given order."
  [processes main-sha]
  (mapv #(freshness-entry % main-sha) processes))

(defn stale-process-names
  "Just the names of the processes a freshness-report flagged stale - the
   CLI's own sync action iterates exactly this list, never re-deciding
   staleness itself."
  [report]
  (mapv :name (filter :stale report)))
