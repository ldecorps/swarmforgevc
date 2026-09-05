#!/usr/bin/env bb
;; standing_red_register_cli.bb — BL-1428: the standing-red register's own
;; reader. Thin IO wrapper over standing_red_register_lib.bb's build-report
;; - never a second implementation of the join/ownership decision.
;;
;; Usage: standing_red_register_cli.bb <project-root>
;;
;; Prints one JSON object: {rows: [{lane, file, ticket, first_seen,
;; age_days, owned}], count, oldest_age_days, unowned: [rows]}.
;;
;; Reads:
;;   swarmforge/scripts/property_suite_standing_allowlist.tsv (BL-1175)
;;   backlog/hardening-debt-ledger.yaml (BL-942)
;;   backlog/standing-reds.tsv (BL-1428, this ticket)
;; Ticket openness: backlog/paused/<id>*.yaml or backlog/active/<id>*.yaml
;; (open); backlog/done/**/<id>*.yaml (closed, nested by milestone - the
;; same reason land_step_lib.bb's own worktree-ticket-sources walks
;; recursively there); neither (absent). Never a second ticket-id
;; extractor: pipeline_stage_lib.bb's own single-match extractor resolves a
;; ledger row's `parcel` (which may carry a slug, e.g.
;; "BL-954-a-bounce-verifies-its-own-revert") to its bare ticket id.

(ns standing-red-register-cli
  (:require [babashka.fs :as fs]
            [cheshire.core :as json]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "pipeline_stage_lib.bb")))
(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "hardening_debt_ledger_lib.bb")))
(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "standing_red_register_lib.bb")))

(defn- usage! []
  (binding [*out* *err*]
    (println "Usage: standing_red_register_cli.bb <project-root>"))
  (System/exit 1))

(defn- slurp-if-exists [path]
  (when (fs/exists? path) (slurp (str path))))

(defn- glob-first [dir pattern]
  (when (fs/exists? dir)
    (first (sort (map str (fs/glob dir pattern))))))

(defn real-ticket-state
  "ticket-id -> :open | :closed | :absent. :open wins over :closed when a
   ticket is (wrongly) filed in both, the same fail-open-toward-blocking
   posture the promotion gates take elsewhere - an ambiguous filing is not
   this reader's call to adjudicate."
  [root ticket-id]
  (cond
    (glob-first (fs/path root "backlog" "paused") (str ticket-id "*.yaml")) :open
    (glob-first (fs/path root "backlog" "active") (str ticket-id "*.yaml")) :open
    ;; backlog/done nests by milestone (backlog/done/M8/BL-....yaml) -
    ;; file-seq walk, the same reason land_step_lib.bb's own
    ;; worktree-ticket-sources does not use a flat glob here either.
    (let [done-dir (fs/path root "backlog" "done")]
      (and (fs/exists? done-dir)
           (some #(and (.isFile %) (re-matches (re-pattern (str "^" ticket-id "(-[^/]*)?\\.yaml$")) (.getName %)))
                 (file-seq (fs/file done-dir)))))
    :closed
    :else :absent))

(defn- ledger-rows-for-report [root]
  (let [text (slurp-if-exists (fs/path root "backlog" "hardening-debt-ledger.yaml"))]
    (when text
      (->> (hardening-debt-ledger-lib/parse-ledger text)
           hardening-debt-ledger-lib/outstanding-debt
           (mapv (fn [{:keys [parcel file-set detected-at]}]
                   {:ticket (pipeline-stage-lib/extract-ticket-id parcel)
                    :file (clojure.string/join "," file-set)
                    :first-seen detected-at}))))))

(defn -main [& args]
  (let [[project-root] args]
    (when (nil? project-root) (usage!))
    (let [allowlist-text (slurp-if-exists (fs/path project-root "swarmforge" "scripts"
                                                    "property_suite_standing_allowlist.tsv"))
          register-text (slurp-if-exists (fs/path project-root "backlog" "standing-reds.tsv"))
          report (standing-red-register-lib/build-report
                  {:allowlist-rows (standing-red-register-lib/parse-allowlist-rows allowlist-text)
                   :register-rows (standing-red-register-lib/parse-register-rows register-text)
                   :ledger-rows (or (ledger-rows-for-report project-root) [])
                   :ticket-state-fn #(real-ticket-state project-root %)
                   :now (str (java.time.LocalDate/now))})]
      (println (json/generate-string report)))))

(apply -main *command-line-args*)
