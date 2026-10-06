#!/usr/bin/env bb
;; verification_debt_ledger_read.bb — BL-1782's reader: the ledger's own
;; JSON view. Read-only - never mutates backlog/verification-debt-ledger.yaml
;; (that is verification_debt_ledger_update.bb's job alone, invariant 3).
;;
;; Usage: verification_debt_ledger_read.bb <project-root>
;;
;; Prints one JSON object:
;;   {"categories": {"<category>": {"count": n, "threshold": t,
;;                                   "over_threshold": bool,
;;                                   "owned": bool,
;;                                   "owners": ["<ticket-id>", ...],
;;                                   "rows": [{category, ticket, role,
;;                                             description, detected_at,
;;                                             evidence}, ...]}, ...},
;;    "unowned": ["<category>", ...]}
;; "unowned" names every category at/over its threshold with no open
;; ticket (backlog/paused or backlog/active) declaring it via a
;; top-level verification_category: field (invariant 2). "owners" names
;; every open ticket id whose OWN text declares that category - empty
;; when none does, whatever "owned" reads.

(ns verification-debt-ledger-read
  (:require [babashka.fs :as fs]
            [cheshire.core :as json]))

(def scripts-dir (fs/parent (fs/canonicalize *file*)))
(load-file (str (fs/path scripts-dir "verification_debt_ledger_lib.bb")))
(require '[verification-debt-ledger-lib :as vdl])

(defn- usage! []
  (binding [*out* *err*]
    (println "Usage: verification_debt_ledger_read.bb <project-root>"))
  (System/exit 1))

(defn- ledger-path [project-root] (fs/path project-root "backlog" "verification-debt-ledger.yaml"))

(defn- read-rows [project-root]
  (let [p (ledger-path project-root)]
    (if (fs/exists? p) (vdl/parse-ledger (slurp (str p))) [])))

(def ticket-id-pattern #"(BL|GH)-\d+")

(defn- ticket-id-for-path [p]
  (some-> (re-find ticket-id-pattern (str (fs/file-name p))) first))

(defn- ticket-entries [project-root]
  (mapcat (fn [dir]
            (let [d (fs/path project-root "backlog" dir)]
              (when (fs/exists? d)
                (keep (fn [p] (when-let [id (ticket-id-for-path p)] {:id id :text (slurp (str p))}))
                      (fs/list-dir d "*.yaml")))))
          ["paused" "active"]))

(defn- owners-for [entries category]
  (vec (sort (for [{:keys [id text]} entries :when (contains? (vdl/declared-categories text) category)] id))))

(defn- conf-threshold [project-root]
  (let [p (vdl/default-conf-path project-root)]
    (vdl/threshold (vdl/parse-conf (if (fs/exists? p) (slurp p) "")))))

(defn- ->json-row [{:keys [category ticket role description detected-at evidence
                           discharged-at discharged-by discharged-evidence
                           waived-at waived-by waive-reason]}]
  (cond-> {:category category :ticket ticket :role role
           :description description :detected_at detected-at}
    evidence (assoc :evidence evidence)
    discharged-at (assoc :discharged_at discharged-at)
    discharged-by (assoc :discharged_by discharged-by)
    discharged-evidence (assoc :discharged_evidence discharged-evidence)
    waived-at (assoc :waived_at waived-at)
    waived-by (assoc :waived_by waived-by)
    waive-reason (assoc :waive_reason waive-reason)))

(defn -main [& args]
  (let [[project-root] args]
    (when (nil? project-root) (usage!))
    (let [rows (read-rows project-root)
          threshold (conf-threshold project-root)
          entries (ticket-entries project-root)
          categories (vdl/all-categories rows)
          per-category (into {}
                              (map (fn [category]
                                     (let [category-rows (vdl/rows-for-category rows category)
                                           count (vdl/outstanding-count rows category)
                                           over? (>= count threshold)
                                           owners (owners-for entries category)]
                                       [category {:count count :threshold threshold
                                                  :over_threshold over? :owned (boolean (seq owners))
                                                  :owners owners
                                                  :rows (mapv ->json-row category-rows)}])))
                              categories)
          unowned (vec (sort (for [[category {:keys [over_threshold owned]}] per-category
                                    :when (and over_threshold (not owned))]
                                category)))]
      (println (json/generate-string {:categories per-category :unowned unowned})))))

(apply -main *command-line-args*)
