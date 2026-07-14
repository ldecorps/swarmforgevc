;; BL-349 (BL-336 finding H4): a role stuck past its escalation threshold
;; was recorded to chase-escalations.json and NOTHING ELSE - the only code
;; that emails the human about it lives in the VS Code extension host
;; (NeedsHumanEmailNotifier), so on a headless box the human is never told.
;; Reuses daemon_alarm_lib.bb's ONE shared email sender (injected as
;; :send-email!, never a second Resend client) and BL-345's own delivery-
;; based arming shape, reapplied PER-ROLE (multiple roles can independently
;; be stuck at once, each with its own retry/backoff state) - independently
;; duplicated here rather than cross-namespace-coupled to operator_lib.bb
;; (this project's own "small duplication over cross-daemon coupling"
;; convention, see operator_lib.bb's compute-alarm-backoff-ms docstring).
;;
;; Extracted into its own lib (not handoffd.bb directly) so a test runner
;; can load-file it without triggering handoffd.bb's own unconditional
;; (-main) call at the bottom of that file - the same problem
;; support_thread_store.bb's own header comment documents and solves the
;; same way.
;;
;; BL-345's absolute rule, restated for this alarm: NEVER persist "already
;; notified" before the send is attempted; NEVER compute it without
;; consulting the sender's result; a transient failure must retry
;; (bounded, with backoff) and never arm; a terminal misconfiguration warns
;; once and arms (retrying it can never help); an alarm for a silent
;; failure that itself fails silently is the whole bug BL-333 shipped and
;; BL-345 fixed - this file must not reintroduce it.
;;
;; Loaded via load-file, not required on a classpath:
;;   (load-file (str (fs/path (fs/parent *file*) "stuck_escalation_email_lib.bb")))
;; and referred to as stuck-escalation-email-lib/foo.
(ns stuck-escalation-email-lib
  (:require [babashka.fs :as fs]
            [cheshire.core :as json]))

(defn- read-json [path]
  (when (fs/exists? path)
    (try (json/parse-string (slurp (str path)) true) (catch Exception _ nil))))

;; ── durable per-role state (daemon-dir-scoped, mirrors chase_sweep_lib.bb's
;;    own chase-escalations.json posture) ─────────────────────────────────

(defn state-path [daemon-dir]
  (str (fs/path daemon-dir "chase-escalation-email-state.json")))

(defn read-state [daemon-dir]
  (or (read-json (state-path daemon-dir)) {}))

(defn write-state! [daemon-dir state]
  (spit (state-path daemon-dir) (json/generate-string state)))

;; ── pure: delivery-based arming (BL-345's shape) ─────────────────────────

(def terminal-misconfig-reasons
  "send-configured-email!'s :reason values for which retrying can never
   help. :test-fixture-suppressed is included - it must never reach the
   network and must never be treated as a real delivery failure that would
   burn a retry attempt."
  #{:disabled :missing-api-key :test-fixture-suppressed})

(defn classify-delivery-result
  "Classifies a send result map ({:success bool :reason kw? :error str?})
   into :delivered, :terminal-misconfig (retrying can never help - warn
   once, arm), or :transient-failure (a real send attempt failed with no
   :reason - retry it, bounded)."
  [{:keys [success reason]}]
  (cond
    success :delivered
    (contains? terminal-misconfig-reasons reason) :terminal-misconfig
    :else :transient-failure))

(defn compute-backoff-ms
  "Exponential backoff capped at backoff-max-ms."
  [attempt {:keys [backoff-base-ms backoff-max-ms]}]
  (long (min (* backoff-base-ms (Math/pow 2 (max 0 (dec (or attempt 1)))))
             backoff-max-ms)))

(defn should-attempt?
  "Should THIS sweep attempt to send/re-send this role's escalation email?
   Never once armed? (already delivered or terminal-warned). The FIRST
   attempt (delivery-attempts zero/nil) is always due; a RETRY after a
   transient failure is due only once the backoff computed from
   delivery-attempts has elapsed since last-attempt-at-ms."
  [{:keys [armed? delivery-attempts last-attempt-at-ms now-ms retry-config]}]
  (boolean
   (and (not armed?)
        (or (zero? (or delivery-attempts 0))
            (nil? last-attempt-at-ms)
            (>= (- now-ms last-attempt-at-ms)
                (compute-backoff-ms delivery-attempts retry-config))))))

(defn next-state
  "Given the outcome of an attempted send, computes the next persisted
   {:armed? :delivery-attempts :last-attempt-at-ms} plus :gave-up? true
   when a transient failure just exhausted the retry cap (the caller's
   cue to log the undelivered alarm loudly). :delivered and
   :terminal-misconfig both arm immediately - retrying either can never
   help. :transient-failure never arms; it increments the attempt counter
   so the next sweep's should-attempt? backs off, UNLESS the cap is
   reached, in which case it arms anyway (never retry forever) and gives
   up loudly."
  [outcome {:keys [delivery-attempts]} {:keys [max-attempts]} now-ms]
  (case outcome
    (:delivered :terminal-misconfig)
    {:armed? true :delivery-attempts 0 :last-attempt-at-ms nil :gave-up? false}

    :transient-failure
    (let [next-attempts (inc (or delivery-attempts 0))]
      (if (>= next-attempts max-attempts)
        {:armed? true :delivery-attempts 0 :last-attempt-at-ms nil :gave-up? true}
        {:armed? false :delivery-attempts next-attempts :last-attempt-at-ms now-ms :gave-up? false}))))

(defn email-text [role]
  (str "The role \"" role "\" has been stuck (holding an in-process task with no forward progress) "
       "past its escalation threshold.\n\n"
       "This is unattended - nobody has been notified until this email. Check the role's pane/log "
       "and, if needed, respawn or intervene by hand.\n\n"
       "This clears on its own once the role becomes unstuck; a NEW stuck episode after recovery "
       "will email again."))

;; ── adapter-injected orchestration ───────────────────────────────────────
;; adapters: {:send-email! (fn [subject text] -> {:success bool :reason kw? :error str?})
;;            :log! (fn [& parts])}
;;
;; Edge-triggered on the SAME escalated? edge chase_sweep_lib.bb's own
;; write-escalation! already computes - a role that STAYS stuck must not
;; re-email on every sweep (should-attempt?'s own armed?/backoff gate), and
;; a role that recovers (escalated? false) has its whole per-role state
;; entry dissoc'd so a LATER re-escalation starts fresh (unarmed,
;; zero attempts) and emails again - the exact "recovers and gets stuck
;; again is escalated again" requirement, achieved by removing the state
;; rather than tracking a separate "was previously escalated" flag.
(defn sweep!
  [role escalated? now-ms daemon-dir retry-config adapters]
  (let [state (read-state daemon-dir)
        role-key (keyword role)
        prev (get state role-key)]
    (if-not escalated?
      (when prev
        (write-state! daemon-dir (dissoc state role-key)))
      (when (should-attempt?
             {:armed? (boolean (:armed? prev))
              :delivery-attempts (:delivery-attempts prev)
              :last-attempt-at-ms (:last-attempt-at-ms prev)
              :now-ms now-ms :retry-config retry-config})
        (let [result ((:send-email! adapters) (str "SwarmForge: " role " is stuck and needs attention") (email-text role))
              outcome (classify-delivery-result result)
              {:keys [armed? delivery-attempts last-attempt-at-ms gave-up?]}
              (next-state outcome prev retry-config now-ms)]
          ((:log! adapters) "stuck-escalation-alarm" role (name outcome)
           (str "reason=" (name (or (:reason result) :none)))
           (str "gave-up=" (boolean gave-up?)))
          (write-state! daemon-dir (assoc state role-key {:armed? armed? :delivery-attempts delivery-attempts :last-attempt-at-ms last-attempt-at-ms})))))))
