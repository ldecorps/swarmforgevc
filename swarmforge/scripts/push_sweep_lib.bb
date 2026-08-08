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
            [cheshire.core :as json]
            [clojure.string :as str]))

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

;; ── BL-630: push-sweep refuses to publish a `main` tip that is not
;;    QA-approved ────────────────────────────────────────────────────────
;; BL-590 post-mortem: publish-time (this sweep reaching origin), not
;; deploy-time (BL-629's sync gate), is what made that incident
;; irreversible. Mirrors BL-629's own gate shape
;; (build_freshness_lib.bb/sync-gate-decision) at the publish boundary
;; instead - "unknown fails closed, a bookkeeping-only allowlist, explicit
;; offending shas" - kept as its own small copy per this project's
;; established small-duplication-over-cross-file-coupling convention (see
;; this file's own header comment), because the two gates check different
;; refs (swarmforge-QA ancestry of the PUSH tip here vs. drift since the
;; last QA-landed commit there) and must be free to diverge independently.
(defn bookkeeping-only-path?
  [path]
  (boolean
   (and path
        (or (str/starts-with? path "backlog/")
            (str/starts-with? path "docs/")
            (str/starts-with? path "swarmforge/")))))

(defn commit-bookkeeping-only?
  "A commit whose changed-paths are empty or unknown is NOT bookkeeping-
   only - an empty/unknown change set never earns the allowlist, the same
   conservative-refusal posture facts-complete? uses below."
  [changed-paths]
  (boolean (and (seq changed-paths) (every? bookkeeping-only-path? changed-paths))))

(defn qa-gate-decision
  "Pure decision: may push-sweep publish this tip? facts:
     :qa-ref-exists?        bool - whether swarmforge-QA resolves at all
     :tip-is-qa-ancestor?   bool - `git merge-base --is-ancestor <main-tip>
                            swarmforge-QA`, the fast path: when true, NO
                            ahead-commit enumeration is needed at all (a
                            QA-approved tip publishes with no added
                            latency - the CLI adapter never even gathers
                            :ahead-commits for this case).
     :ahead-commits         seq of {:sha :qa-ancestor? :changed-paths :merge?},
                            the commits about to be pushed (origin/main..
                            main), each pre-tagged by the CLI - only
                            populated/consulted when tip-is-qa-ancestor?
                            is false. :merge? true means this sha has 2+
                            parents; its :changed-paths is the CLI's
                            *combined* diff (`git diff-tree -c`), which is
                            empty ONLY for a trivial merge (its tree is
                            fully reconstructible from its parents - every
                            real content-bearing commit it folds in already
                            appears as its own entry in this same seq with
                            its own accurate :qa-ancestor?/:changed-paths,
                            so re-scrutinizing a trivial merge's own diff
                            would just re-flag already-checked content
                            against whichever parent it differs from and
                            falsely refuse a routine, fully QA-approved
                            landing). A NON-empty combined diff on a merge
                            means the merge itself carries content absent
                            from every parent - typically a hand-resolved
                            conflict - which was never independently
                            reviewed and is not covered by any other
                            entry in this seq, so it is scrutinized exactly
                            like a non-merge commit's :changed-paths (BL-630
                            bounce #2, 2026-07-30: the original :merge? ->
                            always-exempt rule waved this class through
                            unchecked; see backlog/evidence/BL-630-push-
                            sweep-refuses-non-qa-approved-main-bounce-
                            20260730-2.md).
     :facts-complete?       bool, default true - false when the CLI could
                            not gather the facts above (a merge-base/rev-
                            list/diff-tree failure); fails closed exactly
                            like BL-629's own gather-failed, never
                            fabricating an approved answer from a gap.
   Returns {:refuse? :reason (:gather-failed/:missing-ref/:non-qa-ancestor/
            nil) :offending-shas}."
  [{:keys [qa-ref-exists? tip-is-qa-ancestor? ahead-commits facts-complete?]
    :or {facts-complete? true}}]
  (cond
    (not facts-complete?)
    {:refuse? true :reason :gather-failed :offending-shas []}

    (not qa-ref-exists?)
    {:refuse? true :reason :missing-ref :offending-shas []}

    tip-is-qa-ancestor?
    {:refuse? false :reason nil :offending-shas []}

    :else
    (let [trivial-merge? (fn [{:keys [merge? changed-paths]}] (and merge? (empty? changed-paths)))
          offending (remove #(or (:qa-ancestor? %) (trivial-merge? %)) ahead-commits)
          non-bookkeeping (remove #(commit-bookkeeping-only? (:changed-paths %)) offending)]
      (if (seq non-bookkeeping)
        {:refuse? true :reason :non-qa-ancestor :offending-shas (mapv :sha non-bookkeeping)}
        {:refuse? false :reason nil :offending-shas []}))))

;; ── BL-855: no-op landing merge detector, a SIBLING check to qa-gate-
;;    decision above - a merge is authorized by qa-gate-decision (who
;;    approved its second parent) and validated by ancestry (both parents
;;    genuinely present); neither asks whether the merge actually TOOK
;;    anything. f28a84ad passed both and landed zero of the 108 files its
;;    QA-approved second parent offered - a `git merge -s ours`-shaped
;;    no-op that recorded correct ancestry and an accurate-sounding
;;    message while silently discarding all of it. ─────────────────────────
(defn noop-landing-merge?
  "True when a merge commit's second parent offered content its first
   parent lacked, but the merge's own tree took none of it (byte-identical
   to the first parent's tree). A merge whose second parent offered
   NOTHING (already an ancestor, or zero differing paths) is never
   flagged - measured: 2 of the 4 tree-equal merges in a 400-merge sample
   were exactly this harmless shape, and a gate that cries wolf on them
   gets switched off. Deliberately excludes a PARTIAL drop (some paths
   taken, others dropped) - a real but much harder-to-judge risk neither
   measured incident matched."
  [{:keys [merge? tree-equals-parent1? offered-paths]}]
  (boolean (and merge? tree-equals-parent1? (seq offered-paths))))

(defn noop-merge-decision
  "Pure decision, sibling of qa-gate-decision: does any commit about to be
   pushed silently discard content its second parent offered? Consulted
   independently of qa-gate-decision, and before it, so a merge whose
   second parent is genuinely QA-approved is still refused - authorization
   is not effect. facts:
     :ahead-commits    seq of {:sha :merge? :second-parent-sha
                       :offered-paths :tree-equals-parent1?} - the commits
                       about to be pushed. A non-merge entry has :merge?
                       false and no other keys populated.
     :facts-complete?  bool, default true - false when the CLI could not
                       gather the facts above; fails closed exactly like
                       qa-gate-decision's own :gather-failed, never
                       fabricating a clean answer from a gap.
   Returns {:refuse? bool :reason (:gather-failed/:noop-landing-merge/nil)
            :offending (seq of {:sha :second-parent-sha :dropped-count})}."
  [{:keys [ahead-commits facts-complete?] :or {facts-complete? true}}]
  (if-not facts-complete?
    {:refuse? true :reason :gather-failed :offending []}
    (let [hits (filter noop-landing-merge? ahead-commits)]
      (if (seq hits)
        {:refuse? true :reason :noop-landing-merge
         :offending (mapv (fn [h] {:sha (:sha h)
                                    :second-parent-sha (:second-parent-sha h)
                                    :dropped-count (count (:offered-paths h))})
                           hits)}
        {:refuse? false :reason nil :offending []}))))

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
;;            :qa-gate-facts!         (fn [] -> qa-gate-decision's own facts map, BL-630) -
;;                                    called ONLY when push-decision is :should-push, never
;;                                    on :nothing-to-push/:diverged ticks
;;            :noop-merge-gate-facts! (fn [] -> noop-merge-decision's own facts map, BL-855) -
;;                                    called ONLY when push-decision is :should-push, BEFORE
;;                                    :qa-gate-facts! - unlike the QA gate this check has no
;;                                    tip-is-ancestor fast path, since a no-op merge can itself
;;                                    be a QA-ref ancestor while having taken none of its
;;                                    second parent's content (authorization is not effect)
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
        ;; BL-630 notes: ahead=0 with behind>0 (nothing of local's is
        ;; unpublished, but origin has moved on) must never read as the
        ;; same "up-to-date" a genuinely synced tip gets - this sweep only
        ;; pushes, it never pulls, so a persistently-behind local main
        ;; would otherwise stay silently invisible indefinitely (exactly
        ;; the state a prior incident's self-repair left the repo in).
        ((:log! adapters) "push-sweep" (if (pos? (or (:behind counts) 0)) "behind-only" "up-to-date"))
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
            ;; BL-855: the no-op-landing-merge check is a SIBLING of
            ;; qa-gate-decision, consulted here BEFORE it - a merge that
            ;; discarded everything its second parent offered can still
            ;; leave the tip reading as a QA ancestor (its second parent IS
            ;; genuinely approved), so this check must never be skipped by
            ;; qa-gate-decision's own tip-is-qa-ancestor fast path.
            ;; Authorization is not effect.
            noop-gate (noop-merge-decision ((:noop-merge-gate-facts! adapters)))]
        (if (:refuse? noop-gate)
          (do
            ((:log! adapters) "push-sweep" "noop-merge-refused"
             (name (:reason noop-gate))
             (str/join ";" (map (fn [o] (str (:sha o) "<-" (:second-parent-sha o) " dropped=" (:dropped-count o)))
                                 (:offending noop-gate))))
            (write-state! daemon-dir state))
          ;; BL-630: the QA-ancestry gate runs BEFORE the push-attempt
          ;; backoff/alarm machinery below ever sees this tick - a
          ;; refusal here is its own outcome, never absorbed into
          ;; push-failed's transient-retry counting nor into the
          ;; divergence alarm (this branch is ahead>0/behind=0, so
          ;; divergence was never in play regardless).
          (let [qa-gate (qa-gate-decision ((:qa-gate-facts! adapters)))]
            (if (:refuse? qa-gate)
              (do
                ((:log! adapters) "push-sweep" "qa-refused"
                 (name (:reason qa-gate))
                 (str/join "," (:offending-shas qa-gate)))
                (write-state! daemon-dir state))
              (let [push-state (or (:push state) {})
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
                      (write-state! daemon-dir (assoc state :push push-state')))))))))))))
