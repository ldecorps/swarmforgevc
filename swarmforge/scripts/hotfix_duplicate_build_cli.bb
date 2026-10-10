#!/usr/bin/env bb
;; hotfix_duplicate_build_cli.bb — BL-1885: thin CLI over
;; hotfix_duplicate_build_lib.bb's blockers-for-ticket. One line per build
;; found, tab-separated (kind\trole\tcommit\tfile-or-dash), nothing when
;; none. check_hotfix_duplicate_build.sh is the only intended caller.
;;
;; Usage: hotfix_duplicate_build_cli.bb <project-root> <ticket-id>

(ns hotfix-duplicate-build-cli
  (:require [babashka.fs :as fs]))

(def scripts-dir (fs/path (fs/parent (fs/canonicalize *file*))))
(load-file (str (fs/path scripts-dir "hotfix_duplicate_build_lib.bb")))

(defn cli-args []
  (let [raw (vec *command-line-args*)]
    (if (and (seq raw) (clojure.string/ends-with? (first raw) ".bb"))
      (subvec raw 1)
      raw)))

(let [[root ticket-id] (cli-args)]
  (when (or (nil? root) (nil? ticket-id))
    (binding [*out* *err*]
      (println "Usage: hotfix_duplicate_build_cli.bb <project-root> <ticket-id>"))
    (System/exit 2))
  (doseq [{:keys [kind role commit file]} (hotfix-duplicate-build-lib/blockers-for-ticket root ticket-id)]
    (println (str kind "\t" role "\t" commit "\t" (or file "-"))))
  (System/exit 0))
