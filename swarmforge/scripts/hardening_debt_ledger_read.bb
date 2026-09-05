#!/usr/bin/env bb
;; hardening_debt_ledger_read.bb — the ledger's own reader (BL-942 scenario
;; 04): the outstanding hardening-gate debt, as JSON, without any caller
;; parsing a per-parcel evidence markdown file. Read-only - never mutates
;; backlog/hardening-debt-ledger.yaml (that is hardening_debt_ledger_
;; update.bb's job).
;;
;; Usage:
;;   hardening_debt_ledger_read.bb <project-root> [--parcel <id>]
;;
;; Prints a JSON array of {parcel, gate, file_set, reason, load, detected_at,
;; discharged_at, discharged_evidence} - file_set is a JSON array of
;; strings, never a comma-joined string, so a caller never re-parses the
;; on-disk row shape itself. discharged_at/discharged_evidence are null on
;; a row still outstanding.
;;
;; BL-1439: this prints EVERY row, discharged or not - the ledger's own
;; human-readable full history (qa_e2e_procedure step 2 wants a discharged
;; row's evidence pointer, not its disappearance). outstanding-debt (which
;; DOES drop discharged rows) is what the register CLI reads instead -
;; two different questions, one library, no second parser.

(ns hardening-debt-ledger-read
  (:require [babashka.fs :as fs]
            [cheshire.core :as json]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "hardening_debt_ledger_lib.bb")))
(require '[hardening-debt-ledger-lib :as hdl])

(defn- usage! []
  (binding [*out* *err*]
    (println "Usage: hardening_debt_ledger_read.bb <project-root> [--parcel <id>]"))
  (System/exit 1))

(defn- ledger-path [project-root] (fs/path project-root "backlog" "hardening-debt-ledger.yaml"))

(defn- read-rows [project-root]
  (let [p (ledger-path project-root)]
    (if (fs/exists? p) (hdl/parse-ledger (slurp (str p))) [])))

(defn- ->json-row [{:keys [parcel gate file-set reason load detected-at
                          discharged-at discharged-evidence
                          attempted-at attempted-blocker]}]
  {:parcel parcel :gate gate :file_set file-set :reason reason :load load :detected_at detected-at
   :discharged_at discharged-at :discharged_evidence discharged-evidence
   :attempted_at attempted-at :attempted_blocker attempted-blocker})

(defn -main [& args]
  (let [[project-root & rest-args] args]
    (when (nil? project-root) (usage!))
    (let [[flag parcel] rest-args
          rows (read-rows project-root)
          rows (if (= flag "--parcel")
                 (do (when (nil? parcel) (usage!)) (hdl/rows-for-parcel rows parcel))
                 rows)]
      (println (json/generate-string (mapv ->json-row rows))))))

(apply -main *command-line-args*)
