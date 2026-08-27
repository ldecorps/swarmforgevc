#!/usr/bin/env bb
;; expedite_announce_lib_test_runner.bb — BL-656 format-milestone pure tests.

(require '[clojure.string :as str])
(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "expedite_announce_lib.bb")))

(def assert= (fn [msg a b]
               (when (not= a b)
                 (throw (ex-info msg {:expected b :actual a})))))

(let [truncated (expedite-announce-lib/truncate-reason-with-evidence
                 (str/join (repeat 100 "x"))
                 "backlog/evidence/foo.md")]
  (assert= "truncated line ends with evidence path"
           true
           (str/ends-with? truncated "backlog/evidence/foo.md"))
  (assert= "truncated line is shorter than raw reason plus path"
           true
           (< (count truncated) 130)))

(assert= "bounce label includes round"
         "🚑 BL-656 architect: SEND BACK #2 — same concern"
         (expedite-announce-lib/format-stage-verdict
          {:ticket "BL-656" :stage "architect" :verdict :bounce :round 2 :reason "same concern"}))

(assert= "refuse names survivors"
         "🚑 BL-656: REFUSE initiation — survivors babysitterd — teardown did not reach a clean slate"
         (expedite-announce-lib/format-initiation-refuse
          {:ticket "BL-656" :survivors ["babysitterd"] :reason "teardown did not reach a clean slate"}))

(println "expedite_announce_lib_test_runner: ok")
