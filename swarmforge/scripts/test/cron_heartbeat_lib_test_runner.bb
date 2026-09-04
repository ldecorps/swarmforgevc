#!/usr/bin/env bb
;; TDD runner for cron_heartbeat_lib.bb (BL-1392) - no clock, no filesystem;
;; every age is explicit.

(require '[babashka.fs :as fs])
(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "cron_heartbeat_lib.bb")))

(def failures (atom []))
(defn assert= [msg expected actual]
  (when (not= expected actual)
    (swap! failures conj (str "FAIL: " msg "\n  expected: " (pr-str expected) "\n  actual:   " (pr-str actual)))))
(defn assert-true [msg actual] (assert= msg true (boolean actual)))
(defn assert-false [msg actual] (assert= msg false (boolean actual)))

(def MIN 60000)

;; ── the verdict ───────────────────────────────────────────────────────────
(assert= "a log written inside the bound is fresh"
         :fresh (cron-heartbeat-lib/cron-heartbeat-verdict
                 {:present? true :age-ms (* 3 MIN) :escalated? false}))

(assert= "a log older than the bound escalates once"
         :stale-escalate (cron-heartbeat-lib/cron-heartbeat-verdict
                          {:present? true :age-ms (* 30 MIN) :escalated? false}))

(assert= "and the SAME episode stays quiet on the next tick"
         :stale-already-escalated (cron-heartbeat-lib/cron-heartbeat-verdict
                                   {:present? true :age-ms (* 40 MIN) :escalated? true}))

(assert= "a missing log is the same symptom at its starkest, and escalates once"
         :absent-escalate (cron-heartbeat-lib/cron-heartbeat-verdict
                           {:present? false :escalated? false}))

(assert= "a missing log already escalated stays quiet too"
         :absent-already-escalated (cron-heartbeat-lib/cron-heartbeat-verdict
                                    {:present? false :escalated? true}))

(assert= "an unreadable age is neither death nor life - never escalate, never clear"
         :unknown (cron-heartbeat-lib/cron-heartbeat-verdict
                   {:present? true :age-ms nil :escalated? false}))

(assert= "exactly at the bound is still fresh - the boundary is inclusive"
         :fresh (cron-heartbeat-lib/cron-heartbeat-verdict
                 {:present? true :age-ms cron-heartbeat-lib/default-bound-ms :escalated? false}))

(assert= "one millisecond past it is not"
         :stale-escalate (cron-heartbeat-lib/cron-heartbeat-verdict
                          {:present? true :age-ms (inc cron-heartbeat-lib/default-bound-ms) :escalated? false}))

(assert= "the bound is caller-supplied when given"
         :fresh (cron-heartbeat-lib/cron-heartbeat-verdict
                 {:present? true :age-ms (* 30 MIN) :bound-ms (* 60 MIN) :escalated? false}))

;; ── which verdicts are noisy ──────────────────────────────────────────────
(assert-true "a first stale escalates" (cron-heartbeat-lib/escalating? :stale-escalate))
(assert-true "a first absent escalates" (cron-heartbeat-lib/escalating? :absent-escalate))
(assert-false "a repeat does not" (cron-heartbeat-lib/escalating? :stale-already-escalated))
(assert-false "fresh does not" (cron-heartbeat-lib/escalating? :fresh))
(assert-false "unknown does not" (cron-heartbeat-lib/escalating? :unknown))

;; ── the episode flag (BL-920 self-healing) ────────────────────────────────
(assert= "escalating sets the episode flag"
         {:escalated true} (cron-heartbeat-lib/next-episode-state {} :stale-escalate))
(assert= "a fresh log clears it, so a later death is news again"
         {:escalated false} (cron-heartbeat-lib/next-episode-state {:escalated true} :fresh))
(assert= "a repeat leaves it exactly as it was"
         {:escalated true} (cron-heartbeat-lib/next-episode-state {:escalated true} :stale-already-escalated))
(assert= "and unknown never clears an episode"
         {:escalated true} (cron-heartbeat-lib/next-episode-state {:escalated true} :unknown))

;; ── the message names the age, the bound and the host fix ────────────────
(let [msg (cron-heartbeat-lib/stale-message
           {:verdict :stale-escalate :age-ms (* 42 MIN) :log-path "/x/freshness-check.cron.log"})]
  (assert-true "the message carries the sweep's own label" (clojure.string/includes? msg "cron-heartbeat-stale"))
  (assert-true "names the age" (clojure.string/includes? msg "42 minute"))
  (assert-true "names the log" (clojure.string/includes? msg "/x/freshness-check.cron.log"))
  (assert-true "names the host fix" (clojure.string/includes? msg "sudo service cron start"))
  (assert-true "and the boot line that survives a restart" (clojure.string/includes? msg "/etc/wsl.conf"))
  (assert-true "and says the swarm will not do it itself" (clojure.string/includes? msg "needs root")))

(let [msg (cron-heartbeat-lib/stale-message
           {:verdict :absent-escalate :log-path "/x/freshness-check.cron.log"})]
  (assert-true "an absent log says so rather than reporting an age of zero"
               (clojure.string/includes? msg "does not exist")))

(if (empty? @failures)
  (println "cron_heartbeat_lib: ALL TESTS PASSED")
  (do (println (str "cron_heartbeat_lib: " (count @failures) " FAILURE(S):"))
      (doseq [f @failures] (println f))
      (System/exit 1)))
