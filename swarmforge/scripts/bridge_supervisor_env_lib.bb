;; Shared env helpers for headless bridge supervisors (cursor + mini app).
;; Loads swarm.env, resolves CURSOR_RIPGREP_PATH, and strips IDE pollution
;; that breaks headless Cursor SDK agents when the supervisor was launched
;; from inside the Cursor integrated terminal.

(ns bridge-supervisor-env-lib
  (:require [babashka.fs :as fs]
            [clojure.string :as str]))

(def ide-env-strip
  #{"CURSOR_AGENT" "CURSOR_CONVERSATION_ID" "CURSOR_LAYOUT" "__CURSOR_SANDBOX_ENV_RESTORE"})

(defn parse-swarm-export-line [line]
  (when-let [[_ k v1 v2 v3] (re-matches #"\s*export\s+([A-Za-z_][A-Za-z0-9_]*)=(?:\"([^\"]*)\"|'([^']*)'|(\S+))\s*(?:#.*)?$" line)]
    [k (or v1 v2 v3)]))

(defn load-swarm-env-file [project-root]
  (let [file (fs/path project-root ".swarmforge" "swarm.env")]
    (if (fs/exists? file)
      (into {}
            (keep (fn [line]
                    (when-let [[k v] (parse-swarm-export-line line)]
                      [k v]))
                  (str/split-lines (slurp (str file)))))
      {})))

(defn resolve-ripgrep-path [project-root]
  (let [sdk-rg (fs/path project-root "extension" "node_modules" "@cursor" "sdk-linux-x64" "bin" "rg")]
    (when (and (fs/exists? sdk-rg) (.canExecute (fs/file sdk-rg)))
      (str sdk-rg))))

(defn inherited-env-map []
  (let [env (System/getenv)]
    (into {}
          (for [k (seq (.keySet env))
                :when (not (contains? ide-env-strip k))]
            [k (.get env k)]))))

(defn bridge-child-env [project-root extra-env]
  (let [swarm (load-swarm-env-file project-root)
        ripgrep (resolve-ripgrep-path project-root)
        merged (merge (inherited-env-map)
                      swarm
                      (when ripgrep {"CURSOR_RIPGREP_PATH" ripgrep})
                      extra-env)]
    (if (contains? merged "CURSOR_BRIDGE_MODEL")
      merged
      (assoc merged "CURSOR_BRIDGE_MODEL" "auto-smart"))))
