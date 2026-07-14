;; BL-090: multi-swarm foundations, first slice. Shared helpers for reading
;; this swarm's identity (normalized by swarmforge.sh's
;; write_swarm_identity_file into .swarmforge/swarm-identity, not
;; re-parsed from swarmforge.conf here) and a ticket file's `swarm:`
;; assignment field, so any script/role tooling can answer "is this ticket
;; mine?" without re-implementing the parsing. Loaded via load-file, not
;; required on a classpath:
;;   (load-file (str (fs/path (fs/parent *file*) "swarm_identity_lib.bb")))
;; and referred to as swarm-identity-lib/foo.

(ns swarm-identity-lib
  (:require [babashka.fs :as fs]
            [clojure.string :as str]))

(def default-swarm-name "primary")
(def default-swarm-mode "autonomous")

(defn identity-file [project-root]
  (fs/path project-root ".swarmforge" "swarm-identity"))

(defn read-swarm-identity
  "This swarm's identity as a map with string keys matching
   swarmforge.sh's swarm-identity file (swarm_name, swarm_mode,
   swarm_mode_primary). Defaults to the primary/autonomous single-swarm
   identity when the file is absent - every pre-BL-090 swarm."
  [project-root]
  (let [file (identity-file project-root)]
    (if (fs/exists? file)
      (merge
        {"swarm_name" default-swarm-name "swarm_mode" default-swarm-mode}
        (into {}
              (for [line (str/split-lines (slurp (str file)))
                    :when (not (str/blank? line))
                    :let [[k v] (str/split line #"\t" 2)]]
                [k (or v "")])))
      {"swarm_name" default-swarm-name "swarm_mode" default-swarm-mode})))

(defn own-swarm-name [project-root]
  (get (read-swarm-identity project-root) "swarm_name" default-swarm-name))

(defn ticket-swarm-field
  "The ticket YAML file's top-level `swarm:` value, or nil when absent (an
   absent field means the primary swarm, per BL-090's backward-compat
   design - callers should compare against `default-swarm-name`, not nil,
   when deciding ownership)."
  [ticket-file]
  (some (fn [line]
          (when-let [[_ v] (re-matches #"swarm:\s*(.*)" line)]
            (not-empty (str/trim v))))
        (str/split-lines (slurp (str ticket-file)))))

(defn ticket-swarm
  "The swarm a ticket is assigned to: its explicit `swarm:` field, or the
   default primary swarm name when the field is absent."
  [ticket-file]
  (or (ticket-swarm-field ticket-file) default-swarm-name))

(defn belongs-to-own-swarm?
  "True when ticket-file is assigned to THIS swarm (by name)."
  [project-root ticket-file]
  (= (ticket-swarm ticket-file) (own-swarm-name project-root)))
