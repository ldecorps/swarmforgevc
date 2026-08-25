#!/usr/bin/env bb
;; BL-973 / BL-897: bb_load_closure_lib.bb and
;; specs/pipeline/steps/lib/operatorRuntimeBbClosure.js encode the SAME rule -
;; "the transitive load-file closure of a bb entry point" - on opposite sides
;; of a language boundary no import can bridge. Shell fixtures cannot require a
;; Node module and JS fixtures will not shell to bb for every copy, so both
;; implementations have to exist.
;;
;; BL-897's rule: a constant mirrored by hand across such a boundary needs a
;; test asserting both literals agree, because a "kept in sync" comment is not
;; a gate and drift fails silently. This is that test. It runs both walks over
;; the REAL tree, for every entry point a fixture actually drives, and compares
;; the sets - so a fix applied to one side and forgotten on the other fails
;; here by name rather than as a FileNotFoundException in an unrelated feature.

(ns bb-load-closure-agreement-test-runner
  (:require [babashka.fs :as fs]
            [babashka.process :as process]
            [cheshire.core :as json]
            [clojure.string :as str]))

(load-file (str (fs/path (fs/parent (fs/parent (fs/canonicalize *file*))) "bb_load_closure_lib.bb")))

(def repo-root (str (fs/parent (fs/parent (fs/parent (fs/parent (fs/canonicalize *file*)))))))
(def scripts-dir (str (fs/path repo-root "swarmforge" "scripts")))
(def js-helper (str (fs/path repo-root "specs" "pipeline" "steps" "lib" "operatorRuntimeBbClosure.js")))

(def failures (atom []))
(defn fail! [msg] (swap! failures conj (str "FAIL: " msg)))

;; Every entry point a fixture copy-list actually drives. Not a sample: a rule
;; that agrees on three of four boundaries is not a gate.
(def entry-points
  ["pipeline_stage_cli.bb"
   "done_with_current_task.bb"
   "operator_runtime.bb"
   "handoff_lib.bb"])

(defn js-closure [entry]
  (let [expr (str "const {computeClosure} = require(" (json/generate-string js-helper) ");"
                  "process.stdout.write(JSON.stringify([...computeClosure("
                  (json/generate-string scripts-dir) "," (json/generate-string entry) ")].sort()));")
        result (process/sh ["node" "-e" expr])]
    (when-not (zero? (:exit result))
      (fail! (str "the JS closure helper failed for " entry ": " (:err result))))
    (set (json/parse-string (str/trim (:out result))))))

(doseq [entry entry-points]
  (let [from-bb (bb-load-closure-lib/compute-closure scripts-dir entry)
        from-js (js-closure entry)]
    (when (empty? from-js)
      (fail! (str entry ": the JS side returned an empty closure - the comparison would be vacuous")))
    (when (not= from-bb from-js)
      (fail! (str entry ": the two implementations disagree"
                  "\n  only in bb: " (pr-str (sort (remove from-js from-bb)))
                  "\n  only in js: " (pr-str (sort (remove from-bb from-js))))))))

;; The direct-dependency parse agrees too, not only the transitive result - a
;; closure walk can paper over a parser difference by reaching the same set
;; through a different edge.
(doseq [f ["handoff_lib.bb" "operator_runtime.bb" "pipeline_stage_cli.bb"]]
  (let [src (slurp (str (fs/path scripts-dir f)))
        from-bb (vec (sort (bb-load-closure-lib/direct-load-file-deps src)))
        expr (str "const {directLoadFileDeps} = require(" (json/generate-string js-helper) ");"
                  "const fs = require('node:fs');"
                  "process.stdout.write(JSON.stringify(directLoadFileDeps(fs.readFileSync("
                  (json/generate-string (str (fs/path scripts-dir f))) ",'utf8')).sort()));")
        result (process/sh ["node" "-e" expr])
        from-js (vec (json/parse-string (str/trim (:out result))))]
    (when (not= from-bb from-js)
      (fail! (str f ": the two direct-dependency parsers disagree"
                  "\n  bb: " (pr-str from-bb)
                  "\n  js: " (pr-str from-js))))))

;; Non-vacuity, asserted rather than assumed: both parsers must actually FIND
;; edges in a fixture that has them, and agree that a file with none has none.
;; Without this, two parsers that both returned nothing would "agree" forever.
(let [with-edges "(load-file (str (fs/path p \"alpha_lib.bb\")))\n(load-file (str (fs/path p \"beta_lib.bb\")))"
      none "(println \"no load-file forms here\")"]
  (when (not= ["alpha_lib.bb" "beta_lib.bb"]
              (vec (bb-load-closure-lib/direct-load-file-deps with-edges)))
    (fail! "the bb parser does not find the edges in a fixture that plainly has two"))
  (when (seq (bb-load-closure-lib/direct-load-file-deps none))
    (fail! "the bb parser invented an edge in a fixture that has none")))

(if (seq @failures)
  (do (doseq [f @failures] (binding [*out* *err*] (println f)))
      (println (str "\n" (count @failures) " failure(s)"))
      (System/exit 1))
  (println (str "bb_load_closure_agreement_test_runner: ok - "
                (count entry-points) " entry points agree across the bb/JS boundary")))
