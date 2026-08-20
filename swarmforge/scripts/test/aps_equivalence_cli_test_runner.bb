#!/usr/bin/env bb
;; CLI-level tests for aps_equivalence_cli.bb (BL-959 hardening pass).
;;
;; aps_equivalence_lib_test_runner.bb covers the PURE half. This file covers
;; the WIRING, which nothing else did: the acceptance step handler
;; (bl959ApsEquivalenceSteps.js) parses the CLI's STDOUT only, and the lib
;; runner tests matrix-file-path as a pure string function - so the CLI's
;; `doseq ... spit` of matrix.txt and matrix.md was exercised by no gate at
;; all. Deleting that write left every suite green while the harness's own
;; markdown deliverable - the thing the evidence report is built from -
;; silently disappeared. Also covers the usage guard, whose non-zero exit no
;; test asserted.
;;
;; Declared invariant 2 ("absence is never read as equivalence") is checked
;; here at the CLI boundary in its most extreme form - an EMPTY work dir,
;; where nothing at all was compared - not just at the lib boundary.

(require '[babashka.fs :as fs]
         '[babashka.process :as p]
         '[clojure.string :as str]
         '[cheshire.core :as json])

(def cli (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "aps_equivalence_cli.bb")))

(def failures (atom []))
(defn assert= [msg expected actual]
  (when (not= expected actual)
    (swap! failures conj (str "FAIL " msg "\n  expected: " (pr-str expected) "\n  actual:   " (pr-str actual)))))
(defn assert-true [msg actual] (assert= msg true (boolean actual)))

(defn run-cli [& args]
  (let [r (apply p/sh "bb" cli args)]
    {:exit (:exit r) :out (str (:out r)) :err (str (:err r))}))

(defn write-outcome! [work side gate entry outcome]
  (let [dir (fs/path work "results" side gate)]
    (fs/create-dirs dir)
    (spit (str (fs/path dir (str (str/replace entry "/" "__") ".json")))
          (json/generate-string {"entry" entry "outcome" outcome}))))

(defn seed-identical! [work]
  (doseq [entry ["specs/features/alpha.feature" "specs/features/beta.feature"]
          gate ["lint-parse" "ir-dry"]
          side ["pinned" "candidate"]]
    (write-outcome! work side gate entry {"exit" 0 "findings" []})))

;; ── usage guard: a non-zero exit no test asserted ─────────────────────────
(doseq [[label args] [["no args" []]
                      ["an unknown command" ["bogus" "/tmp"]]
                      ["a blank work dir" ["compare" ""]]]]
  (let [r (apply run-cli args)]
    (assert= (str "usage guard exits 2 on " label) 2 (:exit r))
    (assert-true (str "usage guard explains itself on " label)
                 (str/includes? (:err r) "usage: aps_equivalence_cli.bb compare <work-dir>"))))

;; ── the fixture-backed cases; the dir is removed in a finally, never only
;;    after the last assertion (a throw here would otherwise leak it) ───────
(let [work (str (fs/create-temp-dir {:prefix "bl959-cli-"}))]
  (try
    ;; invariant 2 at its most extreme: NOTHING was compared.
    (let [r (run-cli "compare" work)]
      (assert= "an empty work dir is never equivalence - non-zero exit" 1 (:exit r))
      (assert-true "an empty work dir says INCOMPLETE and why"
                   (and (str/includes? (:out r) "INCOMPLETE")
                        (str/includes? (:out r) "nothing compared is never equivalence"))))

    ;; identical result sets: exit 0, AND both matrix files actually written.
    (seed-identical! work)
    (let [r (run-cli "compare" work)
          txt (str (fs/path work "matrix.txt"))
          md (str (fs/path work "matrix.md"))]
      (assert= "identical result sets exit 0" 0 (:exit r))
      (assert-true "the CLI writes matrix.txt" (fs/exists? txt))
      (assert-true "the CLI writes matrix.md" (fs/exists? md))
      ;; The files carry the RENDERED matrix, not an empty or placeholder
      ;; file - a truncating write would pass a bare exists? check.
      (assert-true "matrix.txt holds one EQUIVALENT line per entry x gate"
                   (= 4 (count (filter #(str/starts-with? % "EQUIVALENT")
                                       (str/split-lines (slurp txt))))))
      (assert-true "matrix.md is markdown, not the txt rendering"
                   (and (str/includes? (slurp md) "|")
                        (not= (str/trim (slurp txt)) (str/trim (slurp md))))))

    ;; a missing candidate outcome: INCOMPLETE, non-zero, files still written.
    (fs/delete (fs/path work "results" "candidate" "lint-parse" "specs__features__beta.feature.json"))
    (let [r (run-cli "compare" work)]
      (assert= "a missing candidate outcome fails closed" 1 (:exit r))
      (assert-true "the missing side is named on the INCOMPLETE row"
                   (some #(and (str/starts-with? % "INCOMPLETE")
                               (str/includes? % "beta.feature")
                               (str/includes? % "candidate outcome missing"))
                         (str/split-lines (:out r))))
      (assert-true "the matrix files are refreshed on the failing run too"
                   (str/includes? (slurp (str (fs/path work "matrix.txt"))) "INCOMPLETE")))
    (finally
      (fs/delete-tree work))))

;; ── report ────────────────────────────────────────────────────────────────
(if (empty? @failures)
  (println "ALL PASS: aps_equivalence_cli.bb")
  (do (doseq [f @failures] (println f))
      (System/exit 1)))
