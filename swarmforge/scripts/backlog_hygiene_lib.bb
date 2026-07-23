#!/usr/bin/env bb
;; Pure backlog epic/milestone hygiene checks for open tickets.
;; Used by backlog_epic_milestone_audit.bb and specifier_backlog_hygiene_gate.sh.

(ns backlog-hygiene-lib
  (:require [clojure.string :as str]))

(defn field [text name]
  (when-let [[_ v] (re-find (re-pattern (str "(?m)^" name ":\\s*(.*)$")) text)]
    (let [v (-> v str/trim (str/replace #"^\"|\"$" "") (str/replace #"^'|'$" ""))]
      (when-not (str/blank? v) v))))

(defn violations-for-text [text {:keys [id path]}]
  (let [id (or id (field text "id") path)
        typ (or (field text "type") "")
        epic (field text "epic")
        ms (field text "milestone")
        out (atom [])]
    (if (= typ "epic")
      (do
        (when-not epic
          (swap! out conj {:kind :missing-epic-on-epic :id id :path path}))
        (when-not ms
          (swap! out conj {:kind :missing-milestone :id id :path path})))
      (when-not epic
        (swap! out conj {:kind :missing-epic :id id :path path})))
    @out))

(defn violations-for-file [f]
  (let [text (slurp (str f))
        id (or (field text "id") (last (str/split (str f) #"/")))]
    (violations-for-text text {:id id :path (str f)})))

(defn format-violation [{:keys [kind id path]}]
  (case kind
    :missing-epic (str "MISSING-EPIC " id "  " path "  (non-epic ticket needs epic:)")
    :missing-epic-on-epic (str "MISSING-EPIC " id "  " path "  (type: epic must self-declare epic:)")
    :missing-milestone (str "MISSING-MILESTONE " id "  " path "  (type: epic needs milestone:)")
    (str "VIOLATION " id "  " path)))

(defn all-clean? [violations] (empty? violations))
