#!/usr/bin/env bb
;; Acceptance runner for BL-848: takes one JSON arg
;;   {"entries": [{"commit":.., "stampTicket":.., "humanDecision":..,
;;                 "stampTicketStatus":.., "stampTicketHumanApproval":..}, ...],
;;    "mainCommits": [{"commit":.., "subject":.., "message":..,
;;                      "functional":bool, "hotfixDeclared":bool,
;;                      "citedTicketDone":bool}, ...],
;;    "nowMs": N, "lastSurfacedMsByCommit": {"<commit>": N, ...},
;;    "resurfaceCooldownMs": N}
;; and prints hotfix_certification_lib/assemble-report's result as JSON - so
;; the Node acceptance step handlers drive the REAL pure decision function,
;; the same Babashka<->JS-via-JSON pattern
;; disk_space_decision_acceptance_runner.bb already established. Never a
;; hand-rolled reimplementation of the decision in JS.
(ns hotfix-certification-acceptance-runner
  (:require [babashka.fs :as fs]
            [cheshire.core :as json]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "hotfix_certification_lib.bb")))
(require '[hotfix-certification-lib :as hc])

(def scenario (json/parse-string (first *command-line-args*) true))

(defn- ->entry [e]
  {:commit (:commit e)
   :stamp-ticket (:stampTicket e)
   :human-decision (:humanDecision e)
   :stamp-ticket-status (:stampTicketStatus e)
   :stamp-ticket-human-approval (:stampTicketHumanApproval e)})

(defn- ->main-commit [c]
  {:commit (:commit c)
   :subject (:subject c)
   :message (:message c)
   :functional? (boolean (:functional c))
   :hotfix-declared? (boolean (:hotfixDeclared c))
   :cited-ticket-done? (boolean (:citedTicketDone c))})

(def entries (mapv ->entry (:entries scenario [])))
(def main-commits (mapv ->main-commit (:mainCommits scenario [])))
(def now-ms (or (:nowMs scenario) 0))
(def last-surfaced (into {} (:lastSurfacedMsByCommit scenario {})))
(def resurface-cooldown-ms (or (:resurfaceCooldownMs scenario) hc/default-resurface-cooldown-ms))

(def report
  (hc/assemble-report {:entries entries :now-ms now-ms
                        :last-surfaced-ms-by-commit last-surfaced
                        :resurface-cooldown-ms resurface-cooldown-ms
                        :main-commits main-commits}))

(defn- ->out-entry [e]
  {:commit (:commit e) :state (:state e) :action (some-> (:action e) name) :open (boolean (:open? e))})

(println
 (json/generate-string
  {:decided (mapv ->out-entry (:decided report))
   :dueForSurfacing (mapv ->out-entry (:due-for-surfacing report))
   :mintRequests (mapv ->out-entry (:mint-requests report))
   :anomalies (mapv ->out-entry (:anomalies report))
   :newLedgerEntries (mapv (fn [e] {:commit (:commit e) :state (:state e)}) (:new-ledger-entries report))
   :unaccounted (mapv (fn [c] {:commit (:commit c)}) (:unaccounted report))
   :unaccountedReportLines (mapv hc/unaccounted-report-line (:unaccounted report))
   :newDedupState (:new-dedup-state report)}))
