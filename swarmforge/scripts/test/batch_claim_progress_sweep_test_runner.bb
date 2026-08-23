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
;; BL-1076 added the owner's worktree dirtiness as a fifth argument and split
;; the return into {:suspects :suppressed}. Every BL-678 case below passes
;; `false` - a clean worktree - which is the condition each of them always
;; meant, so their verdicts are unchanged. The dirty cases are new, below.

;; 1. No sidecar at all -> untouched, no suspect (never surfaces on absence).
(let [tmp (mk-tmp)
      fp (str (fs/path tmp "no_sidecar.handoff"))]
  (write-handoff! fp "BL-1")
  (let [{:keys [suspects suppressed]} (chase-sweep-lib/apply-batch-claim-progress-check!
                                       [{:filePath fp}] 100000 1000 "commitaaaa" false)]
    (assert= "no-sidecar item never surfaces as suspect" [] suspects)
    (assert= "no-sidecar item is not recorded as a suppression either" [] suppressed)
    (assert= "no-sidecar item gets no sidecar written" false (fs/exists? (str fp ".batch-claim-progress.json")))))

;; 2. Fresh sidecar, unchanged commit -> silent, sidecar rewritten unchanged.
(let [tmp (mk-tmp)
      fp (str (fs/path tmp "fresh.handoff"))]
  (write-handoff! fp "BL-2")
  (spit (str fp ".batch-claim-progress.json")
        (json/generate-string {:ownerRole "cleaner" :parcelId "BL-2" :claimAtMs 99000
                                :lastProgressAtMs 99500 :lastCommit "commitaaaa"}))
  (let [{:keys [suspects]} (chase-sweep-lib/apply-batch-claim-progress-check!
                            [{:filePath fp}] 100000 100000 "commitaaaa" false)]
    (assert= "fresh + unchanged commit never surfaces as suspect" [] suspects)))

;; 3. Commit advanced -> last-progress refreshed to now, no suspect (fresh again).
(let [tmp (mk-tmp)
      fp (str (fs/path tmp "advanced.handoff"))]
  (write-handoff! fp "BL-3")
  (spit (str fp ".batch-claim-progress.json")
        (json/generate-string {:ownerRole "cleaner" :parcelId "BL-3" :claimAtMs 1000
                                :lastProgressAtMs 1000 :lastCommit "commitaaaa"}))
  (let [{:keys [suspects]} (chase-sweep-lib/apply-batch-claim-progress-check!
                            [{:filePath fp}] 500000 1000 "commitbbbb" false)
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
  (let [{:keys [suspects]} (chase-sweep-lib/apply-batch-claim-progress-check!
                            [{:filePath fp}] 999000 1000 "commitaaaa" false)]
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
    (chase-sweep-lib/apply-batch-claim-progress-check! [{:filePath fp}] 999000 1000 "commitaaaa" false)
    (assert= "the handoff file's own content is never modified by the check" before (slurp fp))
    (assert= "the handoff file is never moved/deleted" true (fs/exists? fp))))


;; ── BL-1076: the visible-work gate at the sweep layer ───────────────────────

;; 6. Stale, unchanged commit, but the owner is visibly working -> suppressed,
;;    NOT surfaced. This is the exact live case: HEAD unmoved since 20:20:44Z,
;;    `M extension/test/boyScoutRun.test.js` in the worktree.
(let [tmp (mk-tmp)
      fp (str (fs/path tmp "dirty.handoff"))]
  (write-handoff! fp "BL-6-demo")
  (spit (str fp ".batch-claim-progress.json")
        (json/generate-string {:ownerRole "hardender" :parcelId "BL-6" :claimAtMs 1000
                                :lastProgressAtMs 1000 :lastCommit "commitaaaa"}))
  (let [{:keys [suspects suppressed]} (chase-sweep-lib/apply-batch-claim-progress-check!
                                       [{:filePath fp}] 999000 1000 "commitaaaa" true)]
    (assert= "a dirty owner worktree sends no suspect" [] suspects)
    (assert= "a dirty owner worktree records exactly one suppression" 1 (count suppressed))
    (assert= "the suppression names the parcel" "BL-6" (:item-id (first suppressed)))
    (assert= "the suppression carries its reason" "worktree-dirty" (:reason (first suppressed)))
    (assert= "the suppression carries the age it would have reported" 998000 (:age-ms (first suppressed)))))

;; 7. Fresh progress + dirty worktree -> silent, and NOT recorded as a
;;    suppression. Nothing was declined; there was nothing to surface.
(let [tmp (mk-tmp)
      fp (str (fs/path tmp "fresh-dirty.handoff"))]
  (write-handoff! fp "BL-7")
  (spit (str fp ".batch-claim-progress.json")
        (json/generate-string {:ownerRole "hardender" :parcelId "BL-7" :claimAtMs 99000
                                :lastProgressAtMs 99500 :lastCommit "commitaaaa"}))
  (let [{:keys [suspects suppressed]} (chase-sweep-lib/apply-batch-claim-progress-check!
                                       [{:filePath fp}] 100000 100000 "commitaaaa" true)]
    (assert= "fresh + dirty sends no suspect" [] suspects)
    (assert= "fresh + dirty is not a suppression - nothing was declined" [] suppressed)))

;; 8. A dirty worktree still never touches the handoff file (invariant 2 holds
;;    for the new label exactly as for the old two).
(let [tmp (mk-tmp)
      fp (str (fs/path tmp "dirty-untouched.handoff"))]
  (write-handoff! fp "BL-8")
  (spit (str fp ".batch-claim-progress.json")
        (json/generate-string {:ownerRole "hardender" :parcelId "BL-8" :claimAtMs 1000
                                :lastProgressAtMs 1000 :lastCommit "commitaaaa"}))
  (let [before (slurp fp)]
    (chase-sweep-lib/apply-batch-claim-progress-check! [{:filePath fp}] 999000 1000 "commitaaaa" true)
    (assert= "a suppressed observation never modifies the handoff file" before (slurp fp))
    (assert= "a suppressed observation never moves/deletes the handoff file" true (fs/exists? fp))))

;; 9. A batch of several parcels: one commit refreshes them all, and a dirty
;;    worktree suppresses them all rather than a subset.
(let [tmp (mk-tmp)
      fps (for [n [1 2 3]] (str (fs/path tmp (str "batch-" n ".handoff"))))]
  (doseq [[n fp] (map vector [1 2 3] fps)]
    (write-handoff! fp (str "BL-90" n "-demo"))
    (spit (str fp ".batch-claim-progress.json")
          (json/generate-string {:ownerRole "hardender" :parcelId (str "BL-90" n) :claimAtMs 1000
                                  :lastProgressAtMs 1000 :lastCommit "commitaaaa"})))
  (let [held (mapv (fn [fp] {:filePath fp}) fps)
        {:keys [suspects suppressed]} (chase-sweep-lib/apply-batch-claim-progress-check!
                                       held 999000 1000 "commitaaaa" true)]
    (assert= "every parcel in the batch is suppressed, not just the first" 3 (count suppressed))
    (assert= "no parcel in the batch is surfaced" [] suspects))
  ;; The same batch, clean worktree and an advanced HEAD: every sidecar
  ;; records the new commit (feature scenario 04).
  (let [held (mapv (fn [fp] {:filePath fp}) fps)
        {:keys [suspects suppressed]} (chase-sweep-lib/apply-batch-claim-progress-check!
                                       held 999000 1000 "commitbbbb" false)]
    (assert= "an advanced HEAD clears every parcel in the batch" [] suspects)
    (assert= "an advanced HEAD is not a suppression" [] suppressed)
    (doseq [fp fps]
      (let [after (json/parse-string (slurp (str fp ".batch-claim-progress.json")) true)]
        (assert= (str "every parcel in the batch records the new commit: " (fs/file-name fp))
                 "commitbbbb" (:lastCommit after))
        (assert= (str "every parcel in the batch refreshes its progress instant: " (fs/file-name fp))
                 999000 (:lastProgressAtMs after))))))

;; ── BL-1076: parse-batch-claim-progress-role-stale-threshold-ms (pure) ──────

(assert= "role-threshold: a well-formed line is parsed to ms"
         {"hardender" (* 90 60 1000)}
         (chase-sweep-lib/parse-batch-claim-progress-role-stale-threshold-ms
          "config batch_claim_progress_role_stale_threshold_minutes hardender 90"))

(assert= "role-threshold: several roles each get their own entry"
         {"hardender" (* 90 60 1000) "cleaner" (* 5 60 1000)}
         (chase-sweep-lib/parse-batch-claim-progress-role-stale-threshold-ms
          (str "config batch_claim_progress_role_stale_threshold_minutes hardender 90\n"
               "config batch_claim_progress_role_stale_threshold_minutes cleaner 5")))

(assert= "role-threshold: no such line at all is an empty map, never nil"
         {}
         (chase-sweep-lib/parse-batch-claim-progress-role-stale-threshold-ms
          "config batch_claim_progress_stale_threshold_minutes 20"))

(assert= "role-threshold: zero is unusable and is dropped, degrading to the built-in"
         {}
         (chase-sweep-lib/parse-batch-claim-progress-role-stale-threshold-ms
          "config batch_claim_progress_role_stale_threshold_minutes hardender 0"))

(assert= "role-threshold: a negative value is dropped too"
         {}
         (chase-sweep-lib/parse-batch-claim-progress-role-stale-threshold-ms
          "config batch_claim_progress_role_stale_threshold_minutes hardender -5"))

(assert= "role-threshold: a missing number is dropped, never read as the role"
         {}
         (chase-sweep-lib/parse-batch-claim-progress-role-stale-threshold-ms
          "config batch_claim_progress_role_stale_threshold_minutes hardender"))

(assert= "role-threshold: an unusable line does not discard a good one beside it"
         {"cleaner" (* 5 60 1000)}
         (chase-sweep-lib/parse-batch-claim-progress-role-stale-threshold-ms
          (str "config batch_claim_progress_role_stale_threshold_minutes hardender 0\n"
               "config batch_claim_progress_role_stale_threshold_minutes cleaner 5")))

(assert= "role-threshold: the base key is not mistaken for a per-role one"
         {}
         (chase-sweep-lib/parse-batch-claim-progress-role-stale-threshold-ms
          "config batch_claim_progress_stale_threshold_minutes 15"))

(assert= "role-threshold: a commented-out line is not read as configuration"
         {}
         (chase-sweep-lib/parse-batch-claim-progress-role-stale-threshold-ms
          "# config batch_claim_progress_role_stale_threshold_minutes hardender 2"))

(when (seq @failures)
  (binding [*out* *err*]
    (doseq [f @failures] (println f)))
  (println (str "\n" (count @failures) " failure(s)"))
  (System/exit 1))

(println "batch_claim_progress_sweep_test_runner: ok")
