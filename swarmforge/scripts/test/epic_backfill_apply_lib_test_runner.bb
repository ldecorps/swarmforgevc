#!/usr/bin/env bb
;; TDD runner for epic_backfill_apply_lib.bb (BL-677). Pure functions
;; only - the real commit-integrity/fs write path is exercised by the
;; acceptance suite (specs/features/BL-677-epic-backfill-apply.feature),
;; against a real fixture git repo, per this project's own testability
;; boundary (a live git checkout is not a fast unit fixture).

(ns epic-backfill-apply-lib-test-runner
  (:require [babashka.fs :as fs]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "epic_backfill_apply_lib.bb")))

(def failures (atom []))

(defn assert= [msg expected actual]
  (when (not= expected actual)
    (swap! failures conj (str "FAIL: " msg "\n  expected: " (pr-str expected) "\n  actual:   " (pr-str actual)))))

(defn assert-true [msg actual] (assert= msg true (boolean actual)))

;; ── approved? ──────────────────────────────────────────────────────────────

(assert-true "a mapping with the approval line is approved"
             (epic-backfill-apply-lib/approved? "# report\n\nhuman_approval: approved\n\n| id |\n"))
(assert-true "a mapping with no approval line is not approved"
             (not (epic-backfill-apply-lib/approved? "# report\n\n| id |\n")))
(assert-true "the approval line must match exactly (approved, not pending)"
             (not (epic-backfill-apply-lib/approved? "human_approval: pending\n")))

;; ── parse-mapping-rows ─────────────────────────────────────────────────────

(def sample-mapping
  (str "# Epic backfill proposals (BL-676)\n\n"
       "human_approval: approved\n\n"
       "| id | tier | proposal | evidence |\n"
       "| --- | --- | --- | --- |\n"
       "| BL-010 | roster-match | console | slug keyword(s): tool |\n"
       "| BL-011 | pre-epic-era | pre-epic-era | milestone M2 predates the earliest roster epic |\n"
       "| BL-012 | needs-judgment |  |  |\n"))

(def parsed (epic-backfill-apply-lib/parse-mapping-rows sample-mapping))

(assert= "parses exactly the 3 data rows, never the header/separator" 3 (count parsed))
(assert= "row 1 fields" {:id "BL-010" :tier "roster-match" :proposal "console" :evidence "slug keyword(s): tool"}
         (first parsed))
(assert= "an empty proposal cell parses as an empty string, not nil"
         "" (:proposal (nth parsed 2)))

;; ── unknown-epic-values ────────────────────────────────────────────────────

(def valid-epics #{"console" "pre-epic-era"})

(assert= "no unknown values when every non-empty proposal is valid"
         [] (epic-backfill-apply-lib/unknown-epic-values parsed valid-epics))
(assert= "an empty proposal is never itself an unknown value"
         [] (epic-backfill-apply-lib/unknown-epic-values
             [{:id "BL-012" :tier "needs-judgment" :proposal "" :evidence ""}] valid-epics))
(assert= "names every distinct unknown value, not just the first"
         ["not-a-real-epic" "also-fake"]
         (epic-backfill-apply-lib/unknown-epic-values
          [{:id "BL-011" :proposal "not-a-real-epic"}
           {:id "BL-012" :proposal "not-a-real-epic"}
           {:id "BL-013" :proposal "also-fake"}]
          valid-epics))

;; ── missing-done-ids ───────────────────────────────────────────────────────

(assert= "no missing ids when every row's id is in the done set"
         [] (epic-backfill-apply-lib/missing-done-ids parsed #{"BL-010" "BL-011" "BL-012"}))
(assert= "names a row's id with no file under done/"
         ["BL-999"]
         (epic-backfill-apply-lib/missing-done-ids [{:id "BL-999" :proposal "console"}] #{"BL-010"}))

;; ── refusal (order and byte-identical-on-refusal intent) ───────────────────

(assert= "not-approved refuses even when everything else is fine"
         :not-approved
         (:reason (epic-backfill-apply-lib/refusal "no approval here" parsed valid-epics #{"BL-010" "BL-011" "BL-012"})))
(assert= "not-approved is checked BEFORE staleness/unknown-epic"
         :not-approved
         (:reason (epic-backfill-apply-lib/refusal "no approval here"
                                                      [{:id "BL-999" :proposal "not-a-real-epic"}]
                                                      valid-epics #{})))
(assert= "stale-mapping refuses on a missing done file, once approved"
         :stale-mapping
         (:reason (epic-backfill-apply-lib/refusal "human_approval: approved\n"
                                                      [{:id "BL-999" :proposal "console"}]
                                                      valid-epics #{})))
(assert= "unknown-epic refuses on a bad value, once approved and non-stale"
         :unknown-epic
         (:reason (epic-backfill-apply-lib/refusal "human_approval: approved\n"
                                                      [{:id "BL-010" :proposal "not-a-real-epic"}]
                                                      valid-epics #{"BL-010"})))
(assert= "nil (safe to apply) when approved, every id known, every value valid"
         nil
         (epic-backfill-apply-lib/refusal "human_approval: approved\n" parsed valid-epics
                                            #{"BL-010" "BL-011" "BL-012"}))

;; ── classify-row (idempotency falls out of this) ────────────────────────────

(assert= "an untagged ticket with a real proposal is written"
         :write (epic-backfill-apply-lib/classify-row {:proposal "console"} nil))
(assert= "an untagged ticket with an empty proposal is skipped for judgment"
         :skip-empty-proposal (epic-backfill-apply-lib/classify-row {:proposal ""} nil))
(assert= "a ticket that already carries an epic is skipped, never overwritten -
even when the current value differs from the proposal"
         :skip-already-tagged (epic-backfill-apply-lib/classify-row {:proposal "console"} "reliability"))
(assert= "idempotency: a ticket this apply already wrote is skip-already-tagged on the next run"
         :skip-already-tagged (epic-backfill-apply-lib/classify-row {:proposal "console"} "console"))

;; ── with-epic-line ─────────────────────────────────────────────────────────

(assert= "inserts epic: right after milestone:, touching no other line"
         "id: BL-010\nmilestone: M2\nepic: console\nstatus: done\n"
         (epic-backfill-apply-lib/with-epic-line "id: BL-010\nmilestone: M2\nstatus: done\n" "console"))

;; ── partition-into-batches ───────────────────────────────────────────────

(assert= "an empty write list partitions into zero batches (idempotent re-run)"
         [] (epic-backfill-apply-lib/partition-into-batches [] 25))
(assert= "fewer rows than the batch size makes exactly one batch"
         [[{:id "BL-010"}]] (epic-backfill-apply-lib/partition-into-batches [{:id "BL-010"}] 25))
(assert= "more rows than one batch holds splits into multiple batches, never one commit per ticket"
         3 (count (epic-backfill-apply-lib/partition-into-batches
                   (mapv (fn [i] {:id (str "BL-" i)}) (range 7)) 3)))
(assert= "batch sizes: full, full, remainder"
         [3 3 1] (mapv count (epic-backfill-apply-lib/partition-into-batches
                               (mapv (fn [i] {:id (str "BL-" i)}) (range 7)) 3)))

(when (seq @failures)
  (doseq [f @failures] (println f))
  (System/exit 1))

(println "ALL PASS: epic_backfill_apply_lib.bb")
