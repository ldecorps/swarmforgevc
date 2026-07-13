#!/usr/bin/env bb

;; BL-337: the one shell-callable entry point for standing_rule_violations_
;; lib.bb - gathers real file contents (every constitution article + role
;; prompt), calls the pure scan, and prints a report. Never reimplements
;; the scan/citation logic itself.
;;
;; Usage:
;;   standing_rule_violations_cli.bb <project-root> report
;;     Prints a JSON {:violations [{:file :rule :citations :count}...]
;;     :total_citations N} across every scanned file.
;;   standing_rule_violations_cli.bb <project-root> for-ticket <BL-NNN>
;;     Prints a JSON {:ticket :citing_rules [{:file :rule}...] :count N}
;;     for exactly one ticket id - the direct "how many times was <ticket>
;;     cited as a violation" answer.

(ns standing-rule-violations-cli
  (:require [babashka.fs :as fs]
            [cheshire.core :as json]
            [clojure.string :as str]))

(def script-dir (str (fs/path (fs/parent (fs/canonicalize *file*)))))

(load-file (str (fs/path script-dir "standing_rule_violations_lib.bb")))

(defn usage []
  (binding [*out* *err*]
    (println "Usage: standing_rule_violations_cli.bb <project-root> report | for-ticket <BL-NNN>"))
  (System/exit 2))

;; Every file this project treats as carrying a standing engineering rule:
;; the constitution articles (numbered + the project-wide prompts) and
;; every role prompt (architect.prompt's own co-change-tool citation lives
;; here, not under constitution/articles/). A rule added tomorrow in any
;; of these needs no code change - only a new FILE (a role prompt this
;; project doesn't have yet) would, and that is an explicit, reviewed
;; addition to the swarm's own role roster, not a silent gap.
(defn- rule-source-files [project-root]
  (let [articles-dir (fs/path project-root "swarmforge" "constitution" "articles")
        roles-dir (fs/path project-root "swarmforge" "roles")
        prompt-files (fn [dir] (if (fs/exists? dir)
                                  (filter #(str/ends-with? (fs/file-name %) ".prompt") (fs/list-dir dir))
                                  []))]
    (concat (prompt-files articles-dir) (prompt-files roles-dir))))

(defn- read-files [project-root]
  (vec (for [f (rule-source-files project-root)]
         {:path (str (fs/relativize (fs/path project-root) f)) :content (slurp (str f))})))

(defn- run-report! [project-root]
  (let [violations (standing-rule-violations-lib/scan-violations (read-files project-root))]
    {:violations violations
     :total_citations (standing-rule-violations-lib/total-citation-count violations)}))

(defn- run-for-ticket! [project-root ticket-id]
  (let [violations (standing-rule-violations-lib/scan-violations (read-files project-root))
        citing (standing-rule-violations-lib/citing-rules-for-ticket violations ticket-id)]
    {:ticket ticket-id
     :citing_rules (mapv #(select-keys % [:file :rule]) citing)
     :count (count citing)}))

(defn -main [& args]
  (let [[project-root subcommand ticket-id] args]
    (when (str/blank? project-root) (usage))
    (case subcommand
      "report" (println (json/generate-string (run-report! project-root)))
      "for-ticket" (if (str/blank? ticket-id)
                     (usage)
                     (println (json/generate-string (run-for-ticket! project-root ticket-id))))
      (usage))
    (System/exit 0)))

(apply -main *command-line-args*)
