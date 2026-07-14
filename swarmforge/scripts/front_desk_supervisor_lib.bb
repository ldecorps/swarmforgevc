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
;;
;; BL-303 (Defect B fix): "gave-up" was STICKY/TERMINAL and attempts never
;; reset, so a crash burst (or lifetime-accumulated isolated crashes)
;; caused a PERMANENT outage - wrong for a user-facing chat bot that must
;; self-recover. Adds healthy-uptime attempt reset + a timed give-up
;; cooldown re-arm, and moves the WHOLE per-process state machine
;; (check-one!, previously impure/inline in front_desk_supervisor.bb) into
;; this pure lib - now-ms/pid-alive?/spawn! are ALWAYS explicit/injected
;; (de0991e: never a real clock/process read inside this file), and the
;; only real I/O front_desk_supervisor.bb itself still owns is actually
;; spawning a process, checking pid liveness, and logging the returned
;; :event.
;;
;; BL-370: "is there a pid" is not proof the bot is still LISTENING - the
;; ~9h inbound outage of 2026-07-13 ran the whole way with a live pid and
;; status:running while the poll loop had silently stopped completing
;; cycles. check-one! now also treats a "running" entry whose poll
;; heartbeat has gone stale as needing the SAME bounded restart a crash
;; gets (a new :status "stalled", reusing the "waiting" recovery clause
;; verbatim) - see poll-heartbeat-stale? and check-one!'s own docstring
;; below for the shape.
(ns front-desk-supervisor-lib)

;; attempt is 1-indexed: the count of attempts made so far, including the
;; one that just crashed. Pure so the bound/backoff math is testable
;; without a real clock or a real spawned process (de0991e).

(defn compute-backoff-ms [attempt {:keys [backoff-base-ms backoff-max-ms]}]
  (long (min (* backoff-base-ms (Math/pow 2 (dec attempt))) backoff-max-ms)))

(defn decide-restart-action [attempt {:keys [max-attempts]}]
  (if (< attempt max-attempts) :restart :escalate))

;; BL-303: the cap counts CONSECUTIVE rapid crashes, not lifetime crashes -
;; a "running" child continuously alive past this window has proven it is
;; NOT in a crash loop, so its attempt count resets to 0.
(defn healthy-long-enough? [started-at-ms now-ms {:keys [healthy-reset-ms]}]
  (boolean (and started-at-ms (>= (- now-ms started-at-ms) healthy-reset-ms))))

;; BL-303: "gave-up" is a TIMED state, not terminal - once this (longer)
;; cooldown elapses the child re-arms. A crash burst that trips the cap
;; still causes a BOUNDED outage (this cooldown), never a permanent one.
(defn cooldown-elapsed? [gave-up-at-ms now-ms {:keys [giveup-cooldown-ms]}]
  (boolean (and gave-up-at-ms (>= (- now-ms gave-up-at-ms) giveup-cooldown-ms))))

(defn default-entry []
  {:pid nil :attempts 0 :status "not-started" :crashed-at-ms nil :started-at-ms nil :gave-up-at-ms nil})

;; A freshly (re)started entry - used for the very first start, a bounded
;; restart after a crash, AND a give-up cooldown re-arm (which additionally
;; resets :attempts to 0 before calling this, so the re-armed child gets a
;; full fresh attempt budget rather than instantly re-tripping the cap).
(defn- started-entry [entry now-ms pid]
  {:pid pid :attempts (inc (:attempts entry)) :status "running" :crashed-at-ms nil :started-at-ms now-ms :gave-up-at-ms nil})

;; BL-370: mirrors telegramFrontDeskBotCore.ts's own isPollCycleStale
;; independently (same "small deliberate duplication over cross-language
;; coupling" convention this project already uses for its other dual TS/bb
;; seams, e.g. the mkdir-mutex lock) - the REAL restart decision here must
;; never depend on the TS process's own event loop being alive to compute
;; it. "No completed poll within the stall window" means genuinely stuck,
;; never merely quiet - a nil last-heartbeat-ms (never yet written) counts
;; as stale too, so a bot that never got as far as its first poll cycle is
;; still caught.
(defn poll-heartbeat-stale? [last-heartbeat-ms now-ms stall-ms]
  (boolean (or (nil? last-heartbeat-ms) (>= (- now-ms last-heartbeat-ms) stall-ms))))

;; One process's whole check-and-react, pure/adapter-injected: now-ms,
;; pid-alive?, and spawn! (returns a fresh pid) are ALL explicit params -
;; no real clock or process I/O happens inside this function itself, so it
;; is directly testable with fixture entries/adapters and no real timer.
;; Returns {:entry <next-entry> :event <keyword-or-nil>} - the event is
;; the caller's own cue for what (if anything) to log; it never re-derives
;; a transition by diffing before/after itself.
;;
;; BL-370: heartbeat-stale? (optional, defaults false so every pre-existing
;; 6-arg caller/test is unaffected - the bridge process has no poll
;; heartbeat at all) is a PRECOMPUTED boolean, not a heartbeat value or a
;; clock read - the caller does that via poll-heartbeat-stale? above, kept
;; out of this function so it stays a pure function of already-known facts
;; like every other branch here. A stale-but-alive "running" entry is
;; reported as :status "stalled" (never silently folded into "waiting",
;; which would make it indistinguishable from an ordinary crash) but then
;; reuses the EXACT SAME bounded-backoff/restart/give-up clause "waiting"
;; already has - a stall and a crash recover identically, they are only
;; reported differently.
(defn check-one!
  ([entry now-ms pid-alive? spawn! restart-config giveup-config]
   (check-one! entry now-ms pid-alive? spawn! restart-config giveup-config false))
  ([entry now-ms pid-alive? spawn! restart-config giveup-config heartbeat-stale?]
   (case (:status entry)
     "not-started"
     {:entry (started-entry entry now-ms (spawn!)) :event :started}

     "running"
     (cond
       (not (pid-alive? (:pid entry)))
       {:entry (assoc entry :status "waiting" :crashed-at-ms now-ms) :event :crashed}

       heartbeat-stale?
       {:entry (assoc entry :status "stalled" :crashed-at-ms now-ms) :event :stalled}

       (and (pos? (:attempts entry)) (healthy-long-enough? (:started-at-ms entry) now-ms restart-config))
       {:entry (assoc entry :attempts 0) :event :healthy-reset}

       :else
       {:entry entry :event nil})

     ("waiting" "stalled")
     (let [due-ms (+ (:crashed-at-ms entry) (compute-backoff-ms (:attempts entry) restart-config))]
       (if (< now-ms due-ms)
         {:entry entry :event nil}
         (if (= :restart (decide-restart-action (:attempts entry) restart-config))
           {:entry (started-entry entry now-ms (spawn!)) :event :started}
           {:entry (assoc entry :status "gave-up" :gave-up-at-ms now-ms) :event :gave-up})))

     "gave-up"
     (if (cooldown-elapsed? (:gave-up-at-ms entry) now-ms giveup-config)
       {:entry (started-entry (assoc entry :attempts 0) now-ms (spawn!)) :event :re-armed}
       {:entry entry :event nil})

     {:entry entry :event nil})))
