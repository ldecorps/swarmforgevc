#!/usr/bin/env bb
;; TDD runner for suite_baseline_lib.bb — BL-1377.
;;
;; The lib is the whole decision and it is pure: a record, a key and an
;; observed failure set in, a plan and an evidence sentence out. It runs no
;; suite, reads no file and asks git nothing, so every claim below is checked
;; in-process with no fixture (the CLI beside it owns the git worktree, the
;; hashing and the suite runs).

(ns suite-baseline-lib-test-runner
  (:require [babashka.fs :as fs]
            [clojure.string :as str]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "suite_baseline_lib.bb")))

(def failures (atom []))
(defn assert= [msg expected actual]
  (when (not= expected actual)
    (swap! failures conj (str "FAIL: " msg "\n  expected: " (pr-str expected) "\n  actual:   " (pr-str actual)))))
(defn assert-true [msg actual] (assert= msg true (boolean actual)))
(defn assert-false [msg actual] (assert= msg false (boolean actual)))

(def key-abc {:suite "unit" :base-sha "abc1230000" :config-hash "cfg-1"})
(def two-reds ["test/a.test.js > red one" "test/b.test.js > red two"])

(defn- decide [& {:as over}]
  (suite-baseline-lib/decide (merge {:key key-abc :record nil :record-error nil :observed []} over)))

;; ── the suite registry ────────────────────────────────────────────────────

(assert= "the suites this caches are named, not guessed"
         ["properties" "unit"] (suite-baseline-lib/suite-names))

(assert-true "each suite names the config files whose change invalidates a record"
             (every? #(seq (:config-paths (suite-baseline-lib/suite %)))
                     (suite-baseline-lib/suite-names)))

(assert= "an unknown suite is not a suite" nil (suite-baseline-lib/suite "made-up"))

;; ── a fresh, matching record: ONE run ─────────────────────────────────────

(let [d (decide :record {:key key-abc :reds two-reds :recorded-by "coder"}
                :observed two-reds)]
  (assert-false "a matching record needs no second run" (:second-run? d))
  (assert= "nothing is new" [] (:new d))
  (assert= "nothing vanished" [] (:vanished d))
  (assert= "the recorded reds are the ones excused" two-reds (:excused d))
  (assert-false "and the record is not rewritten" (:write-baseline? d))
  (let [line (suite-baseline-lib/evidence-line d)]
    (assert-true "the evidence names the base sha" (str/includes? line "abc1230000"))
    (assert-true "it names the recorded count" (str/includes? line "2 recorded"))
    (assert-true "it names the observed count" (str/includes? line "2 observed"))
    (assert-true "and says the sets agree" (str/includes? line "same set"))))

;; Order is not identity: a suite that reports the same reds in another order
;; has the same failure SET, and forcing a second run over it would be a cache
;; that never hits.
(let [d (decide :record {:key key-abc :reds two-reds}
                :observed (reverse two-reds))]
  (assert-false "the same set in another order still needs no second run" (:second-run? d)))

;; ── a mismatch: TWO runs, and the difference is NAMED ─────────────────────

(let [d (decide :record {:key key-abc :reds two-reds}
                :observed (conj (vec two-reds) "test/c.test.js > fresh red"))]
  (assert-true "a red the record does not name forces the second run" (:second-run? d))
  (assert= "the new red is named" ["test/c.test.js > fresh red"] (:new d))
  (assert= "nothing vanished" [] (:vanished d))
  ;; Invariant 1: the cache may shrink a run, never widen an excuse.
  (assert-false "a red the record does not name is never excused"
                (some #{"test/c.test.js > fresh red"} (:excused d)))
  (let [line (suite-baseline-lib/evidence-line d)]
    (assert-true "the evidence names the new red" (str/includes? line "test/c.test.js > fresh red"))
    (assert-true "and calls it new" (str/includes? line "new"))
    (assert-false "and never calls it pre-existing"
                  (re-find #"test/c\.test\.js > fresh red[^\n]*pre-existing" line))))

(let [d (decide :record {:key key-abc :reds two-reds}
                :observed [(first two-reds)])]
  (assert-true "a red that vanished is also a mismatch" (:second-run? d))
  (assert= "the vanished red is named" [(second two-reds)] (:vanished d))
  (assert= "nothing is new" [] (:new d))
  (assert-true "the evidence names it as vanished"
               (str/includes? (suite-baseline-lib/evidence-line d) "vanished")))

;; ── every way of not having a usable record: TWO runs, nothing excused ────

(doseq [[label over] [["absent" {:record nil}]
                      ["unreadable" {:record nil :record-error "not JSON"}]
                      ["a different config hash" {:record {:key (assoc key-abc :config-hash "cfg-2") :reds two-reds}}]
                      ["a different base sha" {:record {:key (assoc key-abc :base-sha "def4560000") :reds two-reds}}]]]
  (let [d (decide (first (keys over)) (first (vals over)) :observed two-reds)]
    (assert-true (str label ": falls back to two runs") (:second-run? d))
    (assert= (str label ": excuses nothing from a record") [] (:excused d))
    (assert-true (str label ": and says why") (seq (:reason d)))
    ;; Nothing is called "new" on a fallback either: with no usable record
    ;; there is no set to have been absent from. The second run decides.
    (assert= (str label ": names no new red on the strength of no record") [] (:new d))))

(assert-true "an unreadable record says so, rather than reading as absent"
             (str/includes? (:reason (decide :record-error "not JSON" :observed two-reds)) "unreadable"))
(assert-true "a config-hash mismatch says which key it was recorded under"
             (str/includes? (:reason (decide :record {:key (assoc key-abc :config-hash "cfg-2") :reds two-reds}
                                             :observed two-reds))
                            "cfg-2"))

;; ── the first stage at a base records the set ────────────────────────────

(assert-true "with no usable record, the base run's set becomes the new baseline"
             (:write-baseline? (decide :observed two-reds)))
(assert-false "with a usable record, nothing is rewritten"
              (:write-baseline? (decide :record {:key key-abc :reds two-reds} :observed two-reds)))

(let [entry (suite-baseline-lib/record-entry {:key key-abc :reds two-reds :recorded-by "coder" :at "2026-09-03T00:00:00Z"})]
  (assert= "the record carries the base sha it was observed under" "abc1230000" (get-in entry [:key :base-sha]))
  (assert= "and the suite config hash" "cfg-1" (get-in entry [:key :config-hash]))
  (assert= "and the suite" "unit" (get-in entry [:key :suite]))
  (assert= "and the failure set itself" two-reds (:reds entry))
  (assert-true "and who recorded it, so the evidence can name them" (seq (:recorded-by entry))))

;; A record is only ever read back for its OWN key.
(assert-true "a record matches its own key" (suite-baseline-lib/record-matches? {:key key-abc} key-abc))
(assert-false "a record never matches another suite"
              (suite-baseline-lib/record-matches? {:key (assoc key-abc :suite "properties")} key-abc))
(assert-false "nor another base sha"
              (suite-baseline-lib/record-matches? {:key (assoc key-abc :base-sha "zzz")} key-abc))
(assert-false "nor another config hash"
              (suite-baseline-lib/record-matches? {:key (assoc key-abc :config-hash "zzz")} key-abc))
(assert-false "and a record with no key at all matches nothing"
              (suite-baseline-lib/record-matches? {:reds two-reds} key-abc))

;; ── the newest record for a key wins ─────────────────────────────────────

(assert= "the latest matching entry is the one read back"
         ["late"]
         (:reds (suite-baseline-lib/latest-record
                 [{:key key-abc :reds ["early"] :at "2026-09-03T00:00:00Z"}
                  {:key (assoc key-abc :base-sha "other") :reds ["wrong key"] :at "2026-09-03T02:00:00Z"}
                  {:key key-abc :reds ["late"] :at "2026-09-03T01:00:00Z"}]
                 key-abc)))

(assert= "no matching entry is no record" nil
         (suite-baseline-lib/latest-record [{:key (assoc key-abc :base-sha "other") :reds ["x"]}] key-abc))

;; The refusal must be able to say WHY, and "no record at all" is a different
;; situation from "a record, filed at another base". nearest-record is what
;; carries the second one to decide, which still refuses it.
(assert= "with no match, the newest entry for the SAME SUITE is reported on"
         ["other base"]
         (:reds (suite-baseline-lib/nearest-record
                 [{:key (assoc key-abc :base-sha "other") :reds ["other base"]}
                  {:key (assoc key-abc :suite "properties") :reds ["other suite"]}]
                 key-abc)))

(assert= "a matching entry still wins over a same-suite one"
         ["exact"]
         (:reds (suite-baseline-lib/nearest-record
                 [{:key (assoc key-abc :base-sha "other") :reds ["other base"]}
                  {:key key-abc :reds ["exact"]}]
                 key-abc)))

(assert= "and an entry for another suite is never reported on" nil
         (suite-baseline-lib/nearest-record
          [{:key (assoc key-abc :suite "properties") :reds ["other suite"]}] key-abc))

(if (seq @failures)
  (do (doseq [f @failures] (println f))
      (println (str (count @failures) " FAILURE(S)"))
      (System/exit 1))
  (println "suite_baseline_lib: ALL PASS"))
