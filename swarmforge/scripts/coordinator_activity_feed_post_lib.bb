;; GH-24 architect bounce (2026-09-06): the ticket's own "Shape" constraint
;; ("rate limiting honors 429 retry_after per the engineering guardrails")
;; was left unimplemented in the first pass. This is the SAME contract
;; extension/src/notify/telegramClient.ts's retryOnRateLimit (BL-342) already
;; ships for every other Telegram-posting surface in this codebase, ported
;; to Babashka rather than re-derived: unbounded retry on a 429 that carries
;; its own `parameters.retry_after`, an IMMEDIATE report (never retried) for
;; any other failure shape - a genuine failure can never succeed by looping
;; on it.
;;
;; Loaded via load-file:
;;   (load-file (str (fs/path (fs/parent *file*) "coordinator_activity_feed_post_lib.bb")))
;; Referred to as coordinator-activity-feed-post-lib/foo.
(ns coordinator-activity-feed-post-lib
  (:require [cheshire.core :as json]))

(defn extract-retry-after-seconds
  "Telegram's 429 body: {\"ok\":false,...,\"parameters\":{\"retry_after\":N}}.
   A number when present and numeric, nil for any other body shape (a
   non-429 failure, an unparseable body, or a 429 with no parameters at
   all - never assumed, never guessed)."
  [body-text]
  (try
    (let [parsed (json/parse-string body-text true)
          retry-after (get-in parsed [:parameters :retry_after])]
      (when (number? retry-after) retry-after))
    (catch Exception _ nil)))

(defn send-with-rate-limit-retry!
  "post-once! returns {:success bool :status int :body string}. On a 429
   whose body names retry_after, waits exactly that many seconds (via
   wait-seconds!, injected for testability - never a real sleep in a test)
   and retries the SAME call; any other failure returns false immediately,
   unretried. Mirrors retryOnRateLimit's own for(;;) shape (BL-342) - the
   loop is deliberately unbounded here too, same reasoning: giving up is
   exactly the failure this contract exists to close, and the daemon's own
   bounded subprocess chokepoint (daemon-cycle-guard-lib/sh!, 60s default)
   is the outer safety net against a truly pathological wait, not this
   loop's job to also cap."
  [post-once! wait-seconds!]
  (loop []
    (let [{:keys [success status body]} (post-once!)]
      (cond
        success true
        (= status 429)
        (if-let [retry-after (extract-retry-after-seconds body)]
          (do (wait-seconds! retry-after) (recur))
          false)
        :else false))))
