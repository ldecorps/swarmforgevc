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

;; ── check 2: remote-control-flag ─────────────────────────────────────────────
(assert-nil "green role (rc flag present) produces no rc finding"
            (sw/check-remote-control {:role "coder" :pane-exists? true :has-claude-process? true :has-remote-control? true}))
(assert-nil "no rc finding when the process itself is already missing (check 1 owns that)"
            (sw/check-remote-control {:role "coder" :pane-exists? true :has-claude-process? false :has-remote-control? false}))
(assert-true "live process missing --remote-control is WARN rc-<role>"
             (let [f (sw/check-remote-control {:role "coder" :pane-exists? true :has-claude-process? true :has-remote-control? false})]
               (and f (= "WARN" (:severity f)) (= "rc-coder" (:key f)))))

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
                       :active-role "coder" :paused? false})]
               (and f (= "CRIT" (:severity f))
                    (str/includes? (:message f) "000741_rotate")
                    (str/includes? (:message f) "architect")
                    (str/includes? (:message f) "coder"))))
(assert-nil "honored rotate (active-role file newer than the note) produces no finding"
            (sw/check-rotate-not-honored
             {:note-name "000741_rotate" :note-target "architect"
              :note-age-min 15 :grace-min 10
              :note-mtime-ms 1000 :active-role-file-mtime-ms 2000
              :active-role "architect" :paused? false}))
(assert-nil "note within grace period produces no finding yet"
            (sw/check-rotate-not-honored
             {:note-name "000741_rotate" :note-target "architect"
              :note-age-min 5 :grace-min 10
              :note-mtime-ms 2000 :active-role-file-mtime-ms 1000
              :active-role "coder" :paused? false}))
(assert-nil "no rotate note at all produces no finding"
            (sw/check-rotate-not-honored nil))
(assert-nil "planned pause suppresses rotate-not-honored even past grace"
            (sw/check-rotate-not-honored
             {:note-name "000741_rotate" :note-target "architect"
              :note-age-min 999 :grace-min 10
              :note-mtime-ms 2000 :active-role-file-mtime-ms 1000
              :active-role "coder" :paused? true}))

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

;; ── 6d-10: aged in_process claim under active work does not read as starvation ─
(assert= "aged in_process claim whose owning resident is busy does not contribute to starvation"
         {:finding nil :new-streak 0}
         (sw/check-swarm-starved
          {:active-ticket-count 2 :any-pane-busy? false :paused? false :prev-streak 1
           :pending-claims []
           :in-process-claims [{:age-min 45 :owner-busy? true}]}))
(assert-true "same-aged in_process claim whose owning resident is idle DOES contribute to starvation"
             (let [{:keys [finding new-streak]}
                   (sw/check-swarm-starved
                    {:active-ticket-count 2 :any-pane-busy? false :paused? false :prev-streak 1
                     :pending-claims []
                     :in-process-claims [{:age-min 45 :owner-busy? false}]})]
               (and finding (= 2 new-streak))))

;; ── 6d-09: busy detection survives 80-column truncation ─────────────────────
(assert-true "literal 'esc to interrupt' reads busy"
             (sw/classify-pane-busy? "some output\n  esc to interrupt\n"))
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

(when (seq @failures)
  (binding [*out* *err*]
    (doseq [f @failures] (println f)))
  (System/exit 1))

(println "babysitterd_sweep_lib_test_runner: ok")
