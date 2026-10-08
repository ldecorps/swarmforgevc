#!/usr/bin/env bb

;; BL-2065: the one shell-callable entry point for safe_recompile_lib.bb's
;; recompile-extension-from-main! - mirrors build_freshness_cli.bb's own
;; CLI-wrapper-over-lib shape, so an acceptance step handler can drive the
;; real mechanism against a fixture project root without loading
;; front_desk_supervisor.bb itself (which spawns the bridge and bot as a
;; side effect of being loaded with real command-line args).
;;
;; Usage:
;;   safe_recompile_cli.bb <project-root>
;;     Resolves main's current sha in project-root, recompiles its
;;     committed extension/ tree, and swaps it into project-root's
;;     extension/out. Prints "OK <sha>" and exits 0 on success; prints
;;     "ERROR: <message>" to stderr and exits 1 on failure.

(ns safe-recompile-cli
  (:require [babashka.fs :as fs]
            [babashka.process :as process]
            [clojure.string :as str]))

(def script-dir (str (fs/path (fs/parent (fs/canonicalize *file*)))))

(load-file (str (fs/path script-dir "safe_recompile_lib.bb")))

(defn- usage []
  (binding [*out* *err*]
    (println "Usage: safe_recompile_cli.bb <project-root>"))
  (System/exit 2))

(defn- main-sha! [project-root]
  (let [{:keys [exit out err]} (process/sh {:continue true :dir project-root} "git" "rev-parse" "main")]
    (if (zero? exit)
      (str/trim out)
      (throw (ex-info (str "git rev-parse main failed: " err) {})))))

(defn- fail! [message]
  (binding [*out* *err*] (println "ERROR:" message))
  (System/exit 1))

(defn -main [args]
  (let [project-root (first args)]
    (when (str/blank? project-root)
      (usage))
    (let [main-sha (try (main-sha! project-root) (catch Exception e (fail! (ex-message e))))
          err (safe-recompile-lib/recompile-extension-from-main! project-root main-sha)]
      (if err
        (fail! err)
        (do
          (println "OK" main-sha)
          (System/exit 0))))))

(-main *command-line-args*)
