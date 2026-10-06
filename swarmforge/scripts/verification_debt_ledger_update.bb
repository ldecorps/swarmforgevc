#!/usr/bin/env bb
;; verification_debt_ledger_update.bb — BL-1782's recorder: the ONE
;; mechanical way to add a row to backlog/verification-debt-ledger.yaml.
;; A role that checks or classifies something by hand, with no script to
;; decide it, calls this at the fixed path per its own role prompt's
;; "verification-debt ledger" section - never edits the ledger file
;; itself (that stays this CLI's job alone, mirroring
;; hardening_debt_ledger_update.bb's own single-writer convention).
;;
;; Usage:
;;   verification_debt_ledger_update.bb <project-root> --record <category> \
;;     --ticket <id> --role <role> --description "<text>" \
;;     [--evidence <path>] [--on YYYY-MM-DD]
;;
;; Refuses (exit 1, nothing written) a category that is not a kebab-case
;; id, a ticket that is not a BL-/GH- id, or a blank description - naming
;; the offending field. A second record for the same (category, ticket)
;; writes nothing, exits 0, and prints
;; "VERIFICATION_DEBT_ALREADY_RECORDED <category> <ticket>" (invariant 1).
;; On a successful record left with no open-ticket owner (invariant 2) at
;; or over the conf threshold, also prints
;; "VERIFICATION_DEBT_UNOWNED <category> count=<n> threshold=<t>".

(ns verification-debt-ledger-update
  (:require [babashka.fs :as fs]
            [clojure.string :as str]))

(def scripts-dir (fs/parent (fs/canonicalize *file*)))
(load-file (str (fs/path scripts-dir "verification_debt_ledger_lib.bb")))
(load-file (str (fs/path scripts-dir "commit_integrity_lib.bb")))
(require '[verification-debt-ledger-lib :as vdl]
         '[commit-integrity-lib :as cil])

(def ledger-relpath (str (fs/path "backlog" "verification-debt-ledger.yaml")))

(defn- usage! []
  (binding [*out* *err*]
    (println (str "Usage: verification_debt_ledger_update.bb <project-root> --record <category> "
                  "--ticket <id> --role <role> --description \"<text>\" "
                  "[--evidence <path>] [--on YYYY-MM-DD]")))
  (System/exit 1))

(defn- refuse! [field msg]
  (binding [*out* *err*]
    (println (str "verification_debt_ledger_update: refused (" field "): " msg " - nothing written")))
  (System/exit 1))

(defn- today [] (str (java.time.LocalDate/now)))

(defn- ledger-path [project-root] (fs/path project-root ledger-relpath))

(defn- read-rows [project-root]
  (let [p (ledger-path project-root)]
    (if (fs/exists? p) (vdl/parse-ledger (slurp (str p))) [])))

(defn- parse-opts [args]
  (loop [args args opts {}]
    (if (empty? args)
      opts
      (let [[flag value & more] args]
        (case flag
          "--ticket" (recur more (assoc opts :ticket value))
          "--role" (recur more (assoc opts :role value))
          "--description" (recur more (assoc opts :description value))
          "--evidence" (recur more (assoc opts :evidence value))
          "--on" (recur more (assoc opts :detected-at value))
          "--by" (recur more (assoc opts :by value))
          "--reason" (recur more (assoc opts :reason value))
          (recur more opts))))))

(defn- ticket-texts [project-root]
  (mapcat (fn [dir]
            (let [d (fs/path project-root "backlog" dir)]
              (when (fs/exists? d)
                (map slurp (map str (fs/list-dir d "*.yaml"))))))
          ["paused" "active"]))

(defn- owned? [project-root category]
  (some #(contains? (vdl/declared-categories %) category) (ticket-texts project-root)))

(defn- conf-threshold [project-root]
  (let [p (vdl/default-conf-path project-root)]
    (vdl/threshold (vdl/parse-conf (if (fs/exists? p) (slurp p) "")))))

(defn- commit-ledger! [project-root rows message]
  "Write rows to the ledger file and commit. On commit failure, restore the
   file's pre-write state (byte-identical when it existed, absent when it
   did not) and exit 1. Returns nil on success."
  (let [text (vdl/render-ledger rows)
        pre-existed? (fs/exists? (ledger-path project-root))
        pre-text (when pre-existed? (slurp (str (ledger-path project-root))))]
    (fs/create-dirs (fs/parent (ledger-path project-root)))
    (spit (str (ledger-path project-root)) text)
    (let [result (cil/commit-with-integrity!
                  {:project-root project-root
                   :paths [ledger-relpath]
                   :message message})]
      (if-not (:success result)
        (do
          (if pre-existed?
            (spit (str (ledger-path project-root)) pre-text)
            (fs/delete-if-exists (ledger-path project-root)))
          (binding [*out* *err*]
            (println (str "verification_debt_ledger_update: commit failed (" (:reason result) ") - reverted, nothing written")))
          (System/exit 1))
        nil))))

(defn -main [& args]
  (let [[project-root mode category & rest-args] args]
    (when (or (nil? project-root) (nil? category)) (usage!))
    (case mode
      "--record"
      (let [{:keys [ticket role description evidence detected-at]} (parse-opts rest-args)
            detected-at (or detected-at (today))]
        (when-not (vdl/valid-category? category) (refuse! "category" (str "\"" category "\" is not a kebab-case id")))
        (when-not (vdl/valid-ticket? ticket) (refuse! "ticket" (str "\"" ticket "\" is not a BL-/GH- ticket id")))
        (when (str/blank? role) (refuse! "role" "role is required"))
        (when-not (vdl/valid-description? description) (refuse! "description" "description is blank"))
        (let [before (read-rows project-root)
              {:keys [rows recorded?]} (vdl/record-verification
                                         before (cond-> {:category category :ticket ticket :role role
                                                          :description description :detected-at detected-at}
                                                  evidence (assoc :evidence evidence)))]
          (if-not recorded?
            (println (str "VERIFICATION_DEBT_ALREADY_RECORDED " category " " ticket))
            (do
              (commit-ledger! project-root rows
                (str "verification-debt: record a hand-verification row\n\n"
                     "category: " category "\nticket: " ticket "\n\nBy " role "."))
              (let [count (vdl/outstanding-count rows category)
                    threshold (conf-threshold project-root)]
                (println (str "recorded " category " for " ticket))
                (when (and (>= count threshold) (not (owned? project-root category)))
                  (println (str "VERIFICATION_DEBT_UNOWNED " category " count=" count " threshold=" threshold))))))))

      "--discharge"
      (let [{:keys [by evidence detected-at]} (parse-opts rest-args)
            on (or detected-at (today))]
        (when-not (vdl/valid-category? category) (refuse! "category" (str "\"" category "\" is not a kebab-case id")))
        (when (str/blank? by) (refuse! "--by" "--by is required"))
        (when (str/blank? evidence) (refuse! "--evidence" "--evidence is required"))
        (let [ev-path (fs/path project-root evidence)]
          (when-not (fs/regular-file? ev-path) (refuse! "--evidence" (str "evidence file \"" evidence "\" is not a file under the project root"))))
        (let [before (read-rows project-root)
              {:keys [rows settled?]} (vdl/discharge-category before {:category category :by by :evidence evidence :on on})]
          (if settled?
            (do
              (commit-ledger! project-root rows
                (str "verification-debt: discharge category\n\n"
                     "category: " category "\nby: " by "\nevidence: " evidence "\n\nBy " by "."))
              (println (str "discharged " category)))
            (do
              (binding [*out* *err*]
                (println (str "verification_debt_ledger_update: no outstanding row in category " category " - nothing written")))
              (System/exit 1)))))

      "--waive"
      (let [{:keys [by reason detected-at]} (parse-opts rest-args)
            on (or detected-at (today))]
        (when-not (vdl/valid-category? category) (refuse! "category" (str "\"" category "\" is not a kebab-case id")))
        (when (str/blank? by) (refuse! "--by" "--by is required"))
        (when (str/blank? reason) (refuse! "--reason" "--reason is required"))
        (let [before (read-rows project-root)
              {:keys [rows settled?]} (vdl/waive-category before {:category category :by by :reason reason :on on})]
          (if settled?
            (do
              (commit-ledger! project-root rows
                (str "verification-debt: waive category\n\n"
                     "category: " category "\nby: " by "\nreason: " reason "\n\nBy " by "."))
              (println (str "waived " category)))
            (do
              (binding [*out* *err*]
                (println (str "verification_debt_ledger_update: no outstanding row in category " category " - nothing written")))
              (System/exit 1)))))

      (usage!))))

(apply -main *command-line-args*)
