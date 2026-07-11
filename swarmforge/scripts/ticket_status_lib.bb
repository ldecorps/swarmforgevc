;; BL-283: reads a single ticket's CURRENT backlog status
;; ("active"/"paused"/"done"), for the Operator's coordinator-handoff
;; status-back sweep - never fabricated, nil when the ticket does not (yet)
;; exist in any backlog folder. Mirrors chase_sweep_lib.bb's own
;; read-yaml-field "field: " line-prefix scan, kept as a standalone
;; single-id lookup (chase_sweep_lib.bb's own readers list a whole
;; directory for dispatch-gap detection, a different shape).
(ns ticket-status-lib
  (:require [babashka.fs :as fs]
            [clojure.string :as str]))

(defn- read-yaml-field [content field]
  (let [prefix (str field ": ")]
    (some (fn [line] (when (str/starts-with? line prefix) (str/trim (subs line (count prefix)))))
          (str/split-lines content))))

(defn- ticket-id-of [yaml-file]
  (read-yaml-field (slurp (str yaml-file)) "id"))

(defn- contains-ticket? [dir ticket-id]
  (and (fs/exists? dir)
       (some (fn [f] (and (str/ends-with? (fs/file-name f) ".yaml") (= (ticket-id-of f) ticket-id)))
             (fs/list-dir dir))))

;; backlog/{active,paused,done}/<id>.yaml is a flat layout (no nested
;; milestone subdirs on disk - that grouping is derived only in
;; backlog.json) so a plain per-folder scan is enough.
(def ^:private status-dirs ["active" "paused" "done"])

(defn current-status
  "The backlog folder a ticket id is CURRENTLY filed under, or nil if it
   isn't found in any of them (not yet created by the coordinator, or an id
   typo) - the Operator must never guess a status for a ticket it cannot
   actually see."
  [target-path ticket-id]
  (some (fn [status] (when (contains-ticket? (fs/path target-path "backlog" status) ticket-id) status))
        status-dirs))
