#!/usr/bin/env bb
;; hotfix_ledger_update.bb — the ONE mechanical way to write the two durable,
;; non-derivable facts backlog/hotfix-ledger.yaml holds (R2): the commit ->
;; stamp-ticket LINK, and a human certification/waiver DECISION. Never called
;; from operator_runtime.bb's recurrent check — that sweep only ever reads
;; these fields (scenario 06: it must never award certification on its own).
;; A human/operator runs this by hand after the corresponding real-world
;; event (a stamp ticket gets minted; a human clicks Approve/Waive on the
;; ticket's Approvals-topic ask). See docs/how-to/BL-848-certify-an-operator-
;; hotfix.md for the full workflow this is one step of.
;;
;; Usage:
;;   hotfix_ledger_update.bb <project-root> --new <commit> <subject> [<detected-at>]
;;   hotfix_ledger_update.bb <project-root> --link <commit> <ticket-id>
;;   hotfix_ledger_update.bb <project-root> --decide <commit> approved|waived [<decided-at>]
;;
;; <detected-at>/<decided-at> default to today (YYYY-MM-DD) when omitted.

(ns hotfix-ledger-update
  (:require [babashka.fs :as fs]
            [clojure.string :as str]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "hotfix_certification_lib.bb")))
(require '[hotfix-certification-lib :as hc])

(defn- usage! []
  (binding [*out* *err*]
    (println "Usage: hotfix_ledger_update.bb <project-root> --new <commit> <subject> [<detected-at>]")
    (println "       hotfix_ledger_update.bb <project-root> --link <commit> <ticket-id>")
    (println "       hotfix_ledger_update.bb <project-root> --decide <commit> approved|waived [<decided-at>]"))
  (System/exit 1))

(defn- today [] (str (java.time.LocalDate/now)))

(defn- ledger-path [project-root] (fs/path project-root "backlog" "hotfix-ledger.yaml"))

(defn- read-entries [project-root]
  (let [p (ledger-path project-root)]
    (if (fs/exists? p) (hc/parse-ledger (slurp (str p))) [])))

(defn- write-entries! [project-root entries]
  (spit (str (ledger-path project-root)) (hc/render-ledger entries)))

(defn- find-index [entries commit]
  (first (keep-indexed (fn [i e] (when (= (:commit e) commit) i)) entries)))

(defn -main [& args]
  (let [[project-root mode & rest-args] args]
    (when (or (nil? project-root) (nil? mode)) (usage!))
    (case mode
      "--new"
      (let [[commit subject detected-at] rest-args]
        (when (or (nil? commit) (nil? subject)) (usage!))
        (let [entries (read-entries project-root)]
          (if (find-index entries commit)
            (do (binding [*out* *err*] (println "already in the ledger:" commit)) (System/exit 1))
            (do
              (write-entries! project-root
                               (conj entries (hc/new-entry {:commit commit :subject subject
                                                             :detected-at (or detected-at (today))})))
              (println "added" commit)))))

      "--link"
      (let [[commit ticket-id] rest-args]
        (when (or (nil? commit) (nil? ticket-id)) (usage!))
        (let [entries (read-entries project-root)
              idx (find-index entries commit)]
          (if-not idx
            (do (binding [*out* *err*] (println "no ledger entry for commit:" commit)) (System/exit 1))
            (do
              (write-entries! project-root (update entries idx assoc :stamp-ticket ticket-id))
              (println "linked" commit "->" ticket-id)))))

      "--decide"
      (let [[commit decision decided-at] rest-args]
        (when-not (contains? #{"approved" "waived"} decision) (usage!))
        (let [entries (read-entries project-root)
              idx (find-index entries commit)]
          (if-not idx
            (do (binding [*out* *err*] (println "no ledger entry for commit:" commit)) (System/exit 1))
            (do
              (write-entries! project-root
                              (update entries idx assoc
                                      :human-decision decision
                                      :decided-at (or decided-at (today))
                                      :state (if (= decision "approved") "certified" "waived")))
              (println "recorded" decision "for" commit)))))

      (usage!))))

(apply -main *command-line-args*)
