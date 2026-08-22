#!/usr/bin/env bb
;; aps_equivalence_cli.bb (BL-959) - thin CLI over aps_equivalence_lib.bb.
;;
;;   compare <work-dir>
;;
;; Loads the pinned and candidate result sets from <work-dir>/results/,
;; prints one verdict line per corpus-entry x gate cell
;; (VERDICT|entry|gate[|detail]), writes the same matrix to
;; <work-dir>/matrix.txt and <work-dir>/matrix.md, and exits 0 only for a
;; non-empty all-EQUIVALENT matrix (fail closed - a missing outcome or an
;; empty result set is never equivalence). Safe to re-run alone after a
;; result file is added or removed (qa_e2e step 2).

(require '[babashka.fs :as fs]
         '[clojure.string :as str])

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "aps_equivalence_lib.bb")))

(defn -main [& args]
  (let [[cmd work-dir] args]
    (when (or (not= "compare" cmd) (str/blank? (str work-dir)))
      (binding [*out* *err*]
        (println "usage: aps_equivalence_cli.bb compare <work-dir>"))
      (System/exit 2))
    (let [pinned (aps-equivalence-lib/load-result-set work-dir "pinned")
          candidate (aps-equivalence-lib/load-result-set work-dir "candidate")
          matrix (aps-equivalence-lib/verdict-matrix pinned candidate)]
      (if (empty? matrix)
        (println (str "INCOMPLETE||no results found under " work-dir "/results - nothing compared is never equivalence"))
        (println (aps-equivalence-lib/render-matrix matrix)))
      (doseq [[format render] {"txt" aps-equivalence-lib/render-matrix
                               "md" aps-equivalence-lib/render-markdown}]
        (spit (aps-equivalence-lib/matrix-file-path work-dir format) (str (render matrix) "\n")))
      (System/exit (aps-equivalence-lib/exit-code matrix)))))

(apply -main *command-line-args*)
