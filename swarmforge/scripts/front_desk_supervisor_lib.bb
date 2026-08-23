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
(ns front-desk-supervisor-lib
  (:require [clojure.string :as str]))

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

;; BL-582: a running child's build identity vs main's. Never FABRICATES
;; staleness when either sha is unresolvable (git unavailable, no BUILD_SHA
;; stamped yet) - the same "never invent a finding from missing data"
;; posture node-build-stale? in the supervisor itself already has, and the
;; reason a fresh checkout does not restart-loop. Pure, so the supervisor's
;; own git reads stay outside check-one! like every other fact it consumes.
(defn build-stale? [running-sha main-sha]
  (boolean (and (seq running-sha) (seq main-sha) (not= running-sha main-sha))))

;; BL-582: the grace between noticing a stale build and acting on it. A
;; merge landing mid-conversation must not yank the front desk out from
;; under the human the same second; a build stale for longer than this has
;; stopped being a race and started being the 2026-07-23 outage.
(defn build-stale-long-enough? [build-stale-since-ms now-ms {:keys [build-grace-ms]}]
  (boolean (and build-stale-since-ms build-grace-ms (>= (- now-ms build-stale-since-ms) build-grace-ms))))

(defn default-entry []
  {:pid nil :attempts 0 :status "not-started" :crashed-at-ms nil :started-at-ms nil :gave-up-at-ms nil :build-stale-since-ms nil})

;; A freshly (re)started entry - used for the very first start, a bounded
;; restart after a crash, AND a give-up cooldown re-arm (which additionally
;; resets :attempts to 0 before calling this, so the re-armed child gets a
;; full fresh attempt budget rather than instantly re-tripping the cap).
(defn- started-entry [entry now-ms pid]
  ;; BL-582: :build-stale-since-ms resets with the rest - the replacement
  ;; process reads extension/out/BUILD_SHA at ITS OWN boot, so whatever the
  ;; predecessor was running is not a fact about it.
  {:pid pid :attempts (inc (:attempts entry)) :status "running" :crashed-at-ms nil :started-at-ms now-ms
   :gave-up-at-ms nil :build-stale-since-ms nil})

;; BL-370: mirrors telegramFrontDeskBotCore.ts's own isPollCycleStale
;; independently (same "small deliberate duplication over cross-language
;; coupling" convention this project already uses for its other dual TS/bb
;; seams, e.g. the mkdir-mutex lock) - the REAL restart decision here must
;; never depend on the TS process's own event loop being alive to compute
;; it. "No completed poll within the stall window" means genuinely stuck,
;; never merely quiet - EXCEPT during startup-grace-ms after started-at-ms,
;; when a nil heartbeat is expected (first long-poll cycle not done yet).
;; BL-1043: the length of the grace a caller gets when it names a spawn time
;; but no window. 90s, the same value cursor_bridge_supervisor.bb had already
;; chosen for the only correctly-wired call site - a default that matches the
;; reference rather than inventing a third number.
(def default-startup-grace-ms 90000)

(defn poll-heartbeat-stale?
  ;; BL-1043: this used to be a 3-arity that dropped started-at-ms on the
  ;; floor as nil. The grace clause below opens with (and started-at-ms ...),
  ;; so with nil it could never fire: every caller of that arity had NO
  ;; startup grace at all. It even passed stall-ms into the grace slot, which
  ;; read like a deliberate, generous grace and was dead code never reached.
  ;; Two supervisors (onboarder, negotiation_relay) called exactly it;
  ;; onboarder-supervisor.log has a child declared stalled 2.00s after spawn
  ;; against its declared 120000ms window, 7 times in 14 adjacent
  ;; started->stalled pairs.
  ;;
  ;; So the grace-less arity is RETIRED rather than fixed in place. A caller
  ;; may omit the grace LENGTH - that defaults - but omitting the spawn time
  ;; is now an arity error at the call site instead of a silent loss of
  ;; protection that reads as correct.
  ([last-heartbeat-ms now-ms stall-ms started-at-ms]
   ;; The one remaining accidental door: (:started-at-ms entry) reads nil on
   ;; an entry that has not started yet, and supervisors compute this eagerly
   ;; for every entry each tick. There is no grace to measure from a spawn
   ;; time that does not exist, so this refuses to call the child stalled
   ;; rather than degrading back to the immediate stall that was the defect.
   ;; A caller that genuinely has no spawn time says so with the 5-arity.
   (if (nil? started-at-ms)
     false
     (poll-heartbeat-stale? last-heartbeat-ms now-ms stall-ms started-at-ms default-startup-grace-ms)))
  ([last-heartbeat-ms now-ms stall-ms started-at-ms startup-grace-ms]
   ;; BL-1035: the heartbeat is a FILE
   ;; (.swarmforge/operator/front-desk-poll-heartbeat.json), rewritten by the
   ;; bot each completed poll cycle and reset by NOBODY at spawn - grep shows a
   ;; reader and a writer and no clearer. So the timestamp a fresh child is
   ;; judged against can belong to the DEAD instance it replaced: non-nil, so
   ;; the nil-guard below never fired, and already older than the stall window,
   ;; so the replacement was condemned on its first tick. Live 2026-08-22:
   ;; started 06:13:56, "stalled" 06:13:58, respawned 06:14:02 - four seconds
   ;; per attempt against a bounded budget that escalates to a 15-minute
   ;; gave-up cooldown it never earned.
   ;;
   ;; The grace asks "has THIS child had time to speak yet", so it is decided
   ;; from facts about this child: a heartbeat written before this child
   ;; spawned was written by a different process and says nothing about it.
   ;; Comparing timestamps rather than clearing the file at spawn keeps this
   ;; correct when the file is missing, unreadable, or written by a bot that
   ;; outlived a supervisor restart - in that last case the adopted bot's next
   ;; heartbeat lands after the new started-at-ms and it self-heals.
   ;;
   ;; The waiver stays SCOPED to the grace. Once the grace ends, an absent own
   ;; heartbeat is stale exactly as a nil one always was, so this never widens
   ;; the stall check and never reintroduces BL-370's original fault.
   (let [own-heartbeat-ms (when (and last-heartbeat-ms
                                     (or (nil? started-at-ms)
                                         (>= last-heartbeat-ms started-at-ms)))
                            last-heartbeat-ms)]
     (if (and started-at-ms (nil? own-heartbeat-ms)
              (< (- now-ms started-at-ms) startup-grace-ms))
       false
       (boolean (or (nil? own-heartbeat-ms)
                    (>= (- now-ms own-heartbeat-ms) stall-ms)))))))

;; BL-1037: the same "is this heartbeat THIS child's own" fact as
;; poll-heartbeat-stale?'s own-heartbeat-ms above (a heartbeat file the bot
;; rewrites per completed poll cycle and nobody resets at spawn, so a
;; leftover heartbeat from the predecessor a fresh child was restarted onto
;; must not be read as proof this child has served) - pulled out to its own
;; pure, testable function rather than re-inlined at the one caller
;; (front_desk_supervisor.bb's child-build-served?, which only supplies the
;; two live values), so the >= boundary this shares with BL-1035's own guard
;; is exercised directly rather than only reachable through check-one!'s
;; already-resolved boolean parameter.
(defn build-served-fact? [heartbeat-ms started-at-ms]
  (boolean (and heartbeat-ms started-at-ms (>= heartbeat-ms started-at-ms))))

;; BL-582: the healthy-tick build-freshness clause, split out so the
;; "running" cond above stays readable and this decision carries its own
;; name. Three ordered states, not two: a build that has JUST gone stale
;; starts a grace (reported, never acted on), one stale past the grace is
;; restarted, and one that went fresh again inside the grace forgets it -
;; the last case is what keeps a mid-merge race from ever reaching a
;; restart at all.
(defn- build-freshness-transition [entry now-ms restart-config build-stale? build-served?]
  (cond
    (not build-stale?)
    (when (:build-stale-since-ms entry)
      {:entry (assoc entry :build-stale-since-ms nil) :event nil})

    (nil? (:build-stale-since-ms entry))
    {:entry (assoc entry :build-stale-since-ms now-ms) :event :build-stale-detected}

    (build-stale-long-enough? (:build-stale-since-ms entry) now-ms restart-config)
    ;; BL-1037: past the grace, but a child that has not yet completed a poll
    ;; cycle on the build it was restarted ONTO has not bought anything yet.
    ;; Restarting it again spends a recompile, a respawn and a Telegram
    ;; conflict window (BL-1036) to replace a build that never served - which
    ;; is how 24 staleness detections became 12 respawns in 105 minutes while
    ;; main kept moving.
    ;;
    ;; The debt is CARRIED, not cleared: `:build-stale-since-ms` is left
    ;; exactly as it was, so the moment this child serves, the restart it is
    ;; already owed fires and lands on main's newest build. Clearing it here
    ;; would reintroduce the 2h23m stale window BL-582 exists to close, which
    ;; is why invariant 1 is stated as a property rather than a scenario.
    (if build-served?
      {:entry (assoc entry :status "stale-build" :crashed-at-ms now-ms) :event :build-stale}
      {:entry entry :event :build-stale-deferred})

    :else
    {:entry entry :event nil}))

;; One process's whole check-and-react, pure/adapter-injected: now-ms,
;; pid-alive?, spawn!, and kill-pid! (returns a fresh pid) are ALL
;; explicit params - no real clock or process I/O happens inside this
;; function itself, so it is directly testable with fixture entries/adapters
;; and no real timer. Returns {:entry <next-entry> :event <keyword-or-nil>}
;; - the event is the caller's own cue for what (if anything) to log; it
;; never re-derives a transition by diffing before/after itself.
;;
;; BL-403: kill-pid! (optional, defaults to no-op) is called with the old
;; pid before spawning a replacement in "waiting"/"stalled" restart cases,
;; AND in the "gave-up" -> re-armed cooldown case - a gave-up entry's pid
;; can still be alive ("stalled" is entered from "running" without ever
;; checking pid-alive?), so the re-arm spawn needs the same guard the
;; ordinary restart path has. This ensures the old process is terminated
;; with bounded grace period (SIGTERM -> SIGKILL) before the replacement
;; spawns, so exactly one bot process is ever alive per supervisor at a
;; time.
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
   (check-one! entry now-ms pid-alive? spawn! restart-config giveup-config false (fn [_] nil) false))
  ([entry now-ms pid-alive? spawn! restart-config giveup-config heartbeat-stale?]
   (check-one! entry now-ms pid-alive? spawn! restart-config giveup-config heartbeat-stale? (fn [_] nil) false))
  ([entry now-ms pid-alive? spawn! restart-config giveup-config heartbeat-stale? kill-pid!]
   (check-one! entry now-ms pid-alive? spawn! restart-config giveup-config heartbeat-stale? kill-pid! false))
  ([entry now-ms pid-alive? spawn! restart-config giveup-config heartbeat-stale? kill-pid! build-stale?]
   ;; BL-1037: defaults TRUE, so a caller that does not know whether its child
   ;; has served keeps BL-582's behaviour byte-for-byte. Only a caller that can
   ;; actually observe serving opts into the bound - defaulting FALSE would
   ;; silently disable the watchdog for every child that never passes it.
   (check-one! entry now-ms pid-alive? spawn! restart-config giveup-config heartbeat-stale? kill-pid! build-stale? true))
  ([entry now-ms pid-alive? spawn! restart-config giveup-config heartbeat-stale? kill-pid! build-stale? build-served?]
   (case (:status entry)
     "not-started"
     {:entry (started-entry entry now-ms (spawn!)) :event :started}

     "running"
     ;; BL-582: computed once up front (pure, no I/O) so the cond below can
     ;; test and return the same value without calling twice.
     (let [freshness (build-freshness-transition entry now-ms restart-config build-stale? build-served?)]
       (cond
         (not (pid-alive? (:pid entry)))
         {:entry (assoc entry :status "waiting" :crashed-at-ms now-ms) :event :crashed}

         heartbeat-stale?
         {:entry (assoc entry :status "stalled" :crashed-at-ms now-ms) :event :stalled}

         (and (pos? (:attempts entry)) (healthy-long-enough? (:started-at-ms entry) now-ms restart-config))
         {:entry (assoc entry :attempts 0) :event :healthy-reset}

         ;; Checked LAST: a crash and a stall are outages happening now, and
         ;; a healthy-reset is bookkeeping that fires at most once per
         ;; process (attempts drops to 0 and the clause stops matching), so
         ;; deferring the stale-build report by a single tick costs nothing
         ;; against a grace measured in minutes - while letting it preempt
         ;; the reset would have starved that clause on every branch build.
         freshness
         freshness

         :else
         {:entry entry :event nil}))

     ("waiting" "stalled" "stale-build")
     (let [due-ms (+ (:crashed-at-ms entry) (compute-backoff-ms (:attempts entry) restart-config))]
       (if (< now-ms due-ms)
         {:entry entry :event nil}
         (if (= :restart (decide-restart-action (:attempts entry) restart-config))
           (do
             (when (:pid entry) (kill-pid! (:pid entry)))
             {:entry (started-entry entry now-ms (spawn!)) :event :started})
           {:entry (assoc entry :status "gave-up" :gave-up-at-ms now-ms) :event :gave-up})))

     "gave-up"
     (if (or (cooldown-elapsed? (:gave-up-at-ms entry) now-ms giveup-config)
             (and (:pid entry) (not (pid-alive? (:pid entry)))))
       (do
         (when (:pid entry) (kill-pid! (:pid entry)))
         {:entry (started-entry (assoc entry :attempts 0) now-ms (spawn!)) :event :re-armed})
       {:entry entry :event nil})

     {:entry entry :event nil})))

;; BL-411: kill-pid! itself (as opposed to WHEN check-one! calls it, decided
;; above) is real process I/O - SIGTERM, a bounded busy-wait, then SIGKILL -
;; unlike every function above this comment, which is pure and takes now-ms/
;; pid-alive?/spawn!/kill-pid! as injected params. front_desk_supervisor.bb
;; (BL-403) and negotiation_relay_supervisor.bb (BL-411) each supervise a
;; single child process with the IDENTICAL termination semantics, differing
;; only in their configured grace period, so this constructor is the one
;; shared copy both callers build their kill-pid! adapter from - a second,
;; hand-rolled ProcessHandle SIGTERM/SIGKILL copy in the relay supervisor
;; would silently drift from this one the next time either needs a fix.
;; BL-789 (2026-08-02 Mac host-switch hotfix): the bridge EADDRINUSE crash
;; loop - an orphan start-bridge-headless.js held the port while our tracked
;; pid was dead, so every tick's respawn attempt failed with EADDRINUSE,
;; gave up, and re-armed, over and over. Adoption must verify HEALTH, not
;; just a listening socket - a stale/hung process holding the port is not
;; safe to adopt just because its cmdline matches ours.
(defn bridge-entrypoint-holder?
  "True when cmdline looks like OUR OWN start-bridge-headless.js entrypoint
   for THIS project-root - both the entrypoint pattern AND project-root must
   appear, not just the first. A port collision between two independent
   swarms on the same host would otherwise pass the entrypoint check alone
   (the other swarm's bridge is a REAL start-bridge-headless.js too) and
   wrongly adopt a process that answers for a different repo entirely -
   mirrors start_bridge_headless.sh's own established `*\"$ROOT\"*` orphan
   check for exactly this reason."
  [cmdline project-root]
  (boolean (and cmdline
                (str/includes? cmdline "start-bridge-headless")
                (str/includes? cmdline project-root))))

(defn decide-bridge-port-action
  "holder: {:pid <n> :cmdline <str-or-nil>} describing whatever process (if
   any) currently holds the bridge port, or nil when nothing does. healthy?:
   a PRECOMPUTED boolean - the caller already probed the holder (e.g. an
   HTTP round-trip against its own health route) - this function performs
   no I/O of its own, same pure/adapter-injected convention as check-one!'s
   own heartbeat-stale?. project-root: this swarm's own root, checked
   against the holder's cmdline so a same-port collision with an unrelated
   swarm is never adopted.
   Returns :spawn (nothing on the port - proceed with our own spawn),
   :adopt (a healthy bridge of our own already holds it - use its pid, no
   new process), or :free (an unrelated process, another swarm's own
   bridge, or an unhealthy bridge, holds it - free the port, then spawn)."
  [holder healthy? project-root]
  (cond
    (nil? holder) :spawn
    (and (bridge-entrypoint-holder? (:cmdline holder) project-root) healthy?) :adopt
    :else :free))

;; BL-928: onboarder-reconcile poll-loop orphan reap -------------------------
;; check-one!'s "not-started" branch above (line ~125) is a bare spawn! with
;; no kill-pid! - BL-403/BL-411 deliberately left it out of scope, so nothing
;; in this state machine ever removes a sibling left behind when a
;; supervisor dies without running its own stop path (SIGKILL, crash, a host
;; kill). This is a ONE-TIME STARTUP sweep, not a check-one! branch: it runs
;; once before the first tick, over the whole process table, never per-tick
;; (BL-367 - no live-process hunting on the hot path).
(defn onboarder-reconcile-poll-loop-holder?
  "True when cmdline looks like OUR OWN onboarder-reconcile.js poll-loop for
   THIS project-root - the entrypoint, 'poll-loop', AND project-root must all
   appear, not just one. Mirrors bridge-entrypoint-holder?'s own two-part
   cmdline check for the identical reason: a poll-loop naming a different
   swarm root, including a tmp fixture root, is never mistaken for ours
   (invariant 2)."
  [cmdline project-root]
  (boolean (and cmdline
                (str/includes? cmdline "onboarder-reconcile.js")
                (str/includes? cmdline "poll-loop")
                (str/includes? cmdline project-root))))

(defn decide-onboarder-orphan-reap
  "processes: process-table-lib/list-processes!'s own return - nil when the
   table could not be enumerated, a vector of {:pid :cmdline} otherwise
   (BL-849's distinction, preserved here rather than coerced away).
   parent-orphaned?: injected (process-table-lib/parent-orphaned? in
   production) so this stays pure, no real process I/O inside.

   Returns {:reapable [pid ...] :unreadable? bool}. :unreadable? true means
   the process table itself could not be read - :reapable is always [] in
   that case, and the two must never be conflated (invariant 3: an
   unreadable table is not the same fact as a genuinely empty candidate
   set). A process whose parent is alive is never a candidate (invariant 1)
   - the running supervisor's own child has a live parent by construction,
   so it can never appear in :reapable regardless of cmdline match."
  [processes project-root parent-orphaned?]
  (if (nil? processes)
    {:reapable [] :unreadable? true}
    {:reapable (->> processes
                    (filter #(onboarder-reconcile-poll-loop-holder? (:cmdline %) project-root))
                    (map :pid)
                    (filter parent-orphaned?)
                    vec)
     :unreadable? false}))

(defn make-kill-pid! [grace-ms]
  (fn [pid]
    (when pid
      (when-let [handle (some-> (java.lang.ProcessHandle/of pid) (.orElse nil))]
        (when (.isAlive handle)
          ;; SIGTERM for graceful shutdown
          (.destroy handle)
          ;; Wait for graceful exit within the grace period
          (let [start (System/currentTimeMillis)]
            (while (and (.isAlive handle) (< (- (System/currentTimeMillis) start) grace-ms))
              (Thread/sleep 10)))
          ;; SIGKILL if still alive after grace period
          (when (.isAlive handle)
            (.destroyForcibly handle))
          ;; Wait for the kill to propagate
          (Thread/sleep 10))))))
