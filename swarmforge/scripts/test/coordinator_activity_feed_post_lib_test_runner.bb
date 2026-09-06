#!/usr/bin/env bb
;; TDD runner for coordinator_activity_feed_post_lib.bb (GH-24 architect
;; bounce, 2026-09-06: Telegram 429 retry_after not honored). No real
;; Telegram, no real sleep - post-once! and wait-seconds! are both stubs.

(ns coordinator-activity-feed-post-lib-test-runner
  (:require [babashka.fs :as fs]
            [cheshire.core :as json]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "coordinator_activity_feed_post_lib.bb")))

(def failures (atom []))

(defn assert= [msg expected actual]
  (when (not= expected actual)
    (swap! failures conj (str "FAIL: " msg "\n  expected: " (pr-str expected) "\n  actual:   " (pr-str actual)))))

;; ── extract-retry-after-seconds (pure) ───────────────────────────────────

(assert= "a real 429 body yields its retry_after"
         26
         (coordinator-activity-feed-post-lib/extract-retry-after-seconds
          (json/generate-string {:ok false :error_code 429 :description "Too Many Requests: retry after 26"
                                  :parameters {:retry_after 26}})))

(assert= "a non-429 body with no parameters yields nil"
         nil
         (coordinator-activity-feed-post-lib/extract-retry-after-seconds
          (json/generate-string {:ok false :error_code 400 :description "Bad Request"})))

(assert= "unparseable JSON yields nil, never throws"
         nil
         (coordinator-activity-feed-post-lib/extract-retry-after-seconds "not json at all {{{"))

(assert= "a non-numeric retry_after yields nil"
         nil
         (coordinator-activity-feed-post-lib/extract-retry-after-seconds
          (json/generate-string {:parameters {:retry_after "soon"}})))

;; ── send-with-rate-limit-retry! ──────────────────────────────────────────

(defn run-with-script
  "script: a vector of {:success :status :body} maps, one per post-once!
   call - the Nth call returns the Nth entry (clamped to the last entry if
   post-once! is called more times than scripted, which would itself be a
   test bug worth surfacing loudly rather than silently)."
  [script]
  (let [calls (atom 0)
        waits (atom [])
        post-once! (fn []
                     (let [i (min @calls (dec (count script)))]
                       (swap! calls inc)
                       (nth script i)))
        wait-seconds! (fn [seconds] (swap! waits conj seconds))
        result (coordinator-activity-feed-post-lib/send-with-rate-limit-retry! post-once! wait-seconds!)]
    {:result result :call-count @calls :waits @waits}))

(let [{:keys [result call-count waits]} (run-with-script [{:success true :status 200 :body ""}])]
  (assert= "success on the first attempt: true, one call, no wait" true result)
  (assert= "success on the first attempt: exactly one post-once! call" 1 call-count)
  (assert= "success on the first attempt: wait-seconds! never called" [] waits))

(let [body-429 (json/generate-string {:parameters {:retry_after 5}})
      {:keys [result call-count waits]} (run-with-script
                                          [{:success false :status 429 :body body-429}
                                           {:success true :status 200 :body ""}])]
  (assert= "429 then success: retries and succeeds" true result)
  (assert= "429 then success: exactly two post-once! calls" 2 call-count)
  (assert= "429 then success: waited exactly the told retry_after, once" [5] waits))

(let [body-429 (json/generate-string {:parameters {:retry_after 2}})
      {:keys [result call-count waits]} (run-with-script
                                          [{:success false :status 429 :body body-429}
                                           {:success false :status 429 :body body-429}
                                           {:success false :status 429 :body body-429}
                                           {:success true :status 200 :body ""}])]
  (assert= "three consecutive 429s then success: still eventually true" true result)
  (assert= "three consecutive 429s then success: four post-once! calls total" 4 call-count)
  (assert= "three consecutive 429s then success: waited three times, each the told duration" [2 2 2] waits))

(let [{:keys [result call-count waits]} (run-with-script [{:success false :status 500 :body "{}"}])]
  (assert= "a genuine (non-429) failure: reports false immediately" false result)
  (assert= "a genuine (non-429) failure: never retried - exactly one call" 1 call-count)
  (assert= "a genuine (non-429) failure: never waits" [] waits))

(let [{:keys [result call-count waits]} (run-with-script [{:success false :status 429 :body "{}"}])]
  (assert= "a 429 with NO retry_after in its body: reports false, never loops forever" false result)
  (assert= "a 429 with no retry_after: exactly one call, not retried blindly" 1 call-count)
  (assert= "a 429 with no retry_after: never waits" [] waits))

(when (seq @failures)
  (doseq [f @failures] (println f))
  (System/exit 1))

(println "ALL PASS: coordinator_activity_feed_post_lib.bb")
