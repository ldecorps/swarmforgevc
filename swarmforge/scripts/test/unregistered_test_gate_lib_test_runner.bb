#!/usr/bin/env bb
;; TDD runner for unregistered_test_gate_lib.bb (BL-1240) - the send-time gate
;; that refuses a git_handoff whose own parcel adds a test file with no row in
;; suite-manifest.tsv, so the omission fails the ticket that created it rather
;; than the next parcel to run the full suite.

(ns unregistered-test-gate-lib-test-runner
  (:require [babashka.fs :as fs]
            [clojure.string :as str]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "unregistered_test_gate_lib.bb")))

(def failures (atom []))
(defn assert= [msg expected actual]
  (when (not= expected actual)
    (swap! failures conj (str "FAIL: " msg "\n  expected: " (pr-str expected) "\n  actual:   " (pr-str actual)))))
(defn assert-true [msg actual] (assert= msg true actual))
(defn assert-false [msg actual] (assert= msg false actual))
(defn assert-includes [msg haystack needle]
  (when-not (str/includes? (str haystack) needle)
    (swap! failures conj (str "FAIL: " msg "\n  expected to include: " (pr-str needle) "\n  actual: " (pr-str haystack)))))

(def T "swarmforge/scripts/test")

;; ── parcel-test-file: which changed paths this gate is even about ────────

(assert= "a shell test in the tree is a test file"
         "test_foo.sh" (unregistered-test-gate-lib/parcel-test-file (str T "/test_foo.sh")))
(assert= "a bb test runner in the tree is a test file"
         "foo_test_runner.bb" (unregistered-test-gate-lib/parcel-test-file (str T "/foo_test_runner.bb")))
(assert= "a helper in the tree is not a test file"
         nil (unregistered-test-gate-lib/parcel-test-file (str T "/suite_inventory_lib.bb")))
(assert= "a property runner has its own lane and is never a suite member"
         nil (unregistered-test-gate-lib/parcel-test-file (str T "/bl1240_x_property_runner.bb")))
(assert= "test/lib/ holds shared helpers, not tests - the discovery is not recursive"
         nil (unregistered-test-gate-lib/parcel-test-file (str T "/lib/bb_fixture_load_guard.sh")))
;; The example above is nil for BOTH reasons at once (nested AND fails
;; test-file?'s own name shape - "lib/..." itself never starts with "test_"),
;; so on its own it cannot tell whether the nested-path guard is doing
;; anything. A fixture that isolates the guard needs the RELATIVE PATH,
;; directory included, to independently satisfy test-file?'s own predicate -
;; only then does removing the guard change the answer.
(assert= "a directory itself named test_-prefixed does not make its contents a test file"
         nil (unregistered-test-gate-lib/parcel-test-file (str T "/test_fixtures/test_helper.sh")))
(assert= "...same for the _test_runner.bb shape, nested"
         nil (unregistered-test-gate-lib/parcel-test-file (str T "/lib/nested_test_runner.bb")))
(assert= "a test file OUTSIDE this tree is another lane's business"
         nil (unregistered-test-gate-lib/parcel-test-file "extension/test/foo.test.js"))
(assert= "a functional path is not a test file"
         nil (unregistered-test-gate-lib/parcel-test-file "swarmforge/scripts/handoffd.bb"))

;; ── unregistered-findings: the pure decision ─────────────────────────────

(def row (fn [f] {:file f :lane "standing" :date "" :reason ""}))

(assert= "an added test file with no row is a finding, carrying the row it needs"
         [{:path (str T "/test_new.sh") :file "test_new.sh" :row "test_new.sh\tstanding\t\t"}]
         (unregistered-test-gate-lib/unregistered-findings
          {:changed-paths [(str T "/test_new.sh")] :manifest-rows []}))

(assert= "an added test file WITH a row is no finding"
         []
         (unregistered-test-gate-lib/unregistered-findings
          {:changed-paths [(str T "/test_new.sh")] :manifest-rows [(row "test_new.sh")]}))

(assert= "an excluded row registers the file just as a standing one does"
         []
         (unregistered-test-gate-lib/unregistered-findings
          {:changed-paths [(str T "/test_new.sh")]
           :manifest-rows [{:file "test_new.sh" :lane "excluded" :date "2026-08-30" :reason "live-only"}]}))

;; Scenario 03, the load-bearing one: parcel-scoped, never tree-scoped.
(assert= "another parcel's unregistered file in the tree is not this parcel's problem"
         []
         (unregistered-test-gate-lib/unregistered-findings
          {:changed-paths ["extension/src/tools/foo.ts" "docs/how-to/BL-1240-x.md"]
           :manifest-rows []}))

(assert= "a DELETED test file is not a finding - it no longer exists to register"
         []
         (unregistered-test-gate-lib/unregistered-findings
          {:changed-paths [(str T "/test_gone.sh")] :manifest-rows [] :exists? (constantly false)}))

(assert= "several unregistered files are all reported, sorted, in one refusal"
         ["c_test_runner.bb" "test_a.sh" "test_b.sh"]
         (mapv :file (unregistered-test-gate-lib/unregistered-findings
                      {:changed-paths [(str T "/test_b.sh") (str T "/c_test_runner.bb") (str T "/test_a.sh")]
                       :manifest-rows []})))

(assert= "a path changed twice is reported once"
         1 (count (unregistered-test-gate-lib/unregistered-findings
                   {:changed-paths [(str T "/test_a.sh") (str T "/test_a.sh")] :manifest-rows []})))

(assert= "no changed paths at all is no finding"
         [] (unregistered-test-gate-lib/unregistered-findings {:changed-paths nil :manifest-rows []}))

;; ── blocked? / refusal-message ───────────────────────────────────────────

(assert-false "an empty finding set never blocks"
              (unregistered-test-gate-lib/blocked? {:findings []}))
(assert-true "a finding blocks"
             (unregistered-test-gate-lib/blocked?
              {:findings [{:path (str T "/test_new.sh") :file "test_new.sh" :row "x"}]}))

(let [msg (unregistered-test-gate-lib/refusal-message
           {:task-name "BL-1240-something"
            :findings (unregistered-test-gate-lib/unregistered-findings
                       {:changed-paths [(str T "/test_new.sh")] :manifest-rows []})})]
  (assert-includes "the refusal names the task" msg "BL-1240-something")
  (assert-includes "the refusal names the file" msg "test_new.sh")
  (assert-includes "the refusal names the manifest" msg "suite-manifest.tsv")
  ;; The whole point of moving the check here: one edit, not a search.
  (assert-includes "the refusal quotes the row the file needs" msg "test_new.sh\tstanding")
  (assert-includes "...and says the other lane exists, without choosing it" msg "excluded")
  (assert-includes "...with the date an exclusion is a dated decision needs" msg "YYYY-MM-DD"))

(let [msg (unregistered-test-gate-lib/refusal-message
           {:task-name "BL-1240-something"
            :findings (unregistered-test-gate-lib/unregistered-findings
                       {:changed-paths [(str T "/test_a.sh") (str T "/b_test_runner.bb")] :manifest-rows []})})]
  (assert-includes "two files are counted" msg "2 test files")
  (assert-includes "...and both named" msg "test_a.sh")
  (assert-includes "...and both named" msg "b_test_runner.bb"))

;; ── the impure entry point: fail-open is absolute ────────────────────────

(assert= "a task name with no ticket id gives up quietly rather than refusing"
         {:findings []}
         (unregistered-test-gate-lib/findings-for-git-handoff
          {:root "/nonexistent" :task-name "no-ticket-here" :commit "aaaaaaaaaa"}))

(let [result (unregistered-test-gate-lib/findings-for-git-handoff
              {:root "/nonexistent-root-for-bl1240" :task-name "BL-1240-x" :commit "aaaaaaaaaa"})]
  (assert-true "an unreadable root warns rather than blocking" (some? (:warning result)))
  (assert= "...and never reports findings alongside a warning" nil (:findings result))
  (assert-false "...so the send is allowed" (unregistered-test-gate-lib/blocked? result)))

;; ── one notion of "registered", not two ──────────────────────────────────
;;
;; The reuse required_wiring asks for, asserted rather than assumed: every
;; name this gate accepts as a test file is one the inventory would discover,
;; and the manifest is parsed by the inventory's own parser.

(doseq [name ["test_x.sh" "x_test_runner.bb"]]
  (assert-true (str "the gate and the inventory agree that " name " is a test file")
               (and (some? (unregistered-test-gate-lib/parcel-test-file (str T "/" name)))
                    (suite-inventory-lib/test-file? name))))
(doseq [name ["suite_inventory_lib.bb" "x_property_runner.bb" "helper.sh"]]
  (assert-true (str "the gate and the inventory agree that " name " is not")
               (and (nil? (unregistered-test-gate-lib/parcel-test-file (str T "/" name)))
                    (not (suite-inventory-lib/test-file? name)))))

(assert= "the manifest is read through the inventory's own parser"
         [{:file "test_x.sh" :lane "standing" :date "" :reason "" :raw "test_x.sh\tstanding\t\t"}]
         (suite-inventory-lib/parse-manifest "# c\n\ntest_x.sh\tstanding\t\t\n"))

;; ── invariant 2's half, in the inventory where it already lives ──────────
;;
;; "A manifest row that registers no existing file is reported as an error,
;; never accepted silently." Asserted HERE too, against the shipped check,
;; because BL-1240 depends on it being true and a regression there would make
;; this gate satisfiable by a row that does nothing.

(let [problems (suite-inventory-lib/check #{"test_real.sh"}
                                          [(row "test_real.sh") (row "BL-780")])]
  (assert-true "a row whose first column is a ticket id is an error"
               (boolean (some #(str/includes? % "BL-780") problems)))
  (assert-true "...named as malformed, not as a missing file"
               (boolean (some #(str/includes? % "not a test file name") problems))))

(let [problems (suite-inventory-lib/check #{} [(row "test_absent.sh")])]
  (assert-true "a row naming a test file that is not there is an error"
               (boolean (some #(str/includes? % "not in the tree") problems))))

(if (empty? @failures)
  (println "ALL PASS: unregistered_test_gate_lib.bb")
  (do (doseq [f @failures] (println f))
      (println (count @failures) "FAILURES")
      (System/exit 1)))
