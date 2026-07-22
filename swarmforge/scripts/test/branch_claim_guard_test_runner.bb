#!/usr/bin/env bb
;; TDD runner for branch_claim_guard_lib.bb (BL-529) - pure assertions, no git.
(ns branch-claim-guard-test-runner
  (:require [babashka.fs :as fs]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "branch_claim_guard_lib.bb")))

(def failures (atom []))

(defn assert= [msg expected actual]
  (when (not= expected actual)
    (swap! failures conj (str "FAIL: " msg "\n  expected: " (pr-str expected) "\n  actual:   " (pr-str actual)))))

;; ── ticket-prefix ─────────────────────────────────────────────────────────
(assert= "extracts the ticket id from a bare ticket branch"
         "BL-526"
         (branch-claim-guard-lib/ticket-prefix "BL-526"))

(assert= "extracts the ticket id from a ticket branch with a slug"
         "BL-512"
         (branch-claim-guard-lib/ticket-prefix "BL-512-ticket-branch-mismatch-guard"))

(assert= "extracts the ticket id from a claim task name with a slug"
         "BL-529"
         (branch-claim-guard-lib/ticket-prefix "BL-529-ticket-branch-mismatch-guard"))

(assert= "a role-standard legacy branch is not ticket-specific"
         nil
         (branch-claim-guard-lib/ticket-prefix "swarmforge-coder"))

(assert= "main is not ticket-specific"
         nil
         (branch-claim-guard-lib/ticket-prefix "main"))

(assert= "the unified <swarm>/<role> namespace branch is not ticket-specific"
         nil
         (branch-claim-guard-lib/ticket-prefix "primary/coder"))

(assert= "a non-ticket task name is not ticket-specific"
         nil
         (branch-claim-guard-lib/ticket-prefix "demo-task"))

(assert= "a digits-then-letter run is not a ticket prefix (BL-52x)"
         nil
         (branch-claim-guard-lib/ticket-prefix "BL-52x"))

(assert= "nil input yields nil"
         nil
         (branch-claim-guard-lib/ticket-prefix nil))

;; ── guard-decision: pass cases (feature scenario 01) ─────────────────────
(assert= "01: legacy role branch passes for any claim"
         {:action :pass}
         (branch-claim-guard-lib/guard-decision "swarmforge-coder" "BL-529" false))

(assert= "01: main passes for any claim"
         {:action :pass}
         (branch-claim-guard-lib/guard-decision "main" "BL-512" false))

(assert= "01: a ticket branch matching the claim passes"
         {:action :pass}
         (branch-claim-guard-lib/guard-decision "BL-529" "BL-529" false))

(assert= "a claim with no ticket prefix never mismatches"
         {:action :pass}
         (branch-claim-guard-lib/guard-decision "BL-526" "demo-task" false))

(assert= "a nil claim task never mismatches (e.g. a note handoff)"
         {:action :pass}
         (branch-claim-guard-lib/guard-decision "BL-526" nil false))

;; ── guard-decision: mismatch cases (feature scenarios 02/03/04) ──────────
(assert= "02: a clean mismatch auto-corrects"
         {:action :auto-checkout :branch-ticket "BL-526" :claim-ticket "BL-512"}
         (branch-claim-guard-lib/guard-decision "BL-526" "BL-512" false))

(assert= "04: a dirty mismatch refuses and requeues"
         {:action :refuse-requeue :branch-ticket "BL-526" :claim-ticket "BL-512"}
         (branch-claim-guard-lib/guard-decision "BL-526" "BL-512" true))

(assert= "a dirty worktree on a MATCHING ticket branch still passes (dirty only matters on mismatch)"
         {:action :pass}
         (branch-claim-guard-lib/guard-decision "BL-512" "BL-512" true))

(assert= "a dirty worktree on a generic branch still passes"
         {:action :pass}
         (branch-claim-guard-lib/guard-decision "swarmforge-coder" "BL-512" true))

;; ── standard-branch-candidates ────────────────────────────────────────────
(assert= "the unified <swarm>/<role> branch is preferred, legacy swarmforge-<role> is the fallback"
         ["primary/coder" "swarmforge-coder"]
         (branch-claim-guard-lib/standard-branch-candidates "primary" "coder"))

(assert= "candidate derivation follows the swarm name"
         ["alpha/hardender" "swarmforge-hardender"]
         (branch-claim-guard-lib/standard-branch-candidates "alpha" "hardender"))

;; ── report ────────────────────────────────────────────────────────────────
(if (seq @failures)
  (do
    (doseq [f @failures] (binding [*out* *err*] (println f)))
    (println (str "\n" (count @failures) " failure(s)"))
    (System/exit 1))
  (println "ALL PASS: branch_claim_guard_lib.bb"))
