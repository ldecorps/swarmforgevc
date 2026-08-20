#!/usr/bin/env bb
;; Unit tests for aps_equivalence_lib.bb (BL-959) - the pure comparator that
;; turns a pinned-toolchain result set and a candidate-toolchain result set
;; into a per-entry, per-gate verdict matrix (EQUIVALENT / DIVERGENT /
;; INCOMPLETE) plus an exit code. Fail-closed is the whole point: absence of
;; a result is never read as equivalence (declared invariant 2).

(require '[babashka.fs :as fs]
         '[clojure.string :as str]
         '[cheshire.core :as json])

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "aps_equivalence_lib.bb")))

(def failures (atom []))
(defn assert= [msg expected actual]
  (when (not= expected actual)
    (swap! failures conj (str "FAIL " msg "\n  expected: " (pr-str expected) "\n  actual:   " (pr-str actual)))))
(defn assert-true [msg actual] (assert= msg true (boolean actual)))
(defn assert-false [msg actual] (assert= msg false (boolean actual)))

(def created-temp-dirs (atom []))
(.addShutdownHook (Runtime/getRuntime)
                  (Thread. (fn [] (doseq [d @created-temp-dirs] (try (fs/delete-tree d) (catch Exception _ nil))))))
(defn mk-work []
  (let [d (str (fs/create-temp-dir {:prefix "aps-equivalence-test-"}))]
    (swap! created-temp-dirs conj d)
    d))

;; ── entry-slug: filename-safe, never a path escape ────────────────────────

(assert= "entry-slug: plain path flattens its separators"
         "specs__features__a.feature"
         (aps-equivalence-lib/entry-slug "specs/features/a.feature"))
(assert-false "entry-slug: no separator survives"
              (str/includes? (aps-equivalence-lib/entry-slug "a/b/../../c") "/"))
(assert-false "entry-slug: no dot-dot survives (a hostile entry cannot climb out of the work dir)"
              (str/includes? (aps-equivalence-lib/entry-slug "../../swarmforge/vendor/aps/x") ".."))
(assert= "entry-slug: distinct entries stay distinct after sanitizing"
         2
         (count (set [(aps-equivalence-lib/entry-slug "a/b.feature")
                      (aps-equivalence-lib/entry-slug "a__b.feature")])))

;; ── result paths and write-targets ────────────────────────────────────────

(assert= "result-file-path: side/gate/slug.json under the work dir"
         "/w/results/pinned/lint-parse/specs__features__a.feature.json"
         (aps-equivalence-lib/result-file-path "/w" "pinned" "lint-parse" "specs/features/a.feature"))

(let [targets (aps-equivalence-lib/write-targets "/w" ["specs/features/a.feature" "../evil"])]
  (assert-true "write-targets: every target sits under the work dir"
               (every? #(str/starts-with? % "/w/") targets))
  (assert-true "write-targets: includes the matrix files"
               (and (some #(= % "/w/matrix.txt") targets)
                    (some #(= % "/w/matrix.md") targets)))
  (assert-true "write-targets: covers both sides and all gates for each entry"
               (<= (* 2 (count aps-equivalence-lib/gates) 2) (count (filter #(str/includes? % "/results/") targets))))
  (assert-true "write-targets: the per-side IR temps are enumerated too (contained like every other write)"
               (some #(= % "/w/tmp/pinned/specs__features__a.feature.ir.json") targets)))

;; ── verdict-matrix: the fail-closed core ──────────────────────────────────

(def outcome-a {"exit" 0})
(def outcome-b {"exit" 1 "error" "boom"})

(assert= "identical outcomes on every cell verdict EQUIVALENT"
         [{:entry "e1" :gate "lint-parse" :verdict "EQUIVALENT" :detail nil}]
         (aps-equivalence-lib/verdict-matrix {"e1" {"lint-parse" outcome-a}}
                                             {"e1" {"lint-parse" outcome-a}}))

(let [[row] (aps-equivalence-lib/verdict-matrix {"e1" {"lint-parse" outcome-a}}
                                                {"e1" {"lint-parse" outcome-b}})]
  (assert= "differing outcomes verdict DIVERGENT" "DIVERGENT" (:verdict row))
  (assert-true "DIVERGENT detail shows both sides"
               (and (str/includes? (:detail row) "pinned")
                    (str/includes? (:detail row) "candidate"))))

(let [[row] (aps-equivalence-lib/verdict-matrix {"e1" {"lint-parse" outcome-a}} {})]
  (assert= "a candidate-side hole is INCOMPLETE, never EQUIVALENT (invariant 2)" "INCOMPLETE" (:verdict row))
  (assert-true "INCOMPLETE names the missing side" (str/includes? (:detail row) "candidate")))

(let [[row] (aps-equivalence-lib/verdict-matrix {} {"e1" {"lint-parse" outcome-a}})]
  (assert= "a pinned-side hole is INCOMPLETE too" "INCOMPLETE" (:verdict row))
  (assert-true "INCOMPLETE names the missing side" (str/includes? (:detail row) "pinned")))

(let [[row] (aps-equivalence-lib/verdict-matrix {"e1" {"lint-parse" nil}}
                                                {"e1" {"lint-parse" outcome-a}})]
  (assert= "a recorded null outcome is INCOMPLETE, never a comparable value (fail closed on a write bug)"
           "INCOMPLETE" (:verdict row)))

(assert= "matrix is sorted by entry then gate"
         [["e1" "ir-dry"] ["e1" "lint-parse"] ["e2" "lint-parse"]]
         (mapv (juxt :entry :gate)
               (aps-equivalence-lib/verdict-matrix
                {"e2" {"lint-parse" outcome-a} "e1" {"lint-parse" outcome-a "ir-dry" outcome-a}}
                {"e2" {"lint-parse" outcome-a} "e1" {"lint-parse" outcome-a "ir-dry" outcome-a}})))

;; ── exit-code: 0 only for a non-empty, all-EQUIVALENT matrix ──────────────

(assert= "all EQUIVALENT exits 0" 0
         (aps-equivalence-lib/exit-code [{:verdict "EQUIVALENT"}]))
(assert= "any DIVERGENT exits non-zero" 1
         (aps-equivalence-lib/exit-code [{:verdict "EQUIVALENT"} {:verdict "DIVERGENT"}]))
(assert= "any INCOMPLETE exits non-zero" 1
         (aps-equivalence-lib/exit-code [{:verdict "INCOMPLETE"}]))
(assert= "an EMPTY matrix exits non-zero - nothing compared is never equivalence (fail closed)" 1
         (aps-equivalence-lib/exit-code []))

;; ── rendering ─────────────────────────────────────────────────────────────

(assert= "render-line: verdict|entry|gate for a clean row"
         "EQUIVALENT|e1|lint-parse"
         (aps-equivalence-lib/render-line {:entry "e1" :gate "lint-parse" :verdict "EQUIVALENT" :detail nil}))
(assert= "render-line: detail rides as a fourth field"
         "INCOMPLETE|e1|lint-parse|candidate outcome missing"
         (aps-equivalence-lib/render-line {:entry "e1" :gate "lint-parse" :verdict "INCOMPLETE"
                                           :detail "candidate outcome missing"}))
(let [md (aps-equivalence-lib/render-markdown
          [{:entry "e1" :gate "lint-parse" :verdict "EQUIVALENT" :detail nil}
           {:entry "e2" :gate "ir-dry" :verdict "DIVERGENT" :detail "pinned=x candidate=y"}])]
  (assert-true "render-markdown: a table with one row per matrix row"
               (and (str/includes? md "| e1 | lint-parse | EQUIVALENT |")
                    (str/includes? md "| e2 | ir-dry | DIVERGENT |"))))

;; ── load-result-set: disk round-trip ──────────────────────────────────────

(let [work (mk-work)]
  (let [p (aps-equivalence-lib/result-file-path work "pinned" "lint-parse" "specs/features/a.feature")]
    (fs/create-dirs (fs/parent p))
    (spit p (json/generate-string {:entry "specs/features/a.feature" :outcome {"exit" 0}})))
  (assert= "load-result-set reads {entry {gate outcome}} back from disk"
           {"specs/features/a.feature" {"lint-parse" {"exit" 0}}}
           (aps-equivalence-lib/load-result-set work "pinned"))
  (assert= "load-result-set: a side with no directory is the empty set, never a crash"
           {}
           (aps-equivalence-lib/load-result-set work "candidate")))

;; ── outcome normalization ─────────────────────────────────────────────────

(assert= "normalize-lint-outcome: a pass is exit only - no message noise"
         {"exit" 0}
         (aps-equivalence-lib/normalize-lint-outcome 0 "OK: whatever" "/repo/root"))
(assert= "normalize-lint-outcome: a failure carries the message with the root prefix stripped"
         {"exit" 1 "error" "FAIL: specs/features/x.feature did not parse"}
         (aps-equivalence-lib/normalize-lint-outcome 1 "FAIL: /repo/root/specs/features/x.feature did not parse" "/repo/root"))
(assert= "normalize-lint-outcome: throwaway toolchain paths are scrubbed so the two sides stay comparable"
         {"exit" 1 "error" "boom at <tmp>/x"}
         (aps-equivalence-lib/normalize-lint-outcome 1 "boom at /var/tmp/aps-cand-123/x" "/repo/root"
                                                     {"/var/tmp/aps-cand-123" "<tmp>"}))

(assert= "normalize-dry-findings: findings compare as a sorted set, not file bytes"
         (aps-equivalence-lib/normalize-dry-findings {"findings" [{"kind" "b"} {"kind" "a"}] "summary" {"x" 1}})
         (aps-equivalence-lib/normalize-dry-findings {"summary" {"x" 2} "findings" [{"kind" "a"} {"kind" "b"}]}))
(assert= "normalize-dry-findings: a report with no findings key is the empty vector, never nil"
         []
         (aps-equivalence-lib/normalize-dry-findings {"summary" {}}))

;; ── report ────────────────────────────────────────────────────────────────
(if (empty? @failures)
  (println "ALL PASS: aps_equivalence_lib.bb")
  (do (doseq [f @failures] (println f))
      (System/exit 1)))
