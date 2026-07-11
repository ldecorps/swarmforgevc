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

;; BUG FIX (found during cleaner review): backlog/active/ and
;; backlog/paused/ are flat, but backlog/done/ is NOT - it holds a mix of
;; flat <id>.yaml files AND older items nested one level under a
;; milestone subdirectory (e.g. backlog/done/M4-.../<id>.yaml). A plain
;; fs/list-dir only sees the milestone subdirectory itself (a dir entry,
;; never ending in ".yaml"), so every ticket nested under one was silently
;; invisible to current-status (confirmed empirically: 127 of done/'s 237
;; tickets live under a milestone subdir, and BL-052 - genuinely done -
;; returned nil before this fix). fs/glob "**.yaml" matches at any depth,
;; covering both the flat and nested layouts uniformly.
(defn- contains-ticket? [dir ticket-id]
  (and (fs/exists? dir)
       (some (fn [f] (= (ticket-id-of f) ticket-id))
             (fs/glob dir "**.yaml"))))

(def ^:private status-dirs ["active" "paused" "done"])

(defn current-status
  "The backlog folder a ticket id is CURRENTLY filed under, or nil if it
   isn't found in any of them (not yet created by the coordinator, or an id
   typo) - the Operator must never guess a status for a ticket it cannot
   actually see."
  [target-path ticket-id]
  (some (fn [status] (when (contains-ticket? (fs/path target-path "backlog" status) ticket-id) status))
        status-dirs))
