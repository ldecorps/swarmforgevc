#!/usr/bin/env bb
;; BL-973: prints the transitive load-file closure of a bb entry point, one
;; filename per line, sorted. The seam shell fixtures use instead of a
;; hand-maintained copy-list:
;;
;;   while read -r f; do cp "$SRC/$f" "$dest/"; done \
;;     < <(bb "$SRC/bb_load_closure_cli.bb" "$SRC" done_with_current_task.bb)
;;
;; Usage: bb_load_closure_cli.bb <scripts-dir> <entry-file.bb>
;;
;; Exits 2 on a missing argument or an entry file that is not on disk - a
;; fixture that silently copied nothing would fail later, deep inside a bb
;; stack trace naming a file no test mentions, which is exactly the failure
;; mode this ticket is closing.

(ns bb-load-closure-cli
  (:require [babashka.fs :as fs]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "bb_load_closure_lib.bb")))

(defn -main [& args]
  (let [[scripts-dir entry-file] args]
    (when (or (nil? scripts-dir) (nil? entry-file))
      (binding [*out* *err*]
        (println "usage: bb_load_closure_cli.bb <scripts-dir> <entry-file.bb>"))
      (System/exit 2))
    (when-not (fs/exists? (fs/path scripts-dir entry-file))
      (binding [*out* *err*]
        (println (str "bb_load_closure_cli: no such entry point: "
                      (str (fs/path scripts-dir entry-file)))))
      (System/exit 2))
    (println (bb-load-closure-lib/format-closure
              (bb-load-closure-lib/compute-closure scripts-dir entry-file)))))

(apply -main *command-line-args*)
