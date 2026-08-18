#!/usr/bin/env bb
;; TDD runner for chase_sweep_lib.bb's BL-678 batch-claim-progress functions.
;; apply-batch-claim-progress-check!/read/write use real fixture files (temp
;; dir), no live mailbox/tmux/daemon - mirrors dropped_parcel_test_runner.
;; bb's own split (conf parsers pure, sweep application fixture-based).

(ns batch-claim-progress-sweep-test-runner
  (:require [babashka.fs :as fs]
            [cheshire.core :as json]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "chase_sweep_lib.bb")))

(def failures (atom []))

(defn assert= [msg expected actual]
  (when (not= expected actual)
    (swap! failures conj (str "FAIL: " msg "\n  expected: " (pr-str expected) "\n  actual:   " (pr-str actual)))))

(def created-temp-dirs (atom []))
(.addShutdownHook (Runtime/getRuntime)
                   (Thread. (fn [] (doseq [d @created-temp-dirs] (try (fs/delete-tree d) (catch Exception _ nil))))))

(defn- mk-tmp []
  (let [d (str (fs/create-temp-dir {:prefix "bl678-sweep-test-"}))]
    (swap! created-temp-dirs conj d)
    d))

(defn- write-handoff! [path task]
  (spit path (str "id: t\nfrom: specifier\nto: cleaner\nrecipient: cleaner\npriority: 50\n"
                   "type: git_handoff\ntask: " task "\ncommit: 1234567890\n"
                   "created_at: 2026-07-01T00:00:00Z\n\nbody\n")))

;; ── parse-batch-claim-progress-stale-threshold-ms (pure) ────────────────────

(assert= "stale-threshold: explicit conf value wins"
         (* 15 60 1000)
         (chase-sweep-lib/parse-batch-claim-progress-stale-threshold-ms
          "config batch_claim_progress_stale_threshold_minutes 15"))
(assert= "stale-threshold: missing conf line degrades to default"
         chase-sweep-lib/batch-claim-progress-stale-default-threshold-ms
         (chase-sweep-lib/parse-batch-claim-progress-stale-threshold-ms ""))
(assert= "stale-threshold: non-positive value degrades to default"
         chase-sweep-lib/batch-claim-progress-stale-default-threshold-ms
         (chase-sweep-lib/parse-batch-claim-progress-stale-threshold-ms
          "config batch_claim_progress_stale_threshold_minutes 0"))

;; ── parse-batch-claim-progress-cooldown-ms (pure) ───────────────────────────

(assert= "cooldown: explicit conf value wins"
         (* 10 60 1000)
         (chase-sweep-lib/parse-batch-claim-progress-cooldown-ms
          "config batch_claim_progress_cooldown_minutes 10"))
(assert= "cooldown: missing conf line degrades to default"
         chase-sweep-lib/batch-claim-progress-cooldown-default-ms
         (chase-sweep-lib/parse-batch-claim-progress-cooldown-ms ""))

;; ── batch-claim-progress-suspect-note-message (pure) ────────────────────────

(assert= "suspect message truncates at dispatch-gap-note-max-length"
         true
         (<= (count (chase-sweep-lib/batch-claim-progress-suspect-note-message
                     "BL-999999999999999999999999999999999" 999999999))
             chase-sweep-lib/dispatch-gap-note-max-length))

;; ── apply-batch-claim-progress-check! (fixture I/O) ─────────────────────────

;; 1. No sidecar at all -> untouched, no suspect (never surfaces on absence).
(let [tmp (mk-tmp)
      fp (str (fs/path tmp "no_sidecar.handoff"))]
  (write-handoff! fp "BL-1")
  (let [suspects (chase-sweep-lib/apply-batch-claim-progress-check!
                  [{:filePath fp}] 100000 1000 "commitaaaa")]
    (assert= "no-sidecar item never surfaces as suspect" [] suspects)
    (assert= "no-sidecar item gets no sidecar written" false (fs/exists? (str fp ".batch-claim-progress.json")))))

;; 2. Fresh sidecar, unchanged commit -> silent, sidecar rewritten unchanged.
(let [tmp (mk-tmp)
      fp (str (fs/path tmp "fresh.handoff"))]
  (write-handoff! fp "BL-2")
  (spit (str fp ".batch-claim-progress.json")
        (json/generate-string {:ownerRole "cleaner" :parcelId "BL-2" :claimAtMs 99000
                                :lastProgressAtMs 99500 :lastCommit "commitaaaa"}))
  (let [suspects (chase-sweep-lib/apply-batch-claim-progress-check!
                  [{:filePath fp}] 100000 100000 "commitaaaa")]
    (assert= "fresh + unchanged commit never surfaces as suspect" [] suspects)))

;; 3. Commit advanced -> last-progress refreshed to now, no suspect (fresh again).
(let [tmp (mk-tmp)
      fp (str (fs/path tmp "advanced.handoff"))]
  (write-handoff! fp "BL-3")
  (spit (str fp ".batch-claim-progress.json")
        (json/generate-string {:ownerRole "cleaner" :parcelId "BL-3" :claimAtMs 1000
                                :lastProgressAtMs 1000 :lastCommit "commitaaaa"}))
  (let [suspects (chase-sweep-lib/apply-batch-claim-progress-check!
                  [{:filePath fp}] 500000 1000 "commitbbbb")
        after (json/parse-string (slurp (str fp ".batch-claim-progress.json")) true)]
    (assert= "advanced commit never surfaces as suspect this tick" [] suspects)
    (assert= "advanced commit refreshes lastProgressAtMs to now" 500000 (:lastProgressAtMs after))
    (assert= "advanced commit refreshes lastCommit" "commitbbbb" (:lastCommit after))))

;; 4. Commit unchanged, stale -> surfaces exactly one suspect naming the ticket + age.
(let [tmp (mk-tmp)
      fp (str (fs/path tmp "stale.handoff"))]
  (write-handoff! fp "BL-4-demo")
  (spit (str fp ".batch-claim-progress.json")
        (json/generate-string {:ownerRole "cleaner" :parcelId "BL-4" :claimAtMs 1000
                                :lastProgressAtMs 1000 :lastCommit "commitaaaa"}))
  (let [suspects (chase-sweep-lib/apply-batch-claim-progress-check!
                  [{:filePath fp}] 999000 1000 "commitaaaa")]
    (assert= "stale + unchanged commit surfaces exactly one suspect" 1 (count suspects))
    (assert= "suspect names the ticket id extracted from the task header" "BL-4" (:item-id (first suspects)))
    (assert= "suspect age is now minus lastProgressAtMs" 998000 (:age-ms (first suspects)))))

;; 5. Never touches the handoff file itself, regardless of outcome (invariant 2).
(let [tmp (mk-tmp)
      fp (str (fs/path tmp "untouched.handoff"))]
  (write-handoff! fp "BL-5")
  (spit (str fp ".batch-claim-progress.json")
        (json/generate-string {:ownerRole "cleaner" :parcelId "BL-5" :claimAtMs 1000
                                :lastProgressAtMs 1000 :lastCommit "commitaaaa"}))
  (let [before (slurp fp)]
    (chase-sweep-lib/apply-batch-claim-progress-check! [{:filePath fp}] 999000 1000 "commitaaaa")
    (assert= "the handoff file's own content is never modified by the check" before (slurp fp))
    (assert= "the handoff file is never moved/deleted" true (fs/exists? fp))))

(when (seq @failures)
  (binding [*out* *err*]
    (doseq [f @failures] (println f)))
  (println (str "\n" (count @failures) " failure(s)"))
  (System/exit 1))

(println "batch_claim_progress_sweep_test_runner: ok")
