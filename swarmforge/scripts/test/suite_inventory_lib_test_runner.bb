#!/usr/bin/env bb
;; BL-973: unit tests for the suite-completeness gate's pure half.
;;
;; This runner is itself a row in suite-manifest.tsv, which is the point in
;; miniature: the gate that notices unrun tests is not exempt from it.

(ns suite-inventory-lib-test-runner
  (:require [babashka.fs :as fs]
            [clojure.string :as str]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "suite_inventory_lib.bb")))

(def failures (atom []))
(defn assert= [msg expected actual]
  (when (not= expected actual)
    (swap! failures conj (str "FAIL: " msg "\n  expected: " (pr-str expected) "\n  actual:   " (pr-str actual)))))
(defn assert-some [msg pred coll]
  (when-not (some pred coll)
    (swap! failures conj (str "FAIL: " msg "\n  got: " (pr-str coll)))))
(defn assert-none [msg pred coll]
  (when (some pred coll)
    (swap! failures conj (str "FAIL: " msg "\n  got: " (pr-str coll)))))

(defn- has [substr] (fn [s] (str/includes? s substr)))

;; ── test-file? ──────────────────────────────────────────────────────────────
;; The two shapes the tree uses, and the helpers that must NOT be swept in as
;; tests - a helper counted as a test is a false red on every run.

(assert= "a shell test is a test file" true (suite-inventory-lib/test-file? "test_thing.sh"))
(assert= "a bb test runner is a test file" true (suite-inventory-lib/test-file? "thing_test_runner.bb"))
(assert= "a shared shell helper is not a test file" false (suite-inventory-lib/test-file? "tmp_cleanup.sh"))
(assert= "a property runner is not a test file (its own lane, never a suite member)"
         false (suite-inventory-lib/test-file? "bl1035_startup_grace_property_runner.bb"))
(assert= "a fixture harness is not a test file"
         false (suite-inventory-lib/test-file? "batch_claim_progress_sweep_harness.bb"))
(assert= "a bb file merely starting with test_ is not a shell test"
         false (suite-inventory-lib/test-file? "test_helpers.bb"))
(assert= "a .sh not starting with test_ is not a test file" false (suite-inventory-lib/test-file? "expedite_fixture.sh"))

;; ── parse-manifest ──────────────────────────────────────────────────────────

(let [rows (suite-inventory-lib/parse-manifest
            (str "# a comment\n"
                 "\n"
                 "test_a.sh\tstanding\t\t\n"
                 "test_b.sh\texcluded\t2026-08-23\tlive-only: drives real tmux\n"))]
  (assert= "comments and blank lines are skipped" 2 (count rows))
  (assert= "a standing row parses its file" "test_a.sh" (:file (first rows)))
  (assert= "a standing row parses its lane" "standing" (:lane (first rows)))
  (assert= "an excluded row parses its date" "2026-08-23" (:date (second rows)))
  (assert= "an excluded row parses its reason" "live-only: drives real tmux" (:reason (second rows))))

(assert= "a row with too few columns still parses its file, rather than being dropped"
         "test_c.sh"
         (:file (first (suite-inventory-lib/parse-manifest "test_c.sh\n"))))

;; ── check ───────────────────────────────────────────────────────────────────

(assert= "a tree and manifest that agree report no problems"
         []
         (suite-inventory-lib/check #{"test_a.sh"}
                                    [{:file "test_a.sh" :lane "standing" :date "" :reason ""}]))

(assert-some "a test file in no row is named"
             (has "not in the manifest: test_new.sh")
             (suite-inventory-lib/check #{"test_a.sh" "test_new.sh"}
                                        [{:file "test_a.sh" :lane "standing" :date "" :reason ""}]))

(assert-some "a row naming a file that no longer exists is named"
             (has "in the manifest but not in the tree: test_gone.sh")
             (suite-inventory-lib/check #{}
                                        [{:file "test_gone.sh" :lane "standing" :date "" :reason ""}]))

(assert-some "a file listed twice is named"
             (has "listed more than once: test_a.sh")
             (suite-inventory-lib/check #{"test_a.sh"}
                                        [{:file "test_a.sh" :lane "standing" :date "" :reason ""}
                                         {:file "test_a.sh" :lane "excluded" :date "2026-08-23" :reason "why"}]))

;; BL-1239: three rows sat in the manifest with a TICKET ID in column 1 and the
;; filename pushed to column 3. They registered nothing while looking like a
;; registration, and one of them was an attempt to register a file the gate was
;; still reporting missing. Column 1 must name a test file, and a row that does
;; not is called out as a malformed row - not as a missing file, which sends the
;; reader hunting in the wrong place.
(assert-some "a row whose first column is a ticket id rather than a filename is named as malformed"
             (has "first column is not a test file name: \"BL-780\"")
             (suite-inventory-lib/check
              #{"test_a.sh"}
              [{:file "test_a.sh" :lane "standing" :date "" :reason ""}
               {:file "BL-780" :lane "bl780_rotation_actionability_ordering"
                :date "test_bl780_rotation_actionability_ordering.sh" :reason "unit"}]))

(assert-none "a malformed row is not ALSO reported as a file missing from the tree"
             (has "in the manifest but not in the tree: BL-780")
             (suite-inventory-lib/check
              #{"test_a.sh"}
              [{:file "test_a.sh" :lane "standing" :date "" :reason ""}
               {:file "BL-780" :lane "standing" :date "" :reason ""}]))

;; A property runner has its own lane and is never a suite member (test-file?
;; above). A row registering one is the same malformed-row class.
(assert-some "a row registering a property runner is named as malformed"
             (has "first column is not a test file name")
             (suite-inventory-lib/check
              #{}
              [{:file "bl1137_cwd_scoped_mute_property_runner.bb" :lane "standing" :date "" :reason ""}]))

(assert-some "an unknown lane is named"
             (has "unknown lane")
             (suite-inventory-lib/check #{"test_a.sh"}
                                        [{:file "test_a.sh" :lane "skipped" :date "" :reason ""}]))

;; An exclusion without a date or a reason is a permanent silence wearing the
;; costume of a decision - the exact thing that let three tests sit red.
(assert-some "an exclusion with no date is named"
             (has "excluded without a valid YYYY-MM-DD date: test_a.sh")
             (suite-inventory-lib/check #{"test_a.sh"}
                                        [{:file "test_a.sh" :lane "excluded" :date "" :reason "slow"}]))

(assert-some "an exclusion with a malformed date is named"
             (has "excluded without a valid YYYY-MM-DD date: test_a.sh")
             (suite-inventory-lib/check #{"test_a.sh"}
                                        [{:file "test_a.sh" :lane "excluded" :date "August 2026" :reason "slow"}]))

(assert-some "an exclusion with no reason is named"
             (has "excluded without a reason: test_a.sh")
             (suite-inventory-lib/check #{"test_a.sh"}
                                        [{:file "test_a.sh" :lane "excluded" :date "2026-08-23" :reason ""}]))

(assert= "a properly dated exclusion with a reason is accepted"
         []
         (suite-inventory-lib/check #{"test_a.sh"}
                                    [{:file "test_a.sh" :lane "excluded" :date "2026-08-23"
                                      :reason "live-only: drives real tmux"}]))

(assert-none "a standing row is never asked for a date or a reason"
             (fn [p] (or (str/includes? p "date") (str/includes? p "reason")))
             (suite-inventory-lib/check #{"test_a.sh"}
                                        [{:file "test_a.sh" :lane "standing" :date "" :reason ""}]))

;; Every problem is reported in ONE pass, not just the first - the same
;; complete-inventory discipline Article 4.4 asks of a reviewing role.
(assert= "several problems are all reported together, never first-failure-stop"
         4
         (count (suite-inventory-lib/check
                 #{"test_a.sh" "test_missing.sh"}
                 [{:file "test_gone.sh" :lane "standing" :date "" :reason ""}
                  {:file "test_a.sh" :lane "excluded" :date "" :reason ""}])))

;; ── discover-test-files, against a real scratch tree ────────────────────────

(let [dir (str (fs/create-temp-dir {:prefix "bl973-inventory-"}))]
  (try
    (fs/create-dirs (fs/path dir "lib"))
    (doseq [n ["test_one.sh" "two_test_runner.bb" "helper.sh" "notes.md"
               "three_property_runner.bb"]]
      (spit (str (fs/path dir n)) ""))
    ;; A helper under lib/ must not be discovered: the walk is deliberately
    ;; not recursive, because lib/ holds shared helpers rather than tests.
    (spit (str (fs/path dir "lib" "test_helper.sh")) "")
    (assert= "discovery finds exactly the two test shapes, and does not recurse into lib/"
             #{"test_one.sh" "two_test_runner.bb"}
             (suite-inventory-lib/discover-test-files dir))
    (finally
      ;; BL-971: in a finally, so a failed assertion above cannot leak it.
      (fs/delete-tree dir))))

(if (seq @failures)
  (do (doseq [f @failures] (binding [*out* *err*] (println f)))
      (println (str "\n" (count @failures) " failure(s)"))
      (System/exit 1))
  (println "suite_inventory_lib_test_runner: ok"))
