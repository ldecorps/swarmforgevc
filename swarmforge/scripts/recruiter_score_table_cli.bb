#!/usr/bin/env bb
;; recruiter_score_table_cli.bb — BL-1822: renders the morning briefing's
;; Model scout section from the recruiter's score-table.json (BL-1821), so
;; the documenter pastes it verbatim and never invents or re-ranks a
;; number. Thin I/O wrapper over recruiter_score_table_lib.bb's pure
;; decision; reuses briefing_email_lib.bb's own briefing-date-label rather
;; than holding a second copy of the docs/briefings/<date>.md pattern
;; (BL-1811).
;;
;; Usage: recruiter_score_table_cli.bb <project-root> --briefing [--today <YYYY-MM-DD>]
;;   --today  overrides "today" (UTC) for a deterministic fixture run -
;;            real callers (the documenter, by hand) never pass it.

(require '[babashka.fs :as fs]
         '[cheshire.core :as json]
         '[clojure.string :as str])

(def script-dir (fs/parent (fs/canonicalize *file*)))
(load-file (str (fs/path script-dir "recruiter_score_table_lib.bb")))
(load-file (str (fs/path script-dir "briefing_email_lib.bb")))

(defn- opt-value [args k]
  (let [args (vec args)
        idx (.indexOf args k)]
    (when (and (>= idx 0) (< (inc idx) (count args)))
      (nth args (inc idx)))))

(defn- today-utc []
  (str (java.time.LocalDate/now java.time.ZoneOffset/UTC)))

(defn- score-table-path [project-root]
  (fs/path project-root ".swarmforge" "recruiter" "score-table.json"))

(defn- briefings-dir [project-root]
  (fs/path project-root "docs" "briefings"))

(defn- read-table [project-root]
  (let [p (score-table-path project-root)]
    (when (fs/exists? p)
      (json/parse-string (slurp (str p))))))

(defn- briefing-filenames [project-root]
  (let [dir (briefings-dir project-root)]
    (if (fs/exists? dir)
      (->> (fs/list-dir dir) (map fs/file-name) vec)
      [])))

(defn render-briefing-section [project-root today]
  (let [table (read-table project-root)
        prev (recruiter-score-table-lib/previous-briefing-date
              (briefing-filenames project-root) today
              briefing-email-lib/briefing-date-label)]
    (recruiter-score-table-lib/render-model-scout-section table prev)))

(let [[project-root & flags] *command-line-args*]
  (when (or (str/blank? project-root) (not (some #{"--briefing"} flags)))
    (binding [*out* *err*]
      (println "usage: recruiter_score_table_cli.bb <project-root> --briefing [--today <YYYY-MM-DD>]"))
    (System/exit 2))
  (let [today (or (opt-value flags "--today") (today-utc))]
    (println (render-briefing-section project-root today))))
