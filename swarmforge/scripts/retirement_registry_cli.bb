#!/usr/bin/env bb
;; BL-1258: shell-callable wrapper for retirement_registry_lib.bb - the
;; specifier's own retirement ritual uses `register`, and
;; check_retirement_readdition.sh uses `paths` to query what to refuse.
;;
;; Usage:
;;   retirement_registry_cli.bb <repo-root> register <ticket-id> <path>...
;;       Records ticket-id's retired paths (replacing any prior set for
;;       the same id), readable by every worktree of this repo immediately.
;;   retirement_registry_cli.bb <repo-root> paths
;;       Prints "<path>\t<ticket-id>" for every retired path, one per line -
;;       the shape check_retirement_readdition.sh reads directly.

(require '[babashka.fs :as fs])

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "retirement_registry_lib.bb")))

(defn- usage! []
  (binding [*out* *err*]
    (println "Usage: retirement_registry_cli.bb <repo-root> register <ticket-id> <path>...")
    (println "       retirement_registry_cli.bb <repo-root> paths"))
  (System/exit 1))

(defn -main [& args]
  (let [[repo-root command & rest-args] args]
    (when (or (nil? repo-root) (nil? command)) (usage!))
    (case command
      "register"
      (let [[ticket-id & paths] rest-args]
        (when (or (nil? ticket-id) (empty? paths)) (usage!))
        (retirement-registry-lib/register-retirement! repo-root ticket-id paths)
        (println (str "registered " ticket-id " (" (count paths) " path(s))")))

      "paths"
      (doseq [[ticket-id paths] (retirement-registry-lib/read-registry repo-root)
              path (sort paths)]
        (println (str path "\t" ticket-id)))

      (usage!))))

(apply -main *command-line-args*)
