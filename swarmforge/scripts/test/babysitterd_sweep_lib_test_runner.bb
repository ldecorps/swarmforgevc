#!/usr/bin/env bb
;; TDD runner for babysitterd_sweep_lib.bb — BL-611's pure finding-assembly
;; core. No tmux, no fs, no sleep, no clock read: every input is injected.
(ns babysitterd-sweep-lib-test-runner
  (:require [babashka.fs :as fs]
            [clojure.string :as str]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "babysitterd_sweep_lib.bb")))

(def failures (atom []))

(defn assert= [msg expected actual]
  (when (not= expected actual)
    (swap! failures conj (str "FAIL: " msg "\n  expected: " (pr-str expected) "\n  actual:   " (pr-str actual)))))

(defn assert-true [msg expr]
  (when-not expr
    (swap! failures conj (str "FAIL: " msg))))

(defn assert-nil [msg actual]
  (assert= msg nil actual))

(require '[babysitterd-sweep-lib :as sw])

;; ── check 1: live-session-per-role ──────────────────────────────────────────
(assert-nil "green role produces no live-session finding"
            (sw/check-live-session {:role "coder" :pane-exists? true :has-claude-process? true}))
(assert-true "missing pane is CRIT pane-<role>"
             (let [f (sw/check-live-session {:role "coder" :pane-exists? false :has-claude-process? false})]
               (and f (= "CRIT" (:severity f)) (= "pane-coder" (:key f)))))
(assert-true "pane alive but no claude process is CRIT proc-<role>"
             (let [f (sw/check-live-session {:role "coder" :pane-exists? true :has-claude-process? false})]
               (and f (= "CRIT" (:severity f)) (= "proc-coder" (:key f)))))

;; BL-802: a failed process gather (e.g. ps errored on an unsupported dialect)
;; must never be reported as the real half-launch CRIT above — that would be
;; a cry-wolf false positive from a tooling failure, not a swarm defect.
(assert-true "failed process gather is UNAVAILABLE proc-gather-<role>, never CRIT"
             (let [f (sw/check-live-session {:role "coder" :pane-exists? true
                                              :has-claude-process? false
                                              :process-gather-failed? true})]
               (and f (= "UNAVAILABLE" (:severity f)) (= "proc-gather-coder" (:key f)))))
(assert-true "a missing pane still wins over a gather-failed flag (pane check runs first)"
             (let [f (sw/check-live-session {:role "coder" :pane-exists? false
                                              :has-claude-process? false
                                              :process-gather-failed? true})]
               (and f (= "CRIT" (:severity f)) (= "pane-coder" (:key f)))))
(assert-nil "gather-failed? false with a live process still produces no finding"
            (sw/check-live-session {:role "coder" :pane-exists? true :has-claude-process? true
                                     :process-gather-failed? false}))

;; BL-804: mono-router topology awareness — should-stand? suppresses ONLY
;; the absence branch; every other branch is unaffected regardless of its
;; value (invariant 3), and omitting the key entirely reproduces pre-BL-804
;; behavior byte-for-byte (every existing assertion above never sets it).
(assert-nil "a dormant role's missing session is suppressed (should-stand? false)"
            (sw/check-live-session {:role "specifier" :pane-exists? false
                                     :has-claude-process? false :should-stand? false}))
(assert-true "a required (should-stand? true) role's missing session is still CRIT"
             (let [f (sw/check-live-session {:role "coder" :pane-exists? false
                                              :has-claude-process? false :should-stand? true})]
               (and f (= "CRIT" (:severity f)) (= "pane-coder" (:key f)))))
(assert-true "should-stand? false never suppresses a check on a PRESENT pane (invariant 3)"
             (let [f (sw/check-live-session {:role "specifier" :pane-exists? true
                                              :has-claude-process? false :should-stand? false})]
               (and f (= "CRIT" (:severity f)) (= "proc-specifier" (:key f)))))
(assert-nil "should-stand? false with a present, healthy pane still produces no finding"
            (sw/check-live-session {:role "specifier" :pane-exists? true
                                     :has-claude-process? true :should-stand? false}))

;; ── BL-1017: bounded session REPAIR alongside the CRIT ──────────────────────
;; check-live-session emitted a CRIT for a missing session and stopped there,
;; so a vanished standing role stayed gone until a human ran a full
;; ./start-swarm.sh - recreating all eight sessions for a one-session fault.
;; It now also emits a bounded repair intent. The CRIT is NEVER swallowed by
;; the repair: a session that keeps vanishing is a signal worth keeping.

;; Scenario 01: a standing role with no pane asks for its session back.
(assert-true "BL-1017: a missing standing session emits the CRIT *and* a repair intent"
             (let [f (sw/check-live-session {:role "specifier" :pane-exists? false
                                              :has-claude-process? false :should-stand? true})]
               (and f (= "CRIT" (:severity f)) (= "pane-specifier" (:key f))
                    (= {:action :ensure-session :role "specifier"} (:repair f)))))

;; Scenario 02: topology suppression covers the repair branch too (invariant 1).
;; A mono-router non-resident must never be resurrected as if it were standing.
(assert-nil "BL-1017: a should-not-stand role yields neither CRIT nor repair"
            (sw/check-live-session {:role "cleaner" :pane-exists? false
                                     :has-claude-process? false :should-stand? false}))

;; Scenario 03: a present pane with a LIVE agent is never a missing/half-launch
;; repair target; a failed gather stays UNAVAILABLE (no repair). BL-1169 retires
;; the old "half-launch never repairs" boundary — that case is asserted below.
(doseq [[label extra] [["a live claude process" {:has-claude-process? true}]
                       ["a failed process gather" {:has-claude-process? false
                                                   :process-gather-failed? true}]]]
  (assert-nil (str "BL-1017: a present healthy/unavailable pane emits no session repair (" label ")")
              (:repair (sw/check-live-session (merge {:role "coder" :pane-exists? true
                                                      :should-stand? true}
                                                     extra)))))

;; BL-1169: half-launch (pane up, agent gone) queues the same bounded repair.
(assert-true "BL-1169: half-launch emits CRIT and ensure-session repair when allowed"
             (let [f (sw/check-live-session {:role "coder" :pane-exists? true
                                              :has-claude-process? false :should-stand? true})]
               (and f (= "CRIT" (:severity f)) (= "proc-coder" (:key f))
                    (= {:action :ensure-session :role "coder"} (:repair f)))))

(assert-true "BL-1169: half-launch CRIT stays visible when cooldown withholds repair"
             (let [f (sw/check-live-session {:role "specifier" :pane-exists? true
                                              :has-claude-process? false :should-stand? true
                                              :now-ms 1000000
                                              :last-repair-ms 999000
                                              :repair-attempts 1
                                              :repair-cooldown-ms 60000
                                              :max-repair-attempts 1})]
               (and f (= "CRIT" (:severity f)) (nil? (:repair f)))))

(assert-true "BL-1169: swarm-starved streak at ensure threshold queues control-plane ensure"
             (let [{:keys [finding]} (sw/check-swarm-starved
                                      {:active-ticket-count 2 :any-pane-busy? false
                                       :paused? false :prev-streak 2
                                       :pending-claims [] :in-process-claims []})]
               (and finding (= "swarm-starved" (:key finding))
                    (= {:action :ensure-control-plane} (:repair finding)))))

(assert-true "BL-1169: swarm-starved CRIT at streak 2 does not yet queue ensure"
             (let [{:keys [finding]} (sw/check-swarm-starved
                                      {:active-ticket-count 2 :any-pane-busy? false
                                       :paused? false :prev-streak 1
                                       :pending-claims [] :in-process-claims []})]
               (and finding (= "swarm-starved" (:key finding)) (nil? (:repair finding)))))

;; Scenario 04: bounded (invariant 2). Inside the cooldown window an
;; already-attempted role gets the CRIT but no second repair, so a session
;; that cannot be recreated degrades to plain alerting, never a respawn storm.
(assert-true "BL-1017: a role repaired inside the cooldown window still CRITs but is not repaired again"
             (let [f (sw/check-live-session {:role "specifier" :pane-exists? false
                                              :has-claude-process? false :should-stand? true
                                              :now-ms 1000000
                                              :last-repair-ms 999000
                                              :repair-attempts 1
                                              :repair-cooldown-ms 60000
                                              :max-repair-attempts 1})]
               (and f (= "CRIT" (:severity f)) (nil? (:repair f)))))

(assert-true "BL-1017: once the cooldown window has elapsed the attempt budget resets"
             (let [f (sw/check-live-session {:role "specifier" :pane-exists? false
                                              :has-claude-process? false :should-stand? true
                                              :now-ms 1000000
                                              :last-repair-ms 900000
                                              :repair-attempts 9
                                              :repair-cooldown-ms 60000
                                              :max-repair-attempts 1})]
               (and f (= "CRIT" (:severity f))
                    (= {:action :ensure-session :role "specifier"} (:repair f)))))

(assert-true "BL-1017: inside the window a role under its attempt budget is still repaired"
             (let [f (sw/check-live-session {:role "specifier" :pane-exists? false
                                              :has-claude-process? false :should-stand? true
                                              :now-ms 1000000
                                              :last-repair-ms 999000
                                              :repair-attempts 1
                                              :repair-cooldown-ms 60000
                                              :max-repair-attempts 2})]
               (and f (= "CRIT" (:severity f)) (some? (:repair f)))))

;; Omitting every repair key entirely reproduces pre-BL-1017 behavior for the
;; CRIT itself, exactly as BL-804's should-stand? default does - every
;; assertion above this block never mentions a repair key.
(assert-true "BL-1017: with no repair state supplied a missing session is repaired once"
             (let [f (sw/check-live-session {:role "coder" :pane-exists? false
                                              :has-claude-process? false})]
               (and f (= "CRIT" (:severity f)) (some? (:repair f)))))

;; assemble-findings must SURFACE the repairs, not bury them inside findings -
;; the caller cannot act on a decision it has to re-derive.
(assert= "BL-1017: assemble-findings surfaces one repair per missing standing session"
         [{:action :ensure-session :role "specifier"}]
         (:repairs (sw/assemble-findings
                    {:roles [{:role "specifier" :pane-exists? false :has-claude-process? false
                              :should-stand? true}
                             {:role "coder" :pane-exists? true :has-claude-process? true
                              :should-stand? true}]
                     :handoffd-alive? true :handoffd-supervisor-alive? true
                     :handoffd-log-age-secs 1 :handoffd-max-age-secs 300
                     :failed-count 0 :stuck-parcels [] :available-mb 8000 :mem-floor-mb 500
                     :claim-risks [] :active-ticket-count 1 :any-pane-busy? true
                     :prev-streak 0 :pending-claims [] :in-process-claims []})))

(assert= "BL-1017: a sweep with nothing to repair surfaces an empty repair list, never nil"
         []
         (:repairs (sw/assemble-findings
                    {:roles [{:role "coder" :pane-exists? true :has-claude-process? true
                              :should-stand? true}]
                     :handoffd-alive? true :handoffd-supervisor-alive? true
                     :handoffd-log-age-secs 1 :handoffd-max-age-secs 300
                     :failed-count 0 :stuck-parcels [] :available-mb 8000 :mem-floor-mb 500
                     :claim-risks [] :active-ticket-count 1 :any-pane-busy? true
                     :prev-streak 0 :pending-claims [] :in-process-claims []})))

;; ── check 2: remote-control-flag ─────────────────────────────────────────────
(assert-nil "green role (rc flag present) produces no rc finding"
            (sw/check-remote-control {:role "coder" :pane-exists? true :has-claude-process? true :has-remote-control? true}))
(assert-true "BL-1070: missing agent is UNAVAILABLE rc check (could not be run), never silent"
             (let [f (sw/check-remote-control {:role "coder" :pane-exists? true :has-claude-process? false :has-remote-control? false})]
               (and f (= "UNAVAILABLE" (:severity f)) (= "rc-coder" (:key f))
                    (str/includes? (:message f) "could not be run"))))
(assert-nil "gather failure leaves RC quiet (live-session owns UNAVAILABLE)"
            (sw/check-remote-control {:role "coder" :pane-exists? true :has-claude-process? false
                                      :has-remote-control? false :process-gather-failed? true}))
(assert-true "live process missing --remote-control is WARN rc-<role>"
             (let [f (sw/check-remote-control {:role "coder" :pane-exists? true :has-claude-process? true :has-remote-control? false})]
               (and f (= "WARN" (:severity f)) (= "rc-coder" (:key f)))))
(assert-true "half-launch CRIT names the expected process when provided"
             (let [f (sw/check-live-session {:role "coder" :pane-exists? true
                                             :has-claude-process? false
                                             :expected-process "cursor-agent"})]
               (and f (= "CRIT" (:severity f))
                    (str/includes? (:message f) "cursor-agent"))))
;; BL-1833: the gatherer's :expected-process is the MATCHING marker
;; (agent-process-marker-lib's own trailing-space padding, so "claude "
;; never matches a "claude-*" binary) - never fit for the message an
;; operator reads. Before this fix, the message built from the padded
;; marker directly, reading "NO claude  process" (two spaces) for every
;; claude seat - confirmed live in 14 babysitterd.log lines.
(assert-true "half-launch CRIT names the agent WITHOUT the process marker's padding, even when both are given"
             (let [f (sw/check-live-session {:role "specifier" :pane-exists? true
                                             :has-claude-process? false
                                             :expected-agent "claude"
                                             :expected-process "claude "})]
               (and f (= "CRIT" (:severity f))
                    (str/includes? (:message f) "NO claude process")
                    (not (str/includes? (:message f) "NO claude  process")))))
;; :expected-agent absent (a caller that has not adopted it yet) falls
;; back to :expected-process exactly as before - never a regression for
;; an existing caller that only ever set the one key.
(assert-true "half-launch CRIT falls back to expected-process when expected-agent is absent"
             (let [f (sw/check-live-session {:role "coder" :pane-exists? true
                                             :has-claude-process? false
                                             :expected-process "cursor-agent"})]
               (and f (str/includes? (:message f) "NO cursor-agent process"))))
(assert-nil "Cursor seat alive without --remote-control is not RC-degraded"
            (sw/check-remote-control {:role "coder" :pane-exists? true :has-claude-process? true
                                      :has-remote-control? false :rc-applicable? false}))

;; ── check 3: handoffd-supervisor-fresh ──────────────────────────────────────
(assert-nil "green handoffd/supervisor/log produces no finding"
            (sw/check-handoffd-supervisor-fresh
             {:handoffd-alive? true :supervisor-alive? true :log-age-secs 10 :max-age-secs 300}))
(assert-true "handoffd.log older than 5 minutes is CRIT heartbeat"
             (let [f (sw/check-handoffd-supervisor-fresh
                      {:handoffd-alive? true :supervisor-alive? true :log-age-secs 301 :max-age-secs 300})]
               (and f (= "CRIT" (:severity f)) (= "heartbeat" (:key f)))))
(assert-true "handoffd not running is CRIT handoffd"
             (let [f (sw/check-handoffd-supervisor-fresh
                      {:handoffd-alive? false :supervisor-alive? true :log-age-secs 10 :max-age-secs 300})]
               (and f (= "CRIT" (:severity f)) (= "handoffd" (:key f)))))

;; ── check 4: dead-letter-nonempty ────────────────────────────────────────────
(assert-nil "empty failed/ box produces no finding"
            (sw/check-dead-letter {:failed-count 0}))
(assert-true "non-empty failed/ box is CRIT failed-box"
             (let [f (sw/check-dead-letter {:failed-count 3})]
               (and f (= "CRIT" (:severity f)) (= "failed-box" (:key f)))))

;; ── check 5: stuck-in-process ────────────────────────────────────────────────
(assert= "no stuck parcels -> no findings"
         []
         (sw/check-stuck-in-process []))
(assert-true "a stuck in_process parcel over 30min is WARN stuck-<name>"
             (let [fs (sw/check-stuck-in-process [{:name "000123_from_coder" :age-min 45}])]
               (and (= 1 (count fs))
                    (= "WARN" (:severity (first fs)))
                    (str/starts-with? (:key (first fs)) "stuck-"))))

;; BL-807: the sweep already classifies the owning role's pane busy/idle
;; (check 10 threads the same signal in as owner-busy?) — check 5 must
;; consult it too, so a long-but-honestly-worked parcel never nudges a live
;; agent mid-parcel.
(assert= "a stuck parcel with a busy owner raises no stuck warning at all (BL-807 scenario 01)"
         []
         (sw/check-stuck-in-process [{:name "000123_from_coder" :age-min 45 :owner-busy? true}]))
(assert-true "a stuck parcel with an idle owner still raises the warning, unchanged (BL-807 scenario 02)"
             (let [fs (sw/check-stuck-in-process [{:name "000123_from_coder" :age-min 45 :owner-busy? false}])]
               (and (= 1 (count fs))
                    (= "WARN" (:severity (first fs)))
                    (= "stuck-000123_from_coder" (:key (first fs))))))
(assert-true "a mix of busy and idle owners suppresses only the busy one's warning"
             (let [fs (sw/check-stuck-in-process [{:name "busy-owner" :age-min 60 :owner-busy? true}
                                                   {:name "idle-owner" :age-min 60 :owner-busy? false}])]
               (= ["stuck-idle-owner"] (mapv :key fs))))
(assert= "a gpu-quiet local seat's old parcel is not a stall"
         []
         (sw/check-stuck-in-process [{:name "old-coder" :age-min 90 :owner-busy? false :gpu-quiet? true}]))
(assert-nil "a gpu-quiet local seat with no process is not a half-launch"
            (sw/check-live-session {:role "coder" :pane-exists? true :has-claude-process? false
                                    :should-stand? true :gpu-quiet? true :expected-agent "local-model"}))
(assert-nil "a gpu-quiet local seat is not a frozen pane"
            (sw/check-busy-frozen {:role "coder" :busy? true :gpu-quiet? true
                                   :hash-history ["a" "a" "a"]}))
(assert-true "a gpu-quiet role's claim-risk does not reach assemble-findings"
             (not-any? #(= "claim-risk-coder" (:key %))
                       (:findings (sw/assemble-findings
                                   {:roles [{:role "coder" :pane-exists? true :has-claude-process? false
                                             :gpu-quiet? true :expected-agent "local-model"
                                             :menu-blocked? false :busy? false :hash-history []}]
                                    :now-ms 1 :handoffd-alive? true :handoffd-supervisor-alive? true
                                    :handoffd-log-age-secs 1 :failed-count 0
                                    :stuck-parcels [{:name "old" :age-min 90 :gpu-quiet? true}]
                                    :available-mb 4000 :mem-floor-mb 1500
                                    :claim-risks [{:role "coder" :severity "critical" :reclaims 8}]
                                    :pause {:active? false} :active-ticket-count 1
                                    :any-pane-busy? false :prev-streak 0
                                    :pending-claims [] :in-process-claims []}))))

;; ── check 5b: ticket held in a seat for an hour with no commit ─────────────
;; The 30-minute check above goes silent while the pane spinner is up, and
;; that same spinner freezes claim reclaims, so the operator (CRIT only)
;; never hears about an hour-long dwell. This check ignores the spinner.
(assert= "a ticket held under the 60m threshold is not seat-stuck, even with HEAD unchanged and a spinner"
         []
         (sw/check-seat-ticket-stuck
          [{:role "coder" :task "BL-1851" :dwell-min 59 :head-unchanged? true :busy? true}]
          false))
(assert-true "sixty minutes with no commit is a CRIT even while the pane spinner is live"
             (let [fs (sw/check-seat-ticket-stuck
                       [{:role "coder" :task "BL-1851" :dwell-min 60 :head-unchanged? true :busy? true}]
                       false)]
               (and (= 1 (count fs))
                    (= "CRIT" (:severity (first fs)))
                    (= "seat-stuck-coder" (:key (first fs)))
                    (str/includes? (:message (first fs)) "BL-1851")
                    (str/includes? (:message (first fs)) "spinner"))))
(assert= "a commit since the claim clears the finding, however long the ticket has been held"
         []
         (sw/check-seat-ticket-stuck
          [{:role "coder" :task "BL-1851" :dwell-min 400 :head-unchanged? false :busy? true}]
          false))
(assert= "a control pause is not a stuck seat"
         []
         (sw/check-seat-ticket-stuck
          [{:role "coder" :task "BL-1851" :dwell-min 400 :head-unchanged? true :busy? false}]
          true))
(assert-true "two tickets in one seat report the longer unchanged claim once"
             (let [fs (sw/check-seat-ticket-stuck
                       [{:role "coder" :task "BL-1" :dwell-min 200 :head-unchanged? true :busy? true}
                        {:role "coder" :task "BL-2" :dwell-min 300 :head-unchanged? true :busy? true}]
                       false)]
               (and (= 1 (count fs))
                    (str/includes? (:message (first fs)) "BL-2"))))
(assert-true "a 10-char claim commit matches a full HEAD, and a blank baseline is not unchanged"
             (and (sw/same-commit? "7dc4b0f3f9" "7dc4b0f3f9abcdef")
                  (not (sw/same-commit? "" "7dc4b0f3f9"))
                  (not (sw/same-commit? "7dc4b0f3f9" nil))))
(assert= "dwell-min is whole minutes, and a future or missing clock is nil"
         [180 nil]
         [(sw/dwell-min 180000000 169200000) (sw/dwell-min 1000 2000)])
(assert= "parse-instant-ms reads a handoff dequeued_at and refuses garbage"
         [1791094115000 nil]
         [(sw/parse-instant-ms "2026-10-04T06:08:35Z")
          (sw/parse-instant-ms "not-a-time")])
(assert-true "a seat-stuck CRIT reaches assemble-findings and is operator-escalation eligible"
             (let [fs (:findings (sw/assemble-findings
                                  {:roles [] :now-ms 1 :handoffd-alive? true
                                   :handoffd-supervisor-alive? true :handoffd-log-age-secs 1
                                   :failed-count 0 :stuck-parcels [] :available-mb 4000
                                   :mem-floor-mb 1500 :claim-risks [] :pause {:active? false}
                                   :active-ticket-count 1 :any-pane-busy? true :prev-streak 0
                                   :pending-claims [] :in-process-claims []
                                   :held-seat-tickets [{:role "coder" :task "BL-1851"
                                                        :dwell-min 200 :head-unchanged? true
                                                        :busy? true}]}))
                   f (first (filter #(= "seat-stuck-coder" (:key %)) fs))]
               (and f (sw/escalation-eligible? f) (sw/nudge-eligible? f))))
(assert-true "assemble-findings drops seat-stuck for a gpu-quiet local seat"
             (not-any? #(= "seat-stuck-coder" (:key %))
                       (:findings (sw/assemble-findings
                                   {:roles [] :now-ms 1 :handoffd-alive? true
                                    :handoffd-supervisor-alive? true :handoffd-log-age-secs 1
                                    :failed-count 0 :stuck-parcels [] :available-mb 4000
                                    :mem-floor-mb 1500 :claim-risks [] :pause {:active? false}
                                    :active-ticket-count 1 :any-pane-busy? true :prev-streak 0
                                    :pending-claims [] :in-process-claims []
                                    :held-seat-tickets [{:role "coder" :task "BL-1851"
                                                         :dwell-min 200 :head-unchanged? true
                                                         :busy? true :gpu-quiet? true}]}))))
(assert-true "assemble-findings drops seat-stuck while a control pause is active"
             (not-any? #(= "seat-stuck-coder" (:key %))
                       (:findings (sw/assemble-findings
                                   {:roles [] :now-ms 1 :handoffd-alive? true
                                    :handoffd-supervisor-alive? true :handoffd-log-age-secs 1
                                    :failed-count 0 :stuck-parcels [] :available-mb 4000
                                    :mem-floor-mb 1500 :claim-risks []
                                    :pause {:active? true :until-ms 9}
                                    :active-ticket-count 1 :any-pane-busy? true :prev-streak 0
                                    :pending-claims [] :in-process-claims []
                                    :held-seat-tickets [{:role "coder" :task "BL-1851"
                                                         :dwell-min 200 :head-unchanged? true
                                                         :busy? true}]}))))

;; BL-1980: a looping seat is pulled in minutes, not hours
(assert-true "BL-1980: a loop-detection dialog on the pane is a CRIT at 5m dwell"
             (let [fs (sw/check-seat-ticket-stuck
                       [{:role "coder" :task "BL-1980" :dwell-min 5 :head-unchanged? true
                        :busy? false :loop-dialog? true}]
                       false)]
               (and (= 1 (count fs))
                    (= "CRIT" (:severity (first fs)))
                    (= "seat-stuck-coder" (:key (first fs)))
                    (str/includes? (:message (first fs)) "loop dialog"))))
(assert-true "BL-1980: ten REPEAT notes since the claim are a CRIT at 5m dwell"
             (let [fs (sw/check-seat-ticket-stuck
                       [{:role "coder" :task "BL-1980" :dwell-min 5 :head-unchanged? true
                        :busy? false :repeat-notes-since-claim 10}]
                       false)]
               (and (= 1 (count fs))
                    (= "CRIT" (:severity (first fs)))
                    (= "seat-stuck-coder" (:key (first fs)))
                    (str/includes? (:message (first fs)) "10"))))
(assert= "BL-1980: nine REPEAT notes, no dialog, under the dwell threshold is not stuck"
         []
         (sw/check-seat-ticket-stuck
          [{:role "coder" :task "BL-1980" :dwell-min 5 :head-unchanged? true
           :busy? false :repeat-notes-since-claim 9}]
          false))
(assert= "BL-1980: ten REPEAT notes but a commit since the claim is not stuck"
         []
         (sw/check-seat-ticket-stuck
          [{:role "coder" :task "BL-1980" :dwell-min 5 :head-unchanged? false
           :busy? false :repeat-notes-since-claim 10}]
          false))
(assert-true "BL-1980: dwell past the threshold plus a dialog still reports one CRIT, not two"
             (let [fs (sw/check-seat-ticket-stuck
                       [{:role "coder" :task "BL-1980" :dwell-min 60 :head-unchanged? true
                        :busy? true :loop-dialog? true}]
                       false)]
               (and (= 1 (count fs))
                    (= "CRIT" (:severity (first fs)))
                    (= "seat-stuck-coder" (:key (first fs)))
                    (str/includes? (:message (first fs)) "loop dialog"))))

;; BL-2091: a hardener whose mutation progress proves a run began during
;; this hold gets the longer 150m clock; every other seat, and a hardener
;; with no such proof, stays at 60.
(assert= "seat-stuck-threshold-min is 60 for a non-hardener seat regardless of the fact"
         [60 60]
         [(sw/seat-stuck-threshold-min "coder" true) (sw/seat-stuck-threshold-min "coder" false)])
(assert= "seat-stuck-threshold-min is 150 for a hardener only when the fact is true"
         [150 60 60]
         [(sw/seat-stuck-threshold-min "hardender" true)
          (sw/seat-stuck-threshold-min "hardender" false)
          (sw/seat-stuck-threshold-min "hardender" nil)])
(assert= "seat-stuck-threshold-min strips a numbered seat's @N before comparing the stage"
         [150 60]
         [(sw/seat-stuck-threshold-min "hardender@2" true) (sw/seat-stuck-threshold-min "coder@2" true)])
(assert= "a hardener at 91m with a proven mutation run under way is not stuck (invariant 2, QA's BL-2061 repro)"
         []
         (sw/check-seat-ticket-stuck
          [{:role "hardender" :task "BL-2061" :dwell-min 91 :head-unchanged? true
           :busy? true :mutation-run-since-origin? true}]
          false))
(assert-true "a hardener at 150m with a proven mutation run under way is stuck, naming the 150m threshold"
             (let [fs (sw/check-seat-ticket-stuck
                       [{:role "hardender" :task "BL-2061" :dwell-min 150 :head-unchanged? true
                        :busy? true :mutation-run-since-origin? true}]
                       false)]
               (and (= 1 (count fs))
                    (= "CRIT" (:severity (first fs)))
                    (= "seat-stuck-hardender" (:key (first fs)))
                    (str/includes? (:message (first fs)) "threshold 150m"))))
(assert-true "a hardener at 60m with NO proven mutation run falls back to the 60m threshold (invariant 1)"
             (let [fs (sw/check-seat-ticket-stuck
                       [{:role "hardender" :task "BL-2061" :dwell-min 60 :head-unchanged? true
                        :busy? true :mutation-run-since-origin? false}]
                       false)]
               (and (= 1 (count fs))
                    (str/includes? (:message (first fs)) "threshold 60m"))))
(assert= "a hardener at 91m with NO proven mutation run is still not stuck under the 150m threshold but IS under 60m"
         []
         (sw/check-seat-ticket-stuck
          [{:role "hardender" :task "BL-2061" :dwell-min 59 :head-unchanged? true
           :busy? true :mutation-run-since-origin? false}]
          false))
(assert-true "invariant 3: a hardener's loop-detection dialog is a CRIT at 5m dwell, same as any other seat"
             (let [fs (sw/check-seat-ticket-stuck
                       [{:role "hardender" :task "BL-2091" :dwell-min 5 :head-unchanged? true
                        :busy? false :loop-dialog? true :mutation-run-since-origin? true}]
                       false)]
               (and (= 1 (count fs))
                    (str/includes? (:message (first fs)) "loop dialog"))))
(assert-true "invariant 3: ten REPEAT notes are a CRIT for a hardener at 5m dwell, same as any other seat"
             (let [fs (sw/check-seat-ticket-stuck
                       [{:role "hardender" :task "BL-2091" :dwell-min 5 :head-unchanged? true
                        :busy? false :repeat-notes-since-claim 10 :mutation-run-since-origin? true}]
                       false)]
               (and (= 1 (count fs))
                    (str/includes? (:message (first fs)) "10"))))

;; ── check 6: menu-blocked-pane ───────────────────────────────────────────────
(assert-nil "no menu block produces no finding"
            (sw/check-menu-blocked {:role "coder" :menu-blocked? false}))
(assert-true "menu-blocked pane is CRIT menu-<role>"
             (let [f (sw/check-menu-blocked {:role "coder" :menu-blocked? true})]
               (and f (= "CRIT" (:severity f)) (= "menu-coder" (:key f)))))

;; ── check 7: busy-but-frozen ─────────────────────────────────────────────────
(assert-nil "busy pane with changing content is not frozen"
            (sw/check-busy-frozen {:role "coder" :busy? true :hash-history ["a" "b" "c"]}))
(assert-nil "idle pane (not busy) never reports frozen"
            (sw/check-busy-frozen {:role "coder" :busy? false :hash-history ["a" "a" "a"]}))
(assert-true "busy pane unchanged across 3 sweeps is WARN frozen-<role>"
             (let [f (sw/check-busy-frozen {:role "coder" :busy? true :hash-history ["a" "a" "a"]})]
               (and f (= "WARN" (:severity f)) (= "frozen-coder" (:key f)))))

;; ── check 8: memory-floor ────────────────────────────────────────────────────
(assert-nil "memory above floor produces no finding"
            (sw/check-memory-floor {:available-mb 2000 :floor-mb 1500}))
(assert-true "memory below floor is CRIT memory"
             (let [f (sw/check-memory-floor {:available-mb 800 :floor-mb 1500})]
               (and f (= "CRIT" (:severity f)) (= "memory" (:key f)))))

;; BL-802: no readable memory facility (available-mb nil, e.g. /proc/meminfo
;; absent on macOS and no other facility resolved) must report UNAVAILABLE,
;; never a fabricated CRIT/OK from a substituted default value.
(assert-true "nil available-mb (no facility) is UNAVAILABLE memory, never CRIT or OK"
             (let [f (sw/check-memory-floor {:available-mb nil :floor-mb 1500})]
               (and f (= "UNAVAILABLE" (:severity f)) (= "memory" (:key f)))))

;; ── check: control-plane-missing (BL-958 babysitter ownership) ───────────────
(assert-nil "healthy control plane produces no finding"
            (sw/check-control-plane {:control-plane-classification :ok
                                     :launch-scripts-present? true
                                     :control-plane-repair-allowed? true}))
(assert-true "control-plane-missing with scripts + budget queues ensure-control-plane repair"
             (let [f (sw/check-control-plane {:control-plane-classification :control-plane-missing
                                              :launch-scripts-present? true
                                              :control-plane-repair-allowed? true
                                              :socket-path "/tmp/sock"})]
               (and f (= "CRIT" (:severity f)) (= "control-plane" (:key f))
                    (= {:action :ensure-control-plane} (:repair f)))))
(assert-true "control-plane-missing with scripts but exhausted budget CRIT-only (no repair)"
             (let [f (sw/check-control-plane {:control-plane-classification :control-plane-missing
                                              :launch-scripts-present? true
                                              :control-plane-repair-allowed? false
                                              :socket-path "/tmp/sock"})]
               (and f (= "CRIT" (:severity f)) (nil? (:repair f)))))
(assert-true "control-plane-missing without launch scripts escalates (no ensure repair)"
             (let [f (sw/check-control-plane {:control-plane-classification :control-plane-missing
                                              :launch-scripts-present? false
                                              :control-plane-repair-allowed? true
                                              :socket-path "/tmp/sock"})]
               (and f (= "CRIT" (:severity f)) (nil? (:repair f))
                    (str/includes? (:message f) "start-swarm"))))
;; ── BL-1081 (architect bounce D1): the LIVE decision site ─────────────────
(assert-true "1081: a pane-driven seat still raises the interactive-menu CRIT"
             (let [f (sw/check-menu-blocked {:role "coder" :menu-blocked? true})]
               (and f (= "CRIT" (:severity f)))))
(assert-true "1081: and an ACP seat's menu-blocked? is already suppressed upstream"
             (nil? (sw/check-menu-blocked {:role "coder" :menu-blocked? false :acp? true})))
(assert-true "1081: a pane-driven seat still gets the frozen-pane WARN"
             (let [f (sw/check-busy-frozen {:role "coder" :busy? true
                                            :hash-history ["a" "a" "a"]})]
               (and f (= "WARN" (:severity f)))))
(assert-true "1081: an ACP seat whose turn ENDED is idle, not frozen - the stop reason says so"
             (nil? (sw/check-busy-frozen {:role "coder" :busy? true :hash-history ["a" "a" "a"]
                                          :acp? true :acp-idle? true
                                          :idle-from "stop_reason:end_turn"})))
(assert-true "1081: and an ACP seat mid-turn is not frozen either - an unchanged pane is not evidence"
             (nil? (sw/check-busy-frozen {:role "coder" :busy? true :hash-history ["a" "a" "a"]
                                          :acp? true :acp-idle? false
                                          :idle-from "tool_running:shell"})))
(assert-true "1081: a blocked ACP seat is surfaced from its structured request"
             (let [f (sw/check-acp-seat {:role "coder" :acp? true :acp-idle? false
                                         :permission-pending? true
                                         :permission-tool "write_file"
                                         :idle-from "permission_requested:write_file"})]
               (and f (= "CRIT" (:severity f)) (= "acp-permission-coder" (:key f))
                    (str/includes? (:message f) "write_file"))))
(assert-true "1081: and it says it is NOT a menu block, because the response differs"
             (str/includes? (:message (sw/check-acp-seat {:role "coder" :acp? true
                                                          :permission-pending? true
                                                          :permission-tool "write_file"}))
                            "not a menu block"))
(assert-true "1081: an idle ACP seat needs no finding at all"
             (nil? (sw/check-acp-seat {:role "coder" :acp? true :acp-idle? true
                                       :idle-from "stop_reason:end_turn"})))
(assert-true "1081: nor does a working one"
             (nil? (sw/check-acp-seat {:role "coder" :acp? true :acp-idle? false
                                       :idle-from "tool_running:shell"})))
(assert-true "1081: and a pane-driven seat is never touched by it - this widens no other path"
             (nil? (sw/check-acp-seat {:role "coder" :acp? false :permission-pending? true})))

;; ── BL-1071 invariant 3: an observation that could not be made is its own
;; answer. `classify` returns only :up / :control-plane-missing / :down, so
;; :unavailable can ONLY mean the observer itself threw. Before this ticket
;; that case produced no finding at all - it fell off the end of the `when`
;; and the sweep printed "OK all checks green" while knowing nothing about
;; the control plane. That is the same silent-blackout mechanism the incident
;; was, one layer up.
;;
;; BL-1081 ACP babysitter tests that lived here were dropped with the
;; BL-1081 bounce (QA tip 28e78f38c); keep only the BL-1071 coverage.

(assert-true "1071: an unreadable control-plane observation is reported UNAVAILABLE, not silence"
             (let [f (sw/check-control-plane {:control-plane-classification :unavailable
                                              :launch-scripts-present? true
                                              :control-plane-repair-allowed? true
                                              :control-plane-error "boom"
                                              :socket-path "/tmp/sock"})]
               (and f (= "UNAVAILABLE" (:severity f)) (= "control-plane" (:key f)))))
(assert-true "1071: and it carries the reason it could not be read"
             (str/includes? (:message (sw/check-control-plane
                                       {:control-plane-classification :unavailable
                                        :launch-scripts-present? true
                                        :control-plane-repair-allowed? true
                                        :control-plane-error "boom"}))
                            "boom"))
(assert-true "1071: an unreadable observation never queues a recovery - it is not an absence"
             (nil? (:repair (sw/check-control-plane {:control-plane-classification :unavailable
                                                     :launch-scripts-present? true
                                                     :control-plane-repair-allowed? true}))))
(assert-true "1071: nor is it a healthy reading - :up still produces no finding"
             (nil? (sw/check-control-plane {:control-plane-classification :up
                                            :launch-scripts-present? true
                                            :control-plane-repair-allowed? true})))
(assert-true "1071: and :down - an ordinarily stopped swarm - is still not a loss"
             (nil? (sw/check-control-plane {:control-plane-classification :down
                                            :launch-scripts-present? true
                                            :control-plane-repair-allowed? true})))

;; BL-1071 scenario 06: the reason has to survive assemble-findings' own
;; destructuring. check-control-plane renders it and the gatherer captures it,
;; but the :keys list between them is a third place the key has to be named -
;; and it was not. The finding degraded to "unavailable" with nowhere for a
;; human to start, while both ends looked correct in isolation.
(assert-true "1071: assemble-findings carries the observation's failure reason into the finding"
             (let [{:keys [findings]}
                   (sw/assemble-findings
                    {:roles []
                     :control-plane-classification :unavailable
                     :control-plane-error "Cannot run program \"tmux\""
                     :launch-scripts-present? true
                     :control-plane-repair-allowed? true
                     :now-ms 1000})
                   f (first (filter #(= "control-plane" (:key %)) findings))]
               (and f (= "UNAVAILABLE" (:severity f))
                    (str/includes? (:message f) "Cannot run program"))))
(assert-true "1071: and an unreadable observation queues no recovery, scripts or no scripts"
             (empty? (:repairs (sw/assemble-findings
                                {:roles []
                                 :control-plane-classification :unavailable
                                 :control-plane-error "boom"
                                 :launch-scripts-present? true
                                 :control-plane-repair-allowed? true
                                 :now-ms 1000}))))
(assert-true "assemble-findings suppresses per-role ensure-session when control-plane ensure is queued"
             (let [{:keys [repairs findings]}
                   (sw/assemble-findings
                    {:roles [{:role "coder" :pane-exists? false :should-stand? true
                              :now-ms 1000 :repair-attempts 0}]
                     :control-plane-classification :control-plane-missing
                     :launch-scripts-present? true
                     :control-plane-repair-allowed? true
                     :socket-path "/tmp/sock"
                     :handoffd-alive? true :handoffd-supervisor-alive? true
                     :available-mb 4000 :mem-floor-mb 1500
                     :pause {:active? false} :prev-streak 0
                     :active-ticket-count 0 :any-pane-busy? false
                     :pending-claims [] :in-process-claims []})]
               (and (= [{:action :ensure-control-plane}] repairs)
                    (some #(= "control-plane" (:key %)) findings)
                    (some #(= "pane-coder" (:key %)) findings)
                    (not-any? #(= :ensure-session (:action %)) repairs))))

;; ── check 11: claim-progress risk scan (BL-528 salvage) ─────────────────────
(assert-true "critical claim-risk assessment maps to CRIT"
             (let [f (sw/check-claim-risk {:role "hardener" :severity "critical" :reclaims 6})]
               (and f (= "CRIT" (:severity f)) (str/includes? (:key f) "hardener"))))
(assert-true "warn claim-risk assessment maps to WARN"
             (let [f (sw/check-claim-risk {:role "hardener" :severity "warn" :reclaims 4})]
               (and f (= "WARN" (:severity f)))))
(assert-true "halt-imminent claim-risk assessment maps to CRIT"
             (let [f (sw/check-claim-risk {:role "coder" :severity "halt-imminent" :reclaims 8})]
               (and f (= "CRIT" (:severity f)))))

;; ── check 9: rotate-not-honored ──────────────────────────────────────────────
(assert-true "unhonored rotate note (note newer than active-role file) fires CRIT naming parcel+roles"
             (let [f (sw/check-rotate-not-honored
                      {:note-name "000741_rotate" :note-target "architect"
                       :note-age-min 15 :grace-min 10
                       :note-mtime-ms 2000 :active-role-file-mtime-ms 1000
                       :active-role "coder" :paused? false :rotation-router? true})]
               (and f (= "CRIT" (:severity f))
                    (str/includes? (:message f) "000741_rotate")
                    (str/includes? (:message f) "architect")
                    (str/includes? (:message f) "coder"))))
(assert-nil "honored rotate (active-role file newer than the note) produces no finding"
            (sw/check-rotate-not-honored
             {:note-name "000741_rotate" :note-target "architect"
              :note-age-min 15 :grace-min 10
              :note-mtime-ms 1000 :active-role-file-mtime-ms 2000
              :active-role "architect" :paused? false :rotation-router? true}))
(assert-nil "note within grace period produces no finding yet"
            (sw/check-rotate-not-honored
             {:note-name "000741_rotate" :note-target "architect"
              :note-age-min 5 :grace-min 10
              :note-mtime-ms 2000 :active-role-file-mtime-ms 1000
              :active-role "coder" :paused? false :rotation-router? true}))
(assert-nil "no rotate note at all produces no finding"
            (sw/check-rotate-not-honored nil))
(assert-nil "planned pause suppresses rotate-not-honored even past grace"
            (sw/check-rotate-not-honored
             {:note-name "000741_rotate" :note-target "architect"
              :note-age-min 999 :grace-min 10
              :note-mtime-ms 2000 :active-role-file-mtime-ms 1000
              :active-role "coder" :paused? true :rotation-router? true}))
(assert-nil "BL-1129: standing pack suppresses rotate-not-honored even when unhonored"
            (sw/check-rotate-not-honored
             {:note-name "000741_rotate" :note-target "architect"
              :note-age-min 15 :grace-min 10
              :note-mtime-ms 2000 :active-role-file-mtime-ms 1000
              :active-role "coder" :paused? false :rotation-router? false}))

;; ── check 10: swarm-starved (streak + abandoned/stale filtering) ────────────
(let [base {:active-ticket-count 2 :any-pane-busy? false :paused? false}]
  (assert= "first idle sweep: no finding, streak becomes 1"
           {:finding nil :new-streak 1}
           (sw/check-swarm-starved (merge base {:prev-streak 0 :pending-claims [] :in-process-claims []})))
  (assert-true "second consecutive idle sweep: CRIT swarm-starved, streak 2"
               (let [{:keys [finding new-streak]}
                     (sw/check-swarm-starved (merge base {:prev-streak 1 :pending-claims [] :in-process-claims []}))]
                 (and finding (= "CRIT" (:severity finding)) (= "swarm-starved" (:key finding)) (= 2 new-streak))))
  (assert= "no active tickets never starves; streak resets"
           {:finding nil :new-streak 0}
           (sw/check-swarm-starved (merge base {:active-ticket-count 0 :prev-streak 1 :pending-claims [] :in-process-claims []})))
  (assert= "any busy pane resets the streak and suppresses the finding"
           {:finding nil :new-streak 0}
           (sw/check-swarm-starved (merge base {:any-pane-busy? true :prev-streak 1 :pending-claims [] :in-process-claims []})))
  (assert-true "abandoned/stale-only pending parcels do not suppress starvation"
               (let [{:keys [finding new-streak]}
                     (sw/check-swarm-starved
                      (merge base {:prev-streak 1
                                   :pending-claims [{:abandoned? true :age-min 5}
                                                     {:abandoned? false :age-min 200}]
                                   :in-process-claims []}))]
                 (and finding (= 2 new-streak))))
  (assert= "a genuinely fresh pending parcel counts as motion"
           {:finding nil :new-streak 0}
           (sw/check-swarm-starved
            (merge base {:prev-streak 1
                         :pending-claims [{:abandoned? false :age-min 3}]
                         :in-process-claims []})))
  (assert= "planned pause suppresses swarm-starved outright"
           {:finding nil :new-streak 0}
           (sw/check-swarm-starved (merge base {:paused? true :prev-streak 1 :pending-claims [] :in-process-claims []}))))

;; ── 6d-10 / BL-1109: in_process claim is motion even when owner is idle ────
(assert= "aged in_process claim whose owning resident is busy does not contribute to starvation"
         {:finding nil :new-streak 0}
         (sw/check-swarm-starved
          {:active-ticket-count 2 :any-pane-busy? false :paused? false :prev-streak 1
           :pending-claims []
           :in-process-claims [{:age-min 45 :owner-busy? true}]}))
(assert= "BL-1109: same-aged in_process claim whose owning resident is idle is still motion"
         {:finding nil :new-streak 0}
         (sw/check-swarm-starved
          {:active-ticket-count 2 :any-pane-busy? false :paused? false :prev-streak 1
           :pending-claims []
           :in-process-claims [{:age-min 45 :owner-busy? false :abandoned? false}]}))
(assert-true "BL-1109: abandoned in_process alone still allows starvation"
             (let [{:keys [finding new-streak]}
                   (sw/check-swarm-starved
                    {:active-ticket-count 2 :any-pane-busy? false :paused? false :prev-streak 1
                     :pending-claims []
                     :in-process-claims [{:age-min 45 :owner-busy? false :abandoned? true}]})]
               (and finding (= 2 new-streak))))
(assert-true "BL-1109: CRIT copy never claims zero parcels when claims were gathered"
             (let [msg (:message (:finding
                                  (sw/check-swarm-starved
                                   {:active-ticket-count 2 :any-pane-busy? false :paused? false :prev-streak 1
                                    :pending-claims [{:abandoned? true :age-min 5}]
                                    :in-process-claims [{:age-min 45 :abandoned? true}]})))]
               (and msg
                    (not (re-find #"zero pending/in-process parcels" msg))
                    (re-find #"in-process claim" msg))))

;; ── 6d-09: busy detection survives 80-column truncation ─────────────────────
;; BL-996: classify-pane-busy? now delegates to chase_sweep_lib.bb's own
;; structural classifier (the BL-970 chokepoint) instead of a private
;; whole-pane substring match. A bare literal with no live status frame
;; around it is exactly BL-970's own false-busy shape (a pane merely
;; quoting the marker in old scrollback) - was asserted busy here before
;; this fix; now correctly not.
(assert-true "not busy: a bare literal 'esc to interrupt' with no live status frame around it"
             (not (sw/classify-pane-busy? "some output\n  esc to interrupt\n")))
(assert-true "truncated footer (spinner + elapsed pattern survive, hint text clipped) still reads busy"
             (sw/classify-pane-busy? "some output\n✻ Combobulating… (12s · e…\n"))
(assert-true "not busy: idle prompt with no spinner or elapsed pattern"
             (not (sw/classify-pane-busy? "❯ \n")))
(assert-true "not busy: a stray middle-dot alone (used only for hash-stripping) is not sufficient"
             (not (sw/classify-pane-busy? "notes · bullets · here\n❯ \n")))

;; ── check 17 / resume-overdue (12): pause suppresses starvation, expired pause is CRIT ─
(assert-nil "active pause not yet expired produces no resume-overdue finding"
            (sw/check-resume-overdue {:paused? true :now-ms 2000000 :until-ms 1900000 :overdue-threshold-ms 900000}))
(assert-nil "no pause active produces no resume-overdue finding"
            (sw/check-resume-overdue {:paused? false :now-ms 2000000 :until-ms 1000000 :overdue-threshold-ms 900000}))
(assert-true "active pause expired more than 15 minutes ago is CRIT resume-overdue"
             (let [f (sw/check-resume-overdue {:paused? true :now-ms 3000000 :until-ms 1000000 :overdue-threshold-ms 900000})]
               (and f (= "CRIT" (:severity f)) (= "resume-overdue" (:key f)))))

;; ── nudge eligibility (scenario 13): CRIT / stuck-* WARN / other WARN ───────
(assert-true "CRIT is always nudge-eligible" (sw/nudge-eligible? {:key "memory" :severity "CRIT"}))
(assert-true "stuck-* WARN is nudge-eligible" (sw/nudge-eligible? {:key "stuck-000123" :severity "WARN"}))
(assert-true "non-stuck WARN is not nudge-eligible" (not (sw/nudge-eligible? {:key "rc-coder" :severity "WARN"})))

;; ── decide-nudges (scenario 11): dedup + cooldown ────────────────────────────
(let [finding {:key "memory" :severity "CRIT" :message "low memory"}]
  (assert-true "first occurrence nudges"
               (let [{:keys [to-nudge]} (sw/decide-nudges [finding] {:last-nudged-ms-by-key {} :now-ms 100000 :cooldown-ms 1800000})]
                 (= 1 (count to-nudge))))
  (assert-true "recurrence inside cooldown does not re-nudge"
               (let [{:keys [to-nudge]} (sw/decide-nudges [finding] {:last-nudged-ms-by-key {"memory" 100000} :now-ms 200000 :cooldown-ms 1800000})]
                 (empty? to-nudge)))
  (assert-true "recurrence after cooldown expiry nudges again"
               (let [{:keys [to-nudge]} (sw/decide-nudges [finding] {:last-nudged-ms-by-key {"memory" 100000} :now-ms 2000000 :cooldown-ms 1800000})]
                 (= 1 (count to-nudge))))
  (assert-true "a non-eligible WARN is never included in to-nudge"
               (let [{:keys [to-nudge]} (sw/decide-nudges [{:key "rc-coder" :severity "WARN" :message "rc missing"}]
                                                           {:last-nudged-ms-by-key {} :now-ms 100000 :cooldown-ms 1800000})]
                 (empty? to-nudge))))

;; ── BL-653 escalation eligibility + decide-escalations ───────────────────────
(assert-true "CRIT is escalation-eligible" (sw/escalation-eligible? {:key "proc-coder" :severity "CRIT"}))
(assert-true "stuck-* WARN is below the operator escalation bar"
             (not (sw/escalation-eligible? {:key "stuck-000123" :severity "WARN"})))
(let [crit {:key "proc-coder" :severity "CRIT" :message "gone"}
      stuck {:key "stuck-000123" :severity "WARN" :message "stale parcel"}]
  (assert-true "decide-escalations includes CRIT only"
               (let [{:keys [to-escalate]} (sw/decide-escalations [crit stuck]
                                                                   {:last-escalated-ms-by-key {} :now-ms 100000 :cooldown-ms 1800000})]
                 (= [crit] to-escalate))))

;; ── format helpers ────────────────────────────────────────────────────────
(assert-true "format-finding-line includes timestamp, severity, key, message"
             (let [line (sw/format-finding-line {:key "memory" :severity "CRIT" :message "low mem"} "2026-08-01T00:00:00Z")]
               (and (str/starts-with? line "2026-08-01T00:00:00Z")
                    (str/includes? line "CRIT")
                    (str/includes? line "[memory]")
                    (str/includes? line "low mem"))))
(assert-true "format-nudge-message joins multiple findings and asks for the minimal correct action"
             (let [msg (sw/format-nudge-message [{:key "memory" :severity "CRIT" :message "low mem"}
                                                  {:key "failed-box" :severity "CRIT" :message "dead letters"}])]
               (and (str/starts-with? msg "babysitter health sweep:")
                    (str/includes? msg "low mem")
                    (str/includes? msg "dead letters"))))

;; ── check-pipeline-code-on-main (BL-631) ────────────────────────────────────

(assert= "no offending commits, ancestry resolvable, produces zero findings"
         []
         (sw/check-pipeline-code-on-main {:offending-commits [] :ancestry-unavailable? false}))

(assert-true "one offending commit produces one CRIT finding, keyed by its sha"
             (let [fs (sw/check-pipeline-code-on-main
                       {:offending-commits [{:sha "4851901ed" :subject "coder: merge BL-590 fix" :paths ["extension/src/foo.ts"]}]
                        :ancestry-unavailable? false})]
               (and (= 1 (count fs))
                    (= "CRIT" (:severity (first fs)))
                    (= "pipeline-code-on-main-4851901ed" (:key (first fs)))
                    (str/includes? (:message (first fs)) "4851901ed")
                    (str/includes? (:message (first fs)) "coder: merge BL-590 fix")
                    (str/includes? (:message (first fs)) "extension/src/foo.ts"))))

(assert-true "each offending commit gets its OWN key - no role, path, or timing is exempt (invariant 1), and dedup can distinguish them (scenario 04)"
             (let [fs (sw/check-pipeline-code-on-main
                       {:offending-commits [{:sha "aaa1111111" :subject "s1" :paths ["extension/src/a.ts"]}
                                             {:sha "bbb2222222" :subject "s2" :paths ["specs/pipeline/steps/b.js"]}]
                        :ancestry-unavailable? false})
                   keys-found (set (map :key fs))]
               (and (= 2 (count fs))
                    (contains? keys-found "pipeline-code-on-main-aaa1111111")
                    (contains? keys-found "pipeline-code-on-main-bbb2222222"))))

;; invariant 3: an unresolvable swarmforge-QA ref reports UNAVAILABLE, never
;; a silent all-clear - even when offending-commits happens to be empty
;; (the gatherer could not have populated it correctly anyway).
(assert-true "ancestry-unavailable? true reports UNAVAILABLE, never a clean sweep"
             (let [fs (sw/check-pipeline-code-on-main {:offending-commits [] :ancestry-unavailable? true})]
               (and (= 1 (count fs))
                    (= "UNAVAILABLE" (:severity (first fs)))
                    (= "pipeline-code-on-main" (:key (first fs))))))

(assert-true "ancestry-unavailable? wins over any offending-commits data - never both an UNAVAILABLE and stale CRIT findings"
             (let [fs (sw/check-pipeline-code-on-main
                       {:offending-commits [{:sha "cccc333333" :subject "s" :paths ["extension/src/x.ts"]}]
                        :ancestry-unavailable? true})]
               (and (= 1 (count fs)) (= "UNAVAILABLE" (:severity (first fs))))))

;; nudge-eligible?: a CRIT pipeline-code-on-main finding rides the SAME rule
;; as every other CRIT finding (scenario 03) - no special-casing needed, but
;; pinned directly so a future change to nudge-eligible? cannot silently
;; exempt this check without failing here too.
(assert-true "a pipeline-code-on-main CRIT finding is nudge-eligible on the standard CRIT rule"
             (sw/nudge-eligible? {:key "pipeline-code-on-main-4851901ed" :severity "CRIT"}))
(assert-true "a pipeline-code-on-main UNAVAILABLE finding is NOT nudge-eligible (matches every other UNAVAILABLE check)"
             (not (sw/nudge-eligible? {:key "pipeline-code-on-main" :severity "UNAVAILABLE"})))

;; ── assemble-findings: end-to-end composition + streak threading ───────────
(let [green-snapshot
      {:now-ms 1000000
       :roles [{:role "coder" :pane-exists? true :has-claude-process? true :has-remote-control? true
                :menu-blocked? false :busy? false :hash-history ["a" "b" "c"]}]
       :handoffd-alive? true :handoffd-supervisor-alive? true :handoffd-log-age-secs 5 :handoffd-max-age-secs 300
       :failed-count 0
       :stuck-parcels []
       :available-mb 4000 :mem-floor-mb 1500
       :claim-risks []
       :rotate-note nil
       :pause {:active? false :until-ms nil}
       :active-ticket-count 2 :any-pane-busy? false :prev-streak 0
       :pending-claims [] :in-process-claims []}]
  (let [{:keys [findings new-streak]} (sw/assemble-findings green-snapshot)]
    (assert= "fully green snapshot produces zero findings" [] findings)
    (assert= "green idle-but-no-active-tickets... streak counts up once (no active tickets? no: 2 present, 1st idle sweep)"
             1 new-streak)))

(let [degraded-snapshot
      {:now-ms 1000000
       :roles [{:role "coder" :pane-exists? true :has-claude-process? false :has-remote-control? false
                :menu-blocked? false :busy? false :hash-history []}]
       :handoffd-alive? false :handoffd-supervisor-alive? true :handoffd-log-age-secs 5 :handoffd-max-age-secs 300
       :failed-count 2
       :stuck-parcels [{:name "p1" :age-min 40}]
       :available-mb 4000 :mem-floor-mb 1500
       :claim-risks [{:role "hardener" :severity "critical" :reclaims 7}]
       :rotate-note nil
       :pause {:active? false :until-ms nil}
       :active-ticket-count 1 :any-pane-busy? false :prev-streak 1
       :pending-claims [] :in-process-claims []}]
  (let [{:keys [findings]} (sw/assemble-findings degraded-snapshot)
        keys-found (set (map :key findings))]
    (assert-true "multiple simultaneous degradations all surface"
                 (every? keys-found ["proc-coder" "handoffd" "failed-box" "stuck-p1" "claim-risk-hardener"]))
    (assert-true "second consecutive idle sweep also raises swarm-starved among the rest"
                 (contains? keys-found "swarm-starved"))))

;; BL-631 required_wiring: proves the pure check actually reaches
;; assemble-findings's own vector - a gather fn and a pure check that are
;; both unit-tested but never wired into THIS function leave the detection
;; at zero on the real 5-minute tick (the BL-419 shape this entry guards
;; against). An otherwise-green snapshot carrying :offending-commits alone
;; must surface the CRIT finding.
(let [snapshot-with-offender
      (merge {:now-ms 1000000 :roles [] :handoffd-alive? true :handoffd-supervisor-alive? true
              :handoffd-log-age-secs 5 :handoffd-max-age-secs 300 :failed-count 0 :stuck-parcels []
              :available-mb 4000 :mem-floor-mb 1500 :claim-risks [] :rotate-note nil
              :pause {:active? false :until-ms nil} :active-ticket-count 0 :any-pane-busy? false
              :prev-streak 0 :pending-claims [] :in-process-claims []}
             {:offending-commits [{:sha "4851901ed" :subject "coder: merge BL-590 fix" :paths ["extension/src/foo.ts"]}]
              :ancestry-unavailable? false})]
  (let [{:keys [findings]} (sw/assemble-findings snapshot-with-offender)]
    (assert-true "an offending commit reaches assemble-findings's own output as a CRIT finding"
                 (some #(= "pipeline-code-on-main-4851901ed" (:key %)) findings))))

(let [snapshot-ancestry-unavailable
      (merge {:now-ms 1000000 :roles [] :handoffd-alive? true :handoffd-supervisor-alive? true
              :handoffd-log-age-secs 5 :handoffd-max-age-secs 300 :failed-count 0 :stuck-parcels []
              :available-mb 4000 :mem-floor-mb 1500 :claim-risks [] :rotate-note nil
              :pause {:active? false :until-ms nil} :active-ticket-count 0 :any-pane-busy? false
              :prev-streak 0 :pending-claims [] :in-process-claims []}
             {:offending-commits [] :ancestry-unavailable? true})]
  (let [{:keys [findings]} (sw/assemble-findings snapshot-ancestry-unavailable)]
    (assert-true "an unresolvable swarmforge-QA ref reaches assemble-findings's own output as UNAVAILABLE, never a silent all-clear"
                 (some #(and (= "pipeline-code-on-main" (:key %)) (= "UNAVAILABLE" (:severity %))) findings))))

;; ── BL-685: check-resident-stranded (Class B - no rotate note exists) ──────

(def stranded-base
  {:rotation-router? true
   :rotation-home "coder"
   :resident-active-role "specifier"
   :resident-active-role-mtime-ms 0
   :resident-pane-busy? false
   :resident-mailbox-empty? true
   :dispatch-note-pending? false
   :paused? false
   :now-ms (* 20 60 1000)})

(assert-true "stranded shape (non-home, idle, empty box, no dispatch note, past grace) fires CRIT"
             (let [f (sw/check-resident-stranded stranded-base)]
               (and f (= "CRIT" (:severity f)) (= "resident-stranded-specifier" (:key f)))))

(assert-true "the finding names the role the resident is stuck in"
             (str/includes? (:message (sw/check-resident-stranded stranded-base)) "specifier"))

(assert-nil "suppressor: at home (active role IS the home role) -> no finding"
            (sw/check-resident-stranded (assoc stranded-base :resident-active-role "coder")))

(assert-nil "suppressor: home comparison is case-insensitive (QA vs qa never reads as stranded-away)"
            (sw/check-resident-stranded (assoc stranded-base :rotation-home "QA" :resident-active-role "qa")))

(assert-nil "suppressor: resident pane busy -> no finding"
            (sw/check-resident-stranded (assoc stranded-base :resident-pane-busy? true)))

(assert-nil "suppressor: mailbox holds work (new or in_process) -> no finding"
            (sw/check-resident-stranded (assoc stranded-base :resident-mailbox-empty? false)))

(assert-nil "suppressor: a dispatch note to the coordinator is pending -> no finding"
            (sw/check-resident-stranded (assoc stranded-base :dispatch-note-pending? true)))

(assert-nil "suppressor: within the grace period -> no finding"
            (sw/check-resident-stranded (assoc stranded-base :now-ms (* 5 60 1000))))

(assert-nil "suppressor: not a rotation-router pack -> no finding (topology out of scope)"
            (sw/check-resident-stranded (assoc stranded-base :rotation-router? false)))

(assert-nil "suppressor: swarm paused -> no finding (consistent with rotate-not-honored)"
            (sw/check-resident-stranded (assoc stranded-base :paused? true)))

(assert-nil "fail open: no active-role marker at all -> no finding"
            (sw/check-resident-stranded (assoc stranded-base :resident-active-role nil)))

(assert-nil "fail open: marker mtime unavailable -> no finding (grace cannot be proven)"
            (sw/check-resident-stranded (assoc stranded-base :resident-active-role-mtime-ms nil)))

(assert-true "a stranded finding is nudge-eligible (CRIT rides the standard dedup/cooldown)"
             (sw/nudge-eligible? (sw/check-resident-stranded stranded-base)))

;; BL-685 required_wiring: the check must be reached from assemble-findings's
;; own vector (the BL-419 shape guard), and it must fire with NO rotate note
;; in the snapshot at all - Class B is DEFINED by no rotate note existing, so
;; a wiring that reads the role off :rotate-note reads nil in every real
;; occurrence (the ticket's own Wiring finding 1).
(let [snapshot-stranded
      (merge {:now-ms (* 20 60 1000) :roles [] :handoffd-alive? true :handoffd-supervisor-alive? true
              :handoffd-log-age-secs 5 :handoffd-max-age-secs 300 :failed-count 0 :stuck-parcels []
              :available-mb 4000 :mem-floor-mb 1500 :claim-risks [] :rotate-note nil
              :pause {:active? false :until-ms nil} :active-ticket-count 0 :any-pane-busy? false
              :prev-streak 0 :pending-claims [] :in-process-claims []}
             {:rotation-router? true :rotation-home "coder"
              :resident-active-role "specifier" :resident-active-role-mtime-ms 0
              :resident-pane-busy? false :resident-mailbox-empty? true
              :dispatch-note-pending? false})]
  (let [{:keys [findings]} (sw/assemble-findings snapshot-stranded)
        keys-found (set (map :key findings))]
    (assert-true "a stranded resident reaches assemble-findings's own output, with :rotate-note nil"
                 (contains? keys-found "resident-stranded-specifier"))
    (assert-true "no rotate-unhonored finding accompanies it (the two checks are additive, scenario 03)"
                 (not-any? #(str/starts-with? (str %) "rotate-unhonored") keys-found))))

(def bl779-timed-until-ms (.toEpochMilli (java.time.Instant/parse "2026-08-02T08:00:00Z")))
(assert= "BL-779: all-clear line names timed pause"
         "OK all checks green — control pause active until 2026-08-02T08:00:00Z"
         (sw/format-all-clear-line {:pause-active? true :pause-until-ms bl779-timed-until-ms}))
(assert= "BL-779: all-clear line names operator-resume pause"
         "OK all checks green — control pause active until operator resumes"
         (sw/format-all-clear-line {:pause-active? true :pause-until-ms nil}))
(assert= "BL-779: no pause keeps standard all-clear"
         "OK all checks green"
         (sw/format-all-clear-line {:pause-active? false :pause-until-ms nil}))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "master_main_reconcile_lib.bb")))

(assert-true "BL-1187: active deadlock emits CRIT main-sync-deadlock finding"
             (let [f (sw/check-main-sync-deadlock
                      {:deadlock-active? true :ahead 144 :behind 593 :reason "dirty"
                       :overlapping-paths ["backlog/active/BL-709.yaml"]})]
               (and f (= "main-sync-deadlock" (:key f)) (= "CRIT" (:severity f))
                    (str/includes? (:message f) "backlog/active/BL-709.yaml")
                    (str/includes? (:message f) "./swarm heal")
                    (str/includes? (:message f) "Not /pilot"))))

(assert-nil "BL-1187: inactive deadlock emits no finding"
            (sw/check-main-sync-deadlock {:deadlock-active? false}))

(assert-true "BL-1187: main-sync-deadlock escalates but does not nudge coordinator"
             (let [f (sw/check-main-sync-deadlock
                      {:deadlock-active? true :ahead 3 :behind 1 :reason "dirty"
                       :overlapping-paths []})]
               (and f (sw/escalation-eligible? f) (not (sw/nudge-eligible? f)))))

;; ── BL-1832: seat-expected-agents ────────────────────────────────────────
;; Scenario 01 rows: a mixed-agent router pack, home coder on aider, QA
;; rotated in active - the home pane is healthy on EITHER agent.
(assert= "BL-1832 (01a): router pack, resident active as a different role - both agents acceptable"
         #{"aider" "claude"}
         (sw/seat-expected-agents {:rotation-router? true :home-role "coder"
                                    :active-role "QA"
                                    :role-agent->token {"coder" "aider" "QA" "claude"}}))

(assert= "BL-1832 (01b): resident at home (active role == home role) - single agent, same as today"
         #{"aider"}
         (sw/seat-expected-agents {:rotation-router? true :home-role "coder"
                                    :active-role "coder"
                                    :role-agent->token {"coder" "aider" "QA" "claude"}}))

;; Scenario 02: neither agent present is still a half-launch CRIT - that
;; decision stays in check-live-session's :has-claude-process? branch,
;; unaffected by this resolver; covered here only by confirming the
;; resolver itself never returns an empty or unbounded set.
(assert-true "BL-1832 (02): the acceptable set never includes an agent neither role declares"
             (not (contains? (sw/seat-expected-agents
                              {:rotation-router? true :home-role "coder" :active-role "QA"
                               :role-agent->token {"coder" "aider" "QA" "claude"}})
                             "cursor-agent")))

;; Scenario 03: no rotation router at all - judged on the home agent alone,
;; exactly as pre-BL-1832.
(assert= "BL-1832 (03): outside rotation router, only the home role's own agent is acceptable"
         #{"aider"}
         (sw/seat-expected-agents {:rotation-router? false :home-role "coder"
                                    :active-role "QA"
                                    :role-agent->token {"coder" "aider" "QA" "claude"}}))

;; Scenario 04 (BL-1345 invariant 3): no HONOURED active role - a standing
;; pack, or an absent/unknown marker - reaches the caller as `active-role`
;; nil, same as every other marker consumer's gate. Judged on the home
;; agent alone.
(assert= "BL-1832 (04): no honoured active role (standing pack / absent-or-unknown marker) - home agent alone"
         #{"aider"}
         (sw/seat-expected-agents {:rotation-router? true :home-role "coder"
                                    :active-role nil
                                    :role-agent->token {"coder" "aider"}}))

(assert= "BL-1832: an unmapped role falls back to \"claude\", the same default gather-role's own (or agent \"claude\") uses"
         #{"aider" "claude"}
         (sw/seat-expected-agents {:rotation-router? true :home-role "coder"
                                    :active-role "QA"
                                    :role-agent->token {"coder" "aider"}}))

;; ── check 8b: local-window-fit (BL-1848) ─────────────────────────────────────
;; Pure: every fact (the /api/ps models and the qwen usage rows) is injected,
;; and now-ms is passed in. Sizes arrive in bytes, as Ollama reports them.
(def bl1848-mib 1048576)
(def bl1848-now 1800000000000)
(defn bl1848-model [name in-vram-mib total-mib ctx]
  {:name name :size (* total-mib bl1848-mib) :size-vram (* in-vram-mib bl1848-mib)
   :context-length ctx})
(defn bl1848-row [model in out minutes-ago]
  {:model model :input-tokens in :output-tokens out
   :timestamp-ms (- bl1848-now (* minutes-ago 60000))})
(def bl1848-iq3 "ista-iq3s-coder:latest")

(assert= "BL-1848: no facts (Ollama not answering) is no window finding"
         [] (sw/check-local-window-fit nil bl1848-now))
(assert= "BL-1848: Ollama answering with nothing loaded is no window finding"
         [] (sw/check-local-window-fit {:models [] :usage []} bl1848-now))
(assert= "BL-1848: a model fully in VRAM with no recent request is no window finding"
         [] (sw/check-local-window-fit {:models [(bl1848-model bl1848-iq3 13818 13818 49152)]
                                        :usage []} bl1848-now))
(let [[f & more] (sw/check-local-window-fit
                  {:models [(bl1848-model bl1848-iq3 12400 13818 49152)] :usage []} bl1848-now)]
  (assert= "BL-1848: a model partly outside VRAM raises exactly one finding" nil more)
  (assert= "BL-1848: VRAM finding is CRIT keyed local-window-vram-<model>"
           ["CRIT" "local-window-vram-ista-iq3s-coder:latest"] [(:severity f) (:key f)])
  (assert-true "BL-1848: VRAM message names the model, 12400 of 13818 MiB and the 49152 context"
               (every? #(str/includes? (str (:message f)) %)
                       [bl1848-iq3 "12400 of 13818 MiB" "49152"]))
  (assert-true "BL-1848: VRAM message ends with the flash-attention / q8_0 / second-model hint"
               (every? #(str/includes? (str (:message f)) %)
                       ["OLLAMA_FLASH_ATTENTION=1" "OLLAMA_KV_CACHE_TYPE=q8_0" "second model" "num_ctx"])))

;; 90% of 49152 is 44236.8; the threshold is its ceiling, 44237.
(assert= "BL-1848: the size threshold is the ceiling of 90% of the window"
         44237 (sw/local-window-size-threshold 49152))
(assert= "BL-1848: a 44236-token request is one under the threshold - no finding"
         [] (sw/check-local-window-fit {:models [(bl1848-model bl1848-iq3 13818 13818 49152)]
                                        :usage [(bl1848-row bl1848-iq3 40000 4236 10)]}
                                       bl1848-now))
(let [[f & more] (sw/check-local-window-fit
                  {:models [(bl1848-model bl1848-iq3 13818 13818 49152)]
                   :usage [(bl1848-row bl1848-iq3 20000 4000 5)
                           (bl1848-row bl1848-iq3 30800 14100 10)
                           (bl1848-row bl1848-iq3 40000 4237 30)]}
                  bl1848-now)]
  (assert= "BL-1848: a request at the threshold raises exactly one size finding" nil more)
  (assert= "BL-1848: size finding is CRIT keyed local-window-size-<model>"
           ["CRIT" "local-window-size-ista-iq3s-coder:latest"] [(:severity f) (:key f)])
  (assert-true "BL-1848: size message names the PEAK (44900), its split and the context"
               (every? #(str/includes? (str (:message f)) %)
                       [bl1848-iq3 "44900-token" "30800 in" "14100 out" "49152"]))
  (assert-true "BL-1848: size message ends with the num_ctx / 34 KiB per token hint"
               (every? #(str/includes? (str (:message f)) %)
                       ["num_ctx" "BL-1838" "34 KiB"])))
(assert= "BL-1848: a request older than 60 minutes is outside the look-back"
         [] (sw/check-local-window-fit {:models [(bl1848-model bl1848-iq3 13818 13818 49152)]
                                        :usage [(bl1848-row bl1848-iq3 40000 7000 61)]}
                                       bl1848-now))
(assert= "BL-1848: a request exactly 60 minutes old is still inside the look-back"
         ["local-window-size-ista-iq3s-coder:latest"]
         (mapv :key (sw/check-local-window-fit
                     {:models [(bl1848-model bl1848-iq3 13818 13818 49152)]
                      :usage [(bl1848-row bl1848-iq3 40000 7000 60)]}
                     bl1848-now)))
(assert= "BL-1848: another model's request is never judged against this model's window"
         [] (sw/check-local-window-fit {:models [(bl1848-model bl1848-iq3 13818 13818 49152)]
                                        :usage [(bl1848-row "other-model:latest" 40000 7000 10)]}
                                       bl1848-now))
(assert= "BL-1848: a model with no reported context_length gets no size judgment"
         [] (sw/check-local-window-fit {:models [(bl1848-model bl1848-iq3 13818 13818 nil)]
                                        :usage [(bl1848-row bl1848-iq3 40000 7000 10)]}
                                       bl1848-now))
(assert= "BL-1848: rows with no timestamp are skipped, never read as now"
         [] (sw/check-local-window-fit {:models [(bl1848-model bl1848-iq3 13818 13818 49152)]
                                        :usage [(dissoc (bl1848-row bl1848-iq3 40000 7000 10) :timestamp-ms)]}
                                       bl1848-now))
(assert= "BL-1848: both limits on one model, and a second model's spill, all reported in /api/ps order"
         ["local-window-vram-ista-iq3s-coder:latest" "local-window-size-ista-iq3s-coder:latest"
          "local-window-vram-qwen2.5-coder-14b-q5km:latest"]
         (mapv :key (sw/check-local-window-fit
                     {:models [(bl1848-model bl1848-iq3 12400 13818 49152)
                               (bl1848-model "qwen2.5-coder-14b-q5km:latest" 9000 11000 32768)]
                      :usage [(bl1848-row bl1848-iq3 40000 7000 10)]}
                     bl1848-now)))
(assert-true "BL-1848: assemble-findings carries the window finding with the other findings"
             (some #(and (= "local-window-vram-ista-iq3s-coder:latest" (:key %)) (= "CRIT" (:severity %)))
                   (:findings (sw/assemble-findings
                               {:roles [] :now-ms bl1848-now :available-mb 9000 :mem-floor-mb 1500
                                :local-windows {:models [(bl1848-model bl1848-iq3 12400 13818 49152)]
                                                :usage []}}))))
(assert-true "BL-1848: a snapshot with no window facts adds no window finding to the sweep"
             (not-any? #(str/starts-with? (str (:key %)) "local-window-")
                       (:findings (sw/assemble-findings
                                   {:roles [] :now-ms bl1848-now :available-mb 9000 :mem-floor-mb 1500}))))

;; held-ticket-id: a Work note carries its ticket in message, not task (2026-10-04)
(assert= "held-ticket-id: a git_handoff's task header" "BL-1858" (sw/held-ticket-id "BL-1858" nil))
(assert= "held-ticket-id: a bounce task keeps only the id" "BL-1851" (sw/held-ticket-id "BL-1851 [behavior: x]" nil))
(assert= "held-ticket-id: a Work note's message" "BL-1931" (sw/held-ticket-id nil "Work BL-1931: merge main first, then read backlog/active"))
(assert= "held-ticket-id: a merge-up note names no held ticket" nil (sw/held-ticket-id nil "BL-1861 QA-approved 1a69e2f1a2 - merge your branch up to QA's"))
(assert= "held-ticket-id: neither header" nil (sw/held-ticket-id nil nil))

;; progress-origin-ms: a merge of main never restarts the stuck clock (2026-10-04)
(assert= "progress-origin-ms: no own commit -> the claim" 1000 (sw/progress-origin-ms 1000 nil))
(assert= "progress-origin-ms: a later own commit restarts it" 5000 (sw/progress-origin-ms 1000 5000))
(assert= "progress-origin-ms: an own commit before the claim does not" 1000 (sw/progress-origin-ms 1000 500))
(assert= "progress-origin-ms: neither" nil (sw/progress-origin-ms nil nil))

;; ── BL-1963: deterministic pack — coordinator never stands ─────────────────
;; should-stand-role? gets the pack's coordinator_mode. On a deterministic
;; pack the coordinator is not expected to stand: no CRIT, no repair.
;; A pack without the declaration still gets the CRIT and repair.
(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "coordinator_config_lib.bb")))
(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "mono_router_lib.bb")))

;; Invariant 1: deterministic pack → coordinator should-stand? is false
(assert-nil "BL-1963: deterministic pack — coordinator missing session is suppressed"
            (sw/check-live-session {:role "coordinator" :pane-exists? false
                                     :has-claude-process? false :should-stand? false}))

;; Invariant 2: non-deterministic pack → coordinator still gets CRIT + repair
(assert-true "BL-1963: non-deterministic pack — coordinator missing session is CRIT with repair"
             (let [f (sw/check-live-session {:role "coordinator" :pane-exists? false
                                              :has-claude-process? false :should-stand? true})]
               (and f (= "CRIT" (:severity f)) (= "pane-coordinator" (:key f))
                    (= {:action :ensure-session :role "coordinator"} (:repair f)))))

(when (seq @failures)
  (binding [*out* *err*]
    (doseq [f @failures] (println f)))
  (System/exit 1))

(println "babysitterd_sweep_lib_test_runner: ok")
