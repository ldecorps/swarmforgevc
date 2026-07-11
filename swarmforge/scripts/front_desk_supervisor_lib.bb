;; BL-292: pure bounded-restart-with-backoff decision for the headless
;; Telegram front-desk supervisor (bridge + Front Desk Bot). Mirrors
;; extension/src/notify/telegramRetry.ts's own
;; computeTelegramRetryBackoffMs/decideTelegramRetryAction pair - this
;; project's established "bounded-retry-then-escalate" convention
;; (telegramRetry.ts's own docstring cites wedgedRespawn.ts/
;; inboxChaser.ts as the SAME shape) - translated to Babashka so the
;; supervisor loop that spawns/respawns the two Node child processes stays
;; in one language throughout, matching handoffd_supervisor.bb's own
;; pid-file/stop-file/loop conventions. Deliberately NOT
;; handoffd_supervisor.bb's own policy (that supervisor does zero
;; auto-restart by design, BL-144 - alarm-and-halt, human-recovery-only);
;; this ticket explicitly wants bounded restart, a different policy for a
;; different kind of process.
(ns front-desk-supervisor-lib)

;; attempt is 1-indexed: the count of attempts made so far, including the
;; one that just crashed. Pure so the bound/backoff math is testable
;; without a real clock or a real spawned process (de0991e).

(defn compute-backoff-ms [attempt {:keys [backoff-base-ms backoff-max-ms]}]
  (long (min (* backoff-base-ms (Math/pow 2 (dec attempt))) backoff-max-ms)))

(defn decide-restart-action [attempt {:keys [max-attempts]}]
  (if (< attempt max-attempts) :restart :escalate))
