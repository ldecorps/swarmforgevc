#!/usr/bin/env bb
;; BL-973 half 2: thin CLI over suite_inventory_lib.bb. Every decision lives in
;; the lib and is unit-tested there; this resolves the tree, reads the manifest,
;; and renders the verdict.
;;
;; Usage: suite_inventory_cli.bb [test-tree-dir]
;;   Defaults to this script's own directory. Exits 0 when the tree and the
;;   manifest agree, 1 naming every discrepancy, 2 when the manifest is
;;   unreadable.

(ns suite-inventory-cli
  (:require [babashka.fs :as fs]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "suite_inventory_lib.bb")))

(defn -main [& args]
  (let [dir (or (first args) (str (fs/parent (fs/canonicalize *file*))))
        manifest (fs/path dir suite-inventory-lib/manifest-name)]
    (when-not (fs/exists? manifest)
      (binding [*out* *err*]
        (println (str "suite_inventory_cli: no " suite-inventory-lib/manifest-name " in " dir)))
      (System/exit 2))
    (let [discovered (suite-inventory-lib/discover-test-files dir)
          rows (suite-inventory-lib/parse-manifest (slurp (str manifest)))
          problems (suite-inventory-lib/check discovered rows)
          standing (count (filter #(= "standing" (:lane %)) rows))
          excluded (count (filter #(= "excluded" (:lane %)) rows))]
      (if (seq problems)
        (do (binding [*out* *err*]
              (doseq [p problems] (println (str "FAIL: " p))))
            (println (str "\nsuite inventory: " (count problems) " problem(s) over "
                          (count discovered) " test file(s)"))
            (System/exit 1))
        (println (str "suite inventory: ok - " (count discovered) " test file(s), "
                      standing " standing, " excluded " excluded with a dated reason"))))))

(apply -main *command-line-args*)
