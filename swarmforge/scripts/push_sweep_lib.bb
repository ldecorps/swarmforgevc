;; BL-356: twice in one day local `main` accumulated hours of committed work
;; that never reached origin - nothing in the swarm ever pushes; publication
;; depended entirely on an LLM role remembering to run `git push`, and that
;; silently failed to happen. This lib is the pure decision/state logic for
;; a periodic "does main need publishing?" sweep, kept reachable without a
;; real git process, network, or clock (constitution testability boundary) -
;; only the thin adapter handoffd.bb wires this to real `git`/
;; daemon_alarm_lib.bb calls.
;;
;; Two independent concerns, two independent state machines:
;;   - push-attempt backoff (next-push-state): NEVER permanently gives up -
;;     main must keep trying to reach origin indefinitely. It only paces
;;     itself with capped backoff so a flaky network is not hammered every
;;     sweep tick. `:exhausted?` tells the caller the bounded retry budget
;;     for THIS failure episode is used up - the cue to also consider
;;     alarming, not a signal to stop retrying.
;;   - alarm-delivery arming (next-alarm-state): BL-345's shape (own small
;;     copy - see stuck_escalation_email_lib.bb's own header comment for why
;;     this project duplicates this shape per-caller instead of coupling
;;     across files). Gates ONLY whether the alarm email is re-sent, never
;;     whether pushing keeps being retried.
;;
;; Loaded via load-file, not required on a classpath:
;;   (load-file (str (fs/path (fs/parent *file*) "push_sweep_lib.bb")))
;; and referred to as push-sweep-lib/foo.
(ns push-sweep-lib
  (:require [babashka.fs :as fs]
            [cheshire.core :as json]))

(defn- read-json [path]
  (when (fs/exists? path)
    (try (json/parse-string (slurp (str path)) true) (catch Exception _ nil))))

;; ── durable state (daemon-dir-scoped, mirrors stuck_escalation_email_lib.bb's
;;    own state-file posture) ──────────────────────────────────────────────

(defn state-path [daemon-dir]
  (str (fs/path daemon-dir "push-sweep-state.json")))

(defn read-state [daemon-dir]
  (or (read-json (state-path daemon-dir)) {}))

(defn write-state! [daemon-dir state]
  (spit (state-path daemon-dir) (json/generate-string state)))

;; ── pure: what should this sweep do, given local main's ahead/behind
;;    counts against origin/main? Divergence (ahead>0 AND behind>0) is
;;    exactly the case a plain `git push` would reject as non-fast-forward -
;;    it must never be force-pushed over. `ahead` zero means nothing of
;;    local's is unpublished, regardless of behind (this sweep only PUSHES,
;;    it never pulls). ───────────────────────────────────────────────────
(defn push-decision
  [{:keys [ahead behind]}]
  (let [ahead (or ahead 0)
        behind (or behind 0)]
    (cond
      (zero? ahead) :nothing-to-push
      (pos? behind) :diverged
      :else :should-push)))

;; ── pure: bounded exponential backoff, shared by both state machines below
;;    (own small copy, not required from stuck_escalation_email_lib.bb/
;;    operator_lib.bb - this project's established small-duplication-over-
;;    cross-file-coupling convention; see stuck_escalation_email_lib.bb's own
;;    header comment). ───────────────────────────────────────────────────
(defn compute-backoff-ms
  [attempts {:keys [backoff-base-ms backoff-max-ms]}]
  (long (min (* backoff-base-ms (Math/pow 2 (max 0 (dec (or attempts 1)))))
             backoff-max-ms)))

(defn due?
  "Is a retry/attempt due, given how many attempts have already happened and
   when the last one was? Never attempted (attempts zero, or no timestamp
   yet) is always due."
  [{:keys [attempts last-attempt-at-ms now-ms retry-config]}]
  (boolean
   (or (zero? (or attempts 0))
       (nil? last-attempt-at-ms)
       (>= (- now-ms last-attempt-at-ms)
           (compute-backoff-ms attempts retry-config)))))

;; ── pure: push-attempt state machine ──────────────────────────────────────
(defn next-push-state
  [outcome {:keys [attempts]} {:keys [max-push-attempts]} now-ms]
  (case outcome
    :pushed
    {:attempts 0 :last-attempt-at-ms nil :exhausted? false}

    :transient-failure
    (let [next-attempts (inc (or attempts 0))]
      {:attempts next-attempts
       :last-attempt-at-ms now-ms
       :exhausted? (>= next-attempts max-push-attempts)})))

;; ── pure: alarm-delivery state machine (BL-345's shape) ──────────────────
(def terminal-misconfig-reasons
  "send-configured-email!'s :reason values for which retrying can never
   help - identical set to stuck_escalation_email_lib.bb's own."
  #{:disabled :missing-api-key :test-fixture-suppressed})

(defn classify-send-result
  [{:keys [success reason]}]
  (cond
    success :delivered
    (contains? terminal-misconfig-reasons reason) :terminal-misconfig
    :else :transient-failure))

(defn next-alarm-state
  [outcome {:keys [attempts]} {:keys [max-alarm-attempts]} now-ms]
  (case outcome
    (:delivered :terminal-misconfig)
    {:armed? true :attempts 0 :last-attempt-at-ms nil :gave-up? false}

    :transient-failure
    (let [next-attempts (inc (or attempts 0))]
      (if (>= next-attempts max-alarm-attempts)
        {:armed? true :attempts 0 :last-attempt-at-ms nil :gave-up? true}
        {:armed? false :attempts next-attempts :last-attempt-at-ms now-ms :gave-up? false}))))

(defn- alarm-due?
  [alarm-state now-ms retry-config]
  (and (not (:armed? alarm-state))
       (due? {:attempts (:attempts alarm-state)
              :last-attempt-at-ms (:last-attempt-at-ms alarm-state)
              :now-ms now-ms :retry-config retry-config})))

;; ── adapter-injected orchestration ───────────────────────────────────────
;; adapters: {:rev-counts!            (fn [] -> {:ahead int :behind int})
;;            :push!                  (fn [] -> {:success bool :error str?})
;;            :send-push-alarm!       (fn [attempts] -> {:success bool :reason kw? :error str?})
;;            :send-divergence-alarm! (fn [ahead behind] -> {:success bool :reason kw? :error str?})
;;            :log!                   (fn [& parts])}
;;
;; Fully self-healing across every transition, not only the two terminal
;; ones: once origin catches up (:nothing-to-push) or a push actually lands
;; (:pushed), ALL persisted state (push backoff, push alarm, divergence
;; alarm) is cleared. The two NON-terminal cross-transitions are handled too
;; (BL-356 architect bounce, 20260714) - entering :diverged clears a stale
;; :should-push :alarm flag, and returning from :diverged to :should-push
;; clears a stale :divergence flag - so a flag armed by one episode can
;; never survive to silently suppress a later, unrelated episode of the
;; OTHER kind. A LATER failure episode always starts fresh and alarms
;; again, the same "recovers and gets stuck again is escalated again" shape
;; stuck_escalation_email_lib.bb's own sweep! uses for role recovery.
(defn sweep!
  [now-ms daemon-dir retry-config adapters]
  (let [state (read-state daemon-dir)
        counts ((:rev-counts! adapters))
        decision (push-decision counts)]
    (case decision
      :nothing-to-push
      (do
        ((:log! adapters) "push-sweep" "up-to-date")
        (when (seq state) (write-state! daemon-dir {})))

      :diverged
      ;; BL-356 architect bounce: a stale ARMED :alarm (push-failure) flag
      ;; must not survive into a divergence episode - it belongs to a
      ;; different, possibly-unrelated failure and must not silently
      ;; suppress a LATER :should-push alarm once this divergence resolves.
      ;; Cleared unconditionally on entry (and every tick while diverged,
      ;; harmlessly idempotent once already {}), never only when this
      ;; tick's OWN divergence alarm happens to fire.
      (let [state (if (seq (:alarm state)) (assoc state :alarm {}) state)
            alarm-state (or (:divergence state) {})]
        (if (alarm-due? alarm-state now-ms retry-config)
          (let [result ((:send-divergence-alarm! adapters) (:ahead counts) (:behind counts))
                outcome (classify-send-result result)
                next-alarm (next-alarm-state outcome alarm-state retry-config now-ms)]
            ((:log! adapters) "push-sweep" "diverged" (name outcome))
            (write-state! daemon-dir (assoc state :divergence next-alarm :push {})))
          (do
            ((:log! adapters) "push-sweep" "diverged-already-alarmed")
            (write-state! daemon-dir state))))

      :should-push
      ;; Two independent cadences, checked on every tick: whether it's time
      ;; to retry the PUSH itself (push-state's own backoff), and - fully
      ;; decoupled from that - whether it's time to (re)send the ALARM once
      ;; the push retry budget is exhausted (alarm-state's own backoff). A
      ;; tick where the push is still backing off must still be free to
      ;; retry a not-yet-delivered alarm, and vice versa.
      ;;
      ;; BL-356 architect bounce: a stale ARMED :divergence flag must not
      ;; survive a return from :diverged back to :should-push - it belongs
      ;; to a resolved (or unrelated) divergence episode and must not
      ;; silently suppress a NEW divergence alarm later. Cleared
      ;; unconditionally here; every write below persists this cleared
      ;; value along with whatever :push/:alarm updates this tick makes.
      (let [state (if (seq (:divergence state)) (assoc state :divergence {}) state)
            push-state (or (:push state) {})
            push-due? (due? {:attempts (:attempts push-state)
                             :last-attempt-at-ms (:last-attempt-at-ms push-state)
                             :now-ms now-ms :retry-config retry-config})
            push-state' (if-not push-due?
                          (do ((:log! adapters) "push-sweep" "push-backoff-wait") push-state)
                          (let [result ((:push! adapters))]
                            (if (:success result)
                              (do ((:log! adapters) "push-sweep" "pushed") nil)
                              (let [next-push (next-push-state :transient-failure push-state retry-config now-ms)]
                                ((:log! adapters) "push-sweep" "push-failed" (str "attempts=" (:attempts next-push)))
                                next-push))))]
        (if (nil? push-state')
          (write-state! daemon-dir {})
          (let [alarm-state (or (:alarm state) {})]
            (if (and (:exhausted? push-state') (alarm-due? alarm-state now-ms retry-config))
              (let [alarm-result ((:send-push-alarm! adapters) (:attempts push-state'))
                    alarm-outcome (classify-send-result alarm-result)
                    next-alarm (next-alarm-state alarm-outcome alarm-state retry-config now-ms)]
                ((:log! adapters) "push-sweep" "push-alarm" (name alarm-outcome))
                (write-state! daemon-dir (assoc state :push push-state' :alarm next-alarm)))
              (write-state! daemon-dir (assoc state :push push-state')))))))))
