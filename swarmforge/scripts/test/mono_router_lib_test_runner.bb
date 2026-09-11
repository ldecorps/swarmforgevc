#!/usr/bin/env bb
;; TDD runner for mono_router_lib.bb
(ns mono-router-lib-test-runner
  (:require [babashka.fs :as fs]
            [babashka.process :as process]
            [clojure.string :as str]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "mono_router_lib.bb")))
(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "flow_watchdog_lib.bb")))

(def failures (atom []))

(defn assert= [msg expected actual]
  (when (not= expected actual)
    (swap! failures conj (str "FAIL: " msg "\n  expected: " (pr-str expected) "\n  actual:   " (pr-str actual)))))

(defn assert-true [msg expr]
  (when-not expr
    (swap! failures conj (str "FAIL: " msg))))

(def roles ["coder" "specifier" "cleaner" "architect" "hardender" "documenter" "QA" "coordinator"])

(assert-true "conf detects rotation router"
             (mono-router-lib/conf-rotation-router?
              "config active_backlog_max_depth 1\nconfig rotation router\nwindow coder aider\n"))
(assert-true "conf without rotation is false"
             (not (mono-router-lib/conf-rotation-router?
                   "config active_backlog_max_depth -1\nwindow coder aider\n")))

(assert= "coder is resident" :resident (mono-router-lib/classify-role roles "coder"))
(assert= "coordinator stands" :coordinator (mono-router-lib/classify-role roles "coordinator"))
(assert= "QA dormant" :dormant (mono-router-lib/classify-role roles "QA"))
(assert= "specifier dormant" :dormant (mono-router-lib/classify-role roles "specifier"))

(assert-true "resident should stand"
             (mono-router-lib/should-have-standing-session? roles "coder"))
(assert-true "QA should not stand"
             (not (mono-router-lib/should-have-standing-session? roles "QA")))

(assert= "illicit standing QA"
         :teardown-illicit
         (mono-router-lib/topology-action roles "QA" true))
(assert= "missing resident"
         :ensure-standing
         (mono-router-lib/topology-action roles "coder" false))
(assert= "dormant missing ok"
         :dormant-ok
         (mono-router-lib/topology-action roles "specifier" false))
(assert= "coordinator ok"
         :ok
         (mono-router-lib/topology-action roles "coordinator" true))

(assert= "rotate-viable: resident dead"
         {:viable? false :reason "no live resident session to rotate from"}
         (mono-router-lib/rotate-viable?
          {:resident-alive? false :launch-script-present? true}))
(assert= "rotate-viable: resident alive, script missing"
         {:viable? false :reason "missing launch script for role"}
         (mono-router-lib/rotate-viable?
          {:resident-alive? true :launch-script-present? false}))
(assert= "rotate-viable: resident alive, script present"
         {:viable? true}
         (mono-router-lib/rotate-viable?
          {:resident-alive? true :launch-script-present? true}))
(assert= "rotate-viable: resident-first precedence when both broken"
         {:viable? false :reason "no live resident session to rotate from"}
         (mono-router-lib/rotate-viable?
          {:resident-alive? false :launch-script-present? false}))

;; BL-805: resident-invoked rotation gate decision - pure over already-
;; filtered inputs (callers resolve blocking-file via handoff-lib's
;; *.handoff-only listing before calling this).
(assert= "rotate-gate: no blocking file proceeds"
         :proceed
         (mono-router-lib/rotate-gate-decision {:blocking-file nil :force? false}))
(assert= "rotate-gate: no blocking file proceeds even if force is set"
         :proceed
         (mono-router-lib/rotate-gate-decision {:blocking-file nil :force? true}))
(assert= "rotate-gate: blocking file refuses without force"
         :refuse
         (mono-router-lib/rotate-gate-decision
          {:blocking-file "/wt/.swarmforge/handoffs/inbox/in_process/00_x.handoff" :force? false}))
(assert= "rotate-gate: blocking file with force proceeds-forced"
         :proceed-forced
         (mono-router-lib/rotate-gate-decision
          {:blocking-file "/wt/.swarmforge/handoffs/inbox/in_process/00_x.handoff" :force? true}))

;; BL-926: rotating INTO the role that already owns the blocking parcel is
;; not abandonment - it is the only way that parcel gets picked up. Table
;; mirrors specs/features/BL-926-...feature Scenario Outline exactly.
(assert= "rotate-gate: same-role rotation proceeds even with a real blocking parcel"
         :proceed
         (mono-router-lib/rotate-gate-decision
          {:blocking-file "/wt/.swarmforge/handoffs/inbox/in_process/00_x.handoff"
           :force? false :active-role "coder" :target-role "coder"}))
(assert= "rotate-gate: different-role rotation still refuses over a real blocking parcel"
         :refuse
         (mono-router-lib/rotate-gate-decision
          {:blocking-file "/wt/.swarmforge/handoffs/inbox/in_process/00_x.handoff"
           :force? false :active-role "coder" :target-role "documenter"}))
(assert= "rotate-gate: no blocking file proceeds regardless of active/target roles"
         :proceed
         (mono-router-lib/rotate-gate-decision
          {:blocking-file nil :force? false :active-role "coder" :target-role "documenter"}))
(assert= "rotate-gate: force override still behaves exactly as BL-805 specified, even on same-role ownership"
         :proceed-forced
         (mono-router-lib/rotate-gate-decision
          {:blocking-file "/wt/.swarmforge/handoffs/inbox/in_process/00_x.handoff"
           :force? true :active-role "coder" :target-role "coder"}))
(assert= "rotate-gate: omitting active-role/target-role keeps BL-805 behavior (refuse)"
         :refuse
         (mono-router-lib/rotate-gate-decision
          {:blocking-file "/wt/.swarmforge/handoffs/inbox/in_process/00_x.handoff" :force? false}))
(assert= "rotate-gate: active-role given without target-role never matches - refuses"
         :refuse
         (mono-router-lib/rotate-gate-decision
          {:blocking-file "/wt/.swarmforge/handoffs/inbox/in_process/00_x.handoff"
           :force? false :active-role "coder" :target-role nil}))

(let [sum (mono-router-lib/summarize-topology
           roles
           [{:role "coder" :alive? false}
            {:role "QA" :alive? true}
            {:role "coordinator" :alive? true}])]
  (assert= "one illicit" 1 (count (:illicit sum)))
  (assert= "one missing standing" 1 (count (:missing-standing sum))))

(assert-true "identity rotation=router"
             (mono-router-lib/rotation-router-from-identity?
              "swarm_name\tprimary\nrotation\trouter\n"))

;; Dormant-mailbox chase: never false-wake the resident as the wrong identity
(assert= "own session wakes itself"
         :wake-own-session
         (mono-router-lib/dormant-mailbox-chase-action
          {:target-session-exists? true
           :resident-session-exists? true
           :active-role "coder"
           :target-role "cleaner"}))
(assert= "dormant + wrong identity → rotate"
         :rotate
         (mono-router-lib/dormant-mailbox-chase-action
          {:target-session-exists? false
           :resident-session-exists? true
           :active-role "coder"
           :target-role "cleaner"}))
(assert= "dormant + already that role, live identity agrees → wake resident"
         :wake-resident
         (mono-router-lib/dormant-mailbox-chase-action
          {:target-session-exists? false
           :resident-session-exists? true
           :active-role "cleaner"
           :target-role "cleaner"
           :live-role "cleaner"}))
(assert= "no resident degrades to own-session wake"
         :wake-own-session
         (mono-router-lib/dormant-mailbox-chase-action
          {:target-session-exists? false
           :resident-session-exists? false
           :active-role "coder"
           :target-role "cleaner"}))

;; BL-921: the marker alone is never sufficient evidence - a diverged or
;; unreadable live identity must still route to :rotate, never :wake-resident.
(assert= "BL-921: marker matches but live identity diverged → rotate, not wake"
         :rotate
         (mono-router-lib/dormant-mailbox-chase-action
          {:target-session-exists? false
           :resident-session-exists? true
           :active-role "cleaner"
           :target-role "cleaner"
           :live-role "coder"}))
(assert= "BL-921: marker matches but live identity unreadable (nil) → rotate"
         :rotate
         (mono-router-lib/dormant-mailbox-chase-action
          {:target-session-exists? false
           :resident-session-exists? true
           :active-role "cleaner"
           :target-role "cleaner"
           :live-role nil}))
(assert= "BL-921: marker matches but live identity unreadable (blank) → rotate"
         :rotate
         (mono-router-lib/dormant-mailbox-chase-action
          {:target-session-exists? false
           :resident-session-exists? true
           :active-role "cleaner"
           :target-role "cleaner"
           :live-role "   "}))
(assert= "BL-921: marker itself already wrong stays rotate regardless of live-role"
         :rotate
         (mono-router-lib/dormant-mailbox-chase-action
          {:target-session-exists? false
           :resident-session-exists? true
           :active-role "coder"
           :target-role "cleaner"
           :live-role "coder"}))
(assert= "BL-921: a role with its own standing session is unaffected by either identity"
         :wake-own-session
         (mono-router-lib/dormant-mailbox-chase-action
          {:target-session-exists? true
           :resident-session-exists? true
           :active-role "architect"
           :target-role "architect"
           :live-role "coder"}))

(assert= "ensure restores cleaner when marker says cleaner"
         "cleaner"
         (mono-router-lib/resident-launch-role "coder" "cleaner"))
(assert= "ensure falls back to home when marker empty"
         "coder"
         (mono-router-lib/resident-launch-role "coder" "  "))
(assert= "ensure falls back to home when marker nil"
         "coder"
         (mono-router-lib/resident-launch-role "coder" nil))

;; ── BL-648: resolve-boot-role (boot-time, distinct from resident-launch-role
;;    above which only ever runs against an already-alive pane) ────────────

(def bl648-known-roles ["coder" "specifier" "cleaner" "architect" "hardender" "documenter" "QA" "coordinator"])

(assert= "BL-648-01: recorded QA boots the resident as QA"
         {:role "QA" :fallback? false :reason nil :recorded "QA"}
         (mono-router-lib/resolve-boot-role
          {:home-role "coder" :recorded-role "QA"
           :known-roles bl648-known-roles :rotation-mode "router"}))

(assert= "BL-648-02: missing marker boots home"
         {:role "coder" :fallback? false :reason :blank :recorded nil}
         (mono-router-lib/resolve-boot-role
          {:home-role "coder" :recorded-role nil
           :known-roles bl648-known-roles :rotation-mode "router"}))

(assert= "BL-648-02: blank marker boots home"
         {:role "coder" :fallback? false :reason :blank :recorded nil}
         (mono-router-lib/resolve-boot-role
          {:home-role "coder" :recorded-role "   "
           :known-roles bl648-known-roles :rotation-mode "router"}))

(assert= "BL-648-03: unknown recorded role falls back to home, loudly (fallback? true)"
         {:role "coder" :fallback? true :reason :unknown-role :recorded "not-a-role"}
         (mono-router-lib/resolve-boot-role
          {:home-role "coder" :recorded-role "not-a-role"
           :known-roles bl648-known-roles :rotation-mode "router"}))

(assert= "BL-648-06: non-router pack ignores the marker entirely, even a valid one"
         {:role "coder" :fallback? false :reason :not-router :recorded "QA"}
         (mono-router-lib/resolve-boot-role
          {:home-role "coder" :recorded-role "QA"
           :known-roles bl648-known-roles :rotation-mode nil}))

(assert= "BL-648: sequential rotation also ignores the marker (router-only read)"
         {:role "coder" :fallback? false :reason :not-router :recorded "QA"}
         (mono-router-lib/resolve-boot-role
          {:home-role "coder" :recorded-role "QA"
           :known-roles bl648-known-roles :rotation-mode "sequential"}))

;; ── BL-1020: resolve-resident-role (topology from pack config, not leftover) ─

(assert= "BL-1020-01: standing pack ignores leftover marker; role from pack config"
         {:role "coder" :honour-marker? false :stale? true :recorded "specifier"}
         (mono-router-lib/resolve-resident-role
          {:rotation-router? false :recorded-role "specifier" :home-role "coder"}))

(assert= "BL-1020-02: router pack still honours the marker"
         {:role "specifier" :honour-marker? true :stale? false :recorded "specifier"}
         (mono-router-lib/resolve-resident-role
          {:rotation-router? true :recorded-role "specifier" :home-role "coder"}))

(assert= "BL-1020-03: standing pack with leftover reports stale"
         true
         (:stale? (mono-router-lib/resolve-resident-role
                   {:rotation-router? false :recorded-role "specifier" :home-role "coder"})))

(assert= "BL-1020: standing pack with no marker is not stale"
         {:role "coder" :honour-marker? false :stale? false :recorded nil}
         (mono-router-lib/resolve-resident-role
          {:rotation-router? false :recorded-role nil :home-role "coder"}))

(assert= "BL-1020: blank marker on standing pack is not stale"
         {:role "coder" :honour-marker? false :stale? false :recorded nil}
         (mono-router-lib/resolve-resident-role
          {:rotation-router? false :recorded-role "  " :home-role "coder"}))

(assert= "BL-1020: router with no marker falls back to home without stale"
         {:role "coder" :honour-marker? false :stale? false :recorded nil}
         (mono-router-lib/resolve-resident-role
          {:rotation-router? true :recorded-role nil :home-role "coder"}))

(assert-true "clearing stuck email always ok"
             (mono-router-lib/should-send-stuck-escalation-email?
              {:escalated? false :session-exists? false}))
(assert-true "standing role may get stuck email"
             (mono-router-lib/should-send-stuck-escalation-email?
              {:escalated? true :session-exists? true}))
(assert-true "dormant escalate skips email"
             (not (mono-router-lib/should-send-stuck-escalation-email?
                   {:escalated? true :session-exists? false})))

(assert-true "in_process mail is actionable"
             (mono-router-lib/actionable-mail? {:in-process-count 1 :git-handoff-count 0}))
(assert-true "git_handoff in new is actionable"
             (mono-router-lib/actionable-mail? {:in-process-count 0 :git-handoff-count 1}))
(assert-true "rule_proposal in new is immediately actionable (directed, not broadcast)"
             (mono-router-lib/actionable-mail?
              {:in-process-count 0 :git-handoff-count 0 :rule-proposal-count 1}))
(assert-true "empty mailbox is not actionable"
             (not (mono-router-lib/actionable-mail? {:in-process-count 0 :git-handoff-count 0})))
(assert-true "rule-proposal-count absent behaves as before (no regression)"
             (not (mono-router-lib/actionable-mail? {:in-process-count 0 :git-handoff-count 0})))

(assert= "newest actionable role wins when priorities equal/absent"
         "architect"
         (mono-router-lib/preferred-rotate-target
          [{:role "coder" :newest-created-at "2026-07-22T01:00:00Z" :actionable? false}
           {:role "cleaner" :newest-created-at "2026-07-22T02:00:00Z" :actionable? true}
           {:role "architect" :newest-created-at "2026-07-22T03:00:00Z" :actionable? true}]))

;; ── BL-636: priority-first rotate preference ──────────────────────────────
(assert= "BL-636: parse-priority-rank accepts 00"
         0 (mono-router-lib/parse-priority-rank "00"))
(assert= "BL-636: parse-priority-rank accepts 50"
         50 (mono-router-lib/parse-priority-rank "50"))
(assert= "BL-636: absent priority ranks worse than any valid"
         mono-router-lib/missing-priority-rank
         (mono-router-lib/parse-priority-rank nil))
(assert= "BL-636: blank priority ranks worse than any valid"
         mono-router-lib/missing-priority-rank
         (mono-router-lib/parse-priority-rank "  "))
(assert= "BL-636: unparseable priority ranks worse than any valid"
         mono-router-lib/missing-priority-rank
         (mono-router-lib/parse-priority-rank "xx"))
(assert= "BL-636: single-digit priority is unparseable"
         mono-router-lib/missing-priority-rank
         (mono-router-lib/parse-priority-rank "5"))
(assert= "BL-636: best-priority-rank takes the lowest"
         0 (mono-router-lib/best-priority-rank ["70" "00" "40"]))
(assert= "BL-636: best-priority-rank empty -> missing"
         mono-router-lib/missing-priority-rank
         (mono-router-lib/best-priority-rank []))

(assert= "BL-636: priority-00 beats newer priority-50"
         "specifier"
         (mono-router-lib/preferred-rotate-target
          [{:role "specifier" :newest-created-at "2026-07-25T10:00:00Z"
            :best-priority 0 :actionable? true}
           {:role "coder" :newest-created-at "2026-07-25T12:30:00Z"
            :best-priority 50 :actionable? true}]))

(assert= "BL-636: at equal priority, newest still wins"
         "architect"
         (mono-router-lib/preferred-rotate-target
          [{:role "cleaner" :newest-created-at "2026-07-25T10:00:00Z"
            :best-priority 50 :actionable? true}
           {:role "architect" :newest-created-at "2026-07-25T11:00:00Z"
            :best-priority 50 :actionable? true}]))

(assert= "BL-636: role ranked by best priority, not newest parcel's"
         "specifier"
         (mono-router-lib/preferred-rotate-target
          [{:role "specifier" :newest-created-at "2026-07-25T12:00:00Z"
            :best-priority 0 :actionable? true}
           {:role "coder" :newest-created-at "2026-07-25T11:00:00Z"
            :best-priority 40 :actionable? true}]))

(assert= "BL-636: missing priority never jumps ahead of a valid 90"
         "cleaner"
         (mono-router-lib/preferred-rotate-target
          [{:role "coder" :newest-created-at "2026-07-25T12:00:00Z"
            :best-priority mono-router-lib/missing-priority-rank :actionable? true}
           {:role "cleaner" :newest-created-at "2026-07-25T10:00:00Z"
            :best-priority 90 :actionable? true}]))

(assert= "busy resident blocks rotate"
         :busy
         (mono-router-lib/should-rotate-resident?
          {:active-role "coder" :target-role "cleaner" :resident-busy? true
           :last-rotate-at-ms 0 :now-ms 100000 :cooldown-ms 30000}))
(assert= "cooldown blocks rotate"
         :cooldown
         (mono-router-lib/should-rotate-resident?
          {:active-role "coder" :target-role "cleaner" :resident-busy? false
           :last-rotate-at-ms 90000 :now-ms 100000 :cooldown-ms 30000}))
(assert= "ready to rotate"
         :rotate
         (mono-router-lib/should-rotate-resident?
          {:active-role "coder" :target-role "cleaner" :resident-busy? false
           :last-rotate-at-ms 0 :now-ms 100000 :cooldown-ms 30000}))

;; BL-921: :already-active requires the marker AND the live identity to
;; agree with target-role - a stale marker must never refuse the rotate
;; that would actually fix the divergence.
(assert= "BL-921: marker and live identity both agree → already-active"
         :already-active
         (mono-router-lib/should-rotate-resident?
          {:active-role "cleaner" :target-role "cleaner" :live-role "cleaner"
           :resident-busy? false :last-rotate-at-ms 0 :now-ms 100000 :cooldown-ms 30000}))
(assert= "BL-921: marker agrees but live identity diverged → rotate, not already-active"
         :rotate
         (mono-router-lib/should-rotate-resident?
          {:active-role "cleaner" :target-role "cleaner" :live-role "coder"
           :resident-busy? false :last-rotate-at-ms 0 :now-ms 100000 :cooldown-ms 30000}))
(assert= "BL-921: marker agrees but live identity unreadable → rotate, not already-active"
         :rotate
         (mono-router-lib/should-rotate-resident?
          {:active-role "cleaner" :target-role "cleaner" :live-role nil
           :resident-busy? false :last-rotate-at-ms 0 :now-ms 100000 :cooldown-ms 30000}))
(assert= "BL-921: busy still wins over a live-agreeing marker"
         :busy
         (mono-router-lib/should-rotate-resident?
          {:active-role "cleaner" :target-role "cleaner" :live-role "cleaner"
           :resident-busy? true :last-rotate-at-ms 0 :now-ms 100000 :cooldown-ms 30000}))

;; ── BL-550: parse-rotation-home / rotate-home? ────────────────────────────
(assert= "reads config rotation_home"
         "documenter"
         (mono-router-lib/parse-rotation-home
          "config rotation router\nconfig rotation_home documenter\n"))
(assert= "defaults to coder when the line is absent"
         "coder"
         (mono-router-lib/parse-rotation-home "config rotation router\n"))
(assert= "defaults to coder on nil conf text"
         "coder"
         (mono-router-lib/parse-rotation-home nil))

(assert-true "non-home role, empty mailbox, mono-router -> rotate home"
             (mono-router-lib/rotate-home?
              {:rotation-router? true :role "documenter" :home-role "coder"
               :mailbox-empty? true}))
(assert-true "home role never rotates to itself"
             (not (mono-router-lib/rotate-home?
                   {:rotation-router? true :role "coder" :home-role "coder"
                    :mailbox-empty? true})))

(assert= "BL-691: busy + ignore-busy? allows rotate for ambulance patient"
         :rotate
         (mono-router-lib/should-rotate-resident?
          {:active-role "coder" :target-role "QA" :resident-busy? true :ignore-busy? true
           :last-rotate-at-ms 0 :now-ms 100000 :cooldown-ms 30000}))
(assert= "BL-691: busy without ignore-busy? still refuses"
         :busy
         (mono-router-lib/should-rotate-resident?
          {:active-role "coder" :target-role "QA" :resident-busy? true :ignore-busy? false
           :last-rotate-at-ms 0 :now-ms 100000 :cooldown-ms 30000}))

(assert-true "non-home role with mail stays put"
             (not (mono-router-lib/rotate-home?
                   {:rotation-router? true :role "cleaner" :home-role "coder"
                    :mailbox-empty? false})))
(assert-true "outside mono-router, no rotation at all"
             (not (mono-router-lib/rotate-home?
                   {:rotation-router? false :role "documenter" :home-role "coder"
                    :mailbox-empty? true})))
(assert-true "a different home role is honored, not hard-coded"
             (mono-router-lib/rotate-home?
              {:rotation-router? true :role "cleaner" :home-role "documenter"
               :mailbox-empty? true}))
(assert-true "nil role never rotates (no SWARMFORGE_ROLE, nothing to divert)"
             (not (mono-router-lib/rotate-home?
                   {:rotation-router? true :role nil :home-role "coder"
                    :mailbox-empty? true})))

;; ── BL-614: coordinator is reserved infrastructure, never rotates ────────
(assert-true "coordinator never rotates, even with an empty mailbox and a non-coordinator home"
             (not (mono-router-lib/rotate-home?
                   {:rotation-router? true :role "coordinator" :home-role "coder"
                    :mailbox-empty? true})))
(assert-true "coordinator never rotates regardless of home-role identity"
             (not (mono-router-lib/rotate-home?
                   {:rotation-router? true :role "coordinator" :home-role "documenter"
                    :mailbox-empty? true})))
(assert-true "coordinator never rotates even in the degenerate case home-role is itself \"coordinator\""
             (not (mono-router-lib/rotate-home?
                   {:rotation-router? true :role "coordinator" :home-role "coordinator"
                    :mailbox-empty? true})))
(assert-true "coordinator never rotates with a non-empty mailbox either (belt and suspenders)"
             (not (mono-router-lib/rotate-home?
                   {:rotation-router? true :role "coordinator" :home-role "coder"
                    :mailbox-empty? false})))

;; ── resident-poke-target? — which pane a chase poke lands on ────────────────

(assert-true "rotate always targets the resident pane"
             (mono-router-lib/resident-poke-target?
              {:action :rotate :wake-session "swarmforge-cleaner"
               :resident-session "swarmforge-coder"}))
(assert-true "wake-resident always targets the resident pane"
             (mono-router-lib/resident-poke-target?
              {:action :wake-resident :wake-session "swarmforge-coder"
               :resident-session "swarmforge-coder"}))
(assert-true "mono-router home role's own session IS the resident pane"
             (mono-router-lib/resident-poke-target?
              {:action :wake-own-session :wake-session "swarmforge-coder"
               :resident-session "swarmforge-coder"}))
(assert-true "classic-pack role's own standing pane is NOT the resident"
             (not (mono-router-lib/resident-poke-target?
                   {:action :wake-own-session :wake-session "swarmforge-cleaner"
                    :resident-session "swarmforge-coder"})))
(assert-true "no resident session at all -> own-session poke is not resident"
             (not (mono-router-lib/resident-poke-target?
                   {:action :wake-own-session :wake-session "swarmforge-cleaner"
                    :resident-session nil})))

;; ── chase-poke-plan — pane-scoped gating + per-sweep budget ─────────────────
;; Incident 2026-07-23: specifier's refused broadcast rotate consumed the
;; per-sweep resident budget every sweep, so architect's actionable
;; git_handoff sat unclaimed behind chase-wake-skip-dedup for hours.

(assert= "classic pane idle -> wake, and never touches the resident budget"
         {:mode :wake :resident-budget? false}
         (mono-router-lib/chase-poke-plan
          {:action :wake-own-session :resident-target? false
           :target-pane-busy? false}))
(assert= "classic pane busy -> skip on ITS OWN busy state only"
         {:mode :skip :skip-reason :busy :resident-budget? false}
         (mono-router-lib/chase-poke-plan
          {:action :wake-own-session :resident-target? false
           :target-pane-busy? true}))
(assert= "classic pane wake proceeds even while the resident is busy/spent"
         {:mode :wake :resident-budget? false}
         (mono-router-lib/chase-poke-plan
          {:action :wake-own-session :resident-target? false
           :target-pane-busy? false
           :resident-busy? true :resident-woken-this-sweep? true}))
(assert= "resident busy -> skip busy"
         {:mode :skip :skip-reason :busy :resident-budget? true}
         (mono-router-lib/chase-poke-plan
          {:action :rotate :resident-target? true :resident-busy? true}))
(assert= "resident already woken this sweep -> skip dedup"
         {:mode :skip :skip-reason :dedup :resident-budget? true}
         (mono-router-lib/chase-poke-plan
          {:action :rotate :resident-target? true :resident-busy? false
           :resident-woken-this-sweep? true}))
(assert= "resident recently active -> skip recent"
         {:mode :skip :skip-reason :recent :resident-budget? true}
         (mono-router-lib/chase-poke-plan
          {:action :wake-resident :resident-target? true :resident-busy? false
           :resident-recently-active? true :resident-woken-this-sweep? false}))
(assert= "idle resident, rotate action -> rotate (budget consumed on success only)"
         {:mode :rotate :resident-budget? true}
         (mono-router-lib/chase-poke-plan
          {:action :rotate :resident-target? true :resident-busy? false
           :resident-recently-active? false :resident-woken-this-sweep? false}))
(assert= "idle resident, wake action -> wake consuming the budget"
         {:mode :wake :resident-budget? true}
         (mono-router-lib/chase-poke-plan
          {:action :wake-resident :resident-target? true :resident-busy? false
           :resident-recently-active? false :resident-woken-this-sweep? false}))

;; ── BL-576: aged-note actionability ──────────────────────────────────────

(assert= "note_actionable_after_ms parses a positive value"
         600000
         (mono-router-lib/parse-note-actionable-after-ms
          "config note_actionable_after_ms 600000\n"))
(assert= "absent line degrades to default"
         mono-router-lib/default-note-actionable-after-ms
         (mono-router-lib/parse-note-actionable-after-ms "config rotation router\n"))
(assert= "malformed value degrades to default"
         mono-router-lib/default-note-actionable-after-ms
         (mono-router-lib/parse-note-actionable-after-ms
          "config note_actionable_after_ms abc\n"))
(assert= "zero degrades to default (would reinstate broadcast thrash)"
         mono-router-lib/default-note-actionable-after-ms
         (mono-router-lib/parse-note-actionable-after-ms
          "config note_actionable_after_ms 0\n"))
(assert= "negative degrades to default"
         mono-router-lib/default-note-actionable-after-ms
         (mono-router-lib/parse-note-actionable-after-ms
          "config note_actionable_after_ms -1\n"))
(assert= "default is 10 minutes (BL-780: below flow_watchdog_warn_ms)"
         600000
         mono-router-lib/default-note-actionable-after-ms)

;; ── BL-780: rotation-actionability vs flow-watchdog warn ordering ─────────

(assert= "sound defaults produce no ordering warnings"
         []
         (mono-router-lib/rotation-actionability-ordering-warnings
          {:note-actionable-after-ms mono-router-lib/default-note-actionable-after-ms
           :rotation-starve-after-ms mono-router-lib/default-rotation-starve-after-ms
           :flow-watchdog-warn-ms flow-watchdog-lib/default-warn-ms}))

(let [warned (mono-router-lib/rotation-actionability-ordering-warnings
              {:note-actionable-after-ms 1200000
               :rotation-starve-after-ms mono-router-lib/default-rotation-starve-after-ms
               :flow-watchdog-warn-ms 900000})]
  (assert= "inverted note_actionable_after_ms yields exactly one warning"
           1 (count warned))
  (assert-true "warning names note_actionable_after_ms"
               (re-find #"note_actionable_after_ms=1200000" (first warned)))
  (assert-true "warning names flow_watchdog_warn_ms"
               (re-find #"flow_watchdog_warn_ms=900000" (first warned))))

(let [warned (mono-router-lib/rotation-actionability-ordering-warnings
              {:note-actionable-after-ms mono-router-lib/default-note-actionable-after-ms
               :rotation-starve-after-ms 1200000
               :flow-watchdog-warn-ms 900000})]
  (assert= "inverted rotation_starve_after_ms yields exactly one warning"
           1 (count warned))
  (assert-true "warning names rotation_starve_after_ms"
               (re-find #"rotation_starve_after_ms=1200000" (first warned))))

(assert= "rotation_starve_after_ms :off is skipped (no starve warning)"
         []
         (mono-router-lib/rotation-actionability-ordering-warnings
          {:note-actionable-after-ms mono-router-lib/default-note-actionable-after-ms
           :rotation-starve-after-ms :off
           :flow-watchdog-warn-ms 900000}))

(let [now-ms (.toEpochMilli (java.time.Instant/parse "2026-07-23T12:00:00Z"))
      threshold mono-router-lib/default-note-actionable-after-ms]
  (assert-true "enqueued_at 45 minutes ago is aged"
               (mono-router-lib/note-aged?
                {:enqueued-at "2026-07-23T11:15:00Z" :created-at "2026-07-23T11:15:00Z"
                 :now-ms now-ms :threshold-ms threshold}))
  (assert-true "fresh enqueued_at wins over a stale created_at (redelivery is fresh here)"
               (not (mono-router-lib/note-aged?
                     {:enqueued-at "2026-07-23T11:58:00Z" :created-at "2026-07-23T02:00:00Z"
                      :now-ms now-ms :threshold-ms threshold})))
  (assert-true "absent enqueued_at falls back to created_at"
               (mono-router-lib/note-aged?
                {:enqueued-at nil :created-at "2026-07-23T11:15:00Z"
                 :now-ms now-ms :threshold-ms threshold}))
  (assert-true "unparseable enqueued_at falls back to created_at"
               (mono-router-lib/note-aged?
                {:enqueued-at "not-a-timestamp" :created-at "2026-07-23T11:15:00Z"
                 :now-ms now-ms :threshold-ms threshold}))
  (assert-true "neither header parses -> fail closed, never aged"
               (not (mono-router-lib/note-aged?
                     {:enqueued-at nil :created-at nil
                      :now-ms now-ms :threshold-ms threshold})))
  (assert-true "well short of the threshold is not aged"
               (not (mono-router-lib/note-aged?
                     {:enqueued-at "2026-07-23T11:59:00Z" :created-at "2026-07-23T11:59:00Z"
                      :now-ms now-ms :threshold-ms threshold})))
  ;; BL-576 F2 (architect finding): note-aged? had no assertion at exactly
  ;; threshold-ms - a >= -> > mutant survived. Pin both sides of the boundary.
  (assert-true "exactly at the threshold counts as aged (>= boundary)"
               (mono-router-lib/note-aged?
                {:enqueued-at "2026-07-23T11:50:00Z" :created-at "2026-07-23T11:50:00Z"
                 :now-ms now-ms :threshold-ms threshold}))
  (assert-true "one second short of the threshold is not aged"
               (not (mono-router-lib/note-aged?
                     {:enqueued-at "2026-07-23T11:50:01Z" :created-at "2026-07-23T11:50:01Z"
                      :now-ms now-ms :threshold-ms threshold}))))

(assert-true "aged note alone makes a role actionable"
             (mono-router-lib/actionable-mail?
              {:in-process-count 0 :git-handoff-count 0 :aged-note-count 1}))
(assert-true "no aged notes, empty otherwise -> not actionable"
             (not (mono-router-lib/actionable-mail?
                   {:in-process-count 0 :git-handoff-count 0 :aged-note-count 0})))
(assert-true "aged-note-count absent behaves exactly as before (no regression)"
             (not (mono-router-lib/actionable-mail? {:in-process-count 0 :git-handoff-count 0})))

(assert-true "note delivered to a dormant role while resident is elsewhere -> suppressed"
             (mono-router-lib/suppress-dormant-note-delivery-wake?
              {:parcel-type "note" :chase-action :rotate}))
(assert-true "git_handoff to a dormant role is never suppressed"
             (not (mono-router-lib/suppress-dormant-note-delivery-wake?
                   {:parcel-type "git_handoff" :chase-action :rotate})))
(assert-true "note to a role the resident already IS is not suppressed"
             (not (mono-router-lib/suppress-dormant-note-delivery-wake?
                   {:parcel-type "note" :chase-action :wake-resident})))
(assert-true "note to a role with its own standing pane is not suppressed"
             (not (mono-router-lib/suppress-dormant-note-delivery-wake?
                   {:parcel-type "note" :chase-action :wake-own-session})))

;; ── BL-651: starvation-bounded rotate preference ──────────────────────────

(assert= "rotation_starve_after_ms parses a positive value"
         600000
         (mono-router-lib/parse-rotation-starve-after-ms
          "config rotation_starve_after_ms 600000\n"))
(assert= "absent line degrades to default"
         mono-router-lib/default-rotation-starve-after-ms
         (mono-router-lib/parse-rotation-starve-after-ms "config rotation router\n"))
(assert= "malformed value degrades to default"
         mono-router-lib/default-rotation-starve-after-ms
         (mono-router-lib/parse-rotation-starve-after-ms
          "config rotation_starve_after_ms abc\n"))
(assert= "zero degrades to default"
         mono-router-lib/default-rotation-starve-after-ms
         (mono-router-lib/parse-rotation-starve-after-ms
          "config rotation_starve_after_ms 0\n"))
(assert= "negative degrades to default"
         mono-router-lib/default-rotation-starve-after-ms
         (mono-router-lib/parse-rotation-starve-after-ms
          "config rotation_starve_after_ms -1\n"))
(assert= "the literal off disables the age input"
         :off
         (mono-router-lib/parse-rotation-starve-after-ms
          "config rotation_starve_after_ms off\n"))
(assert= "default is 10 minutes, below flow-watchdog-lib's 15-minute warn default"
         600000
         mono-router-lib/default-rotation-starve-after-ms)

(let [now-ms (.toEpochMilli (java.time.Instant/parse "2026-08-01T12:00:00Z"))]
  (assert= "oldest-actionable-waited-ms picks the OLDEST parcel's age, not the newest"
           (* 12 60000)
           (mono-router-lib/oldest-actionable-waited-ms
            [{:enqueued-at "2026-08-01T11:48:00Z" :created-at "2026-08-01T11:48:00Z"}
             {:enqueued-at "2026-08-01T11:59:00Z" :created-at "2026-08-01T11:59:00Z"}]
            now-ms))
  (assert= "falls back to created_at when enqueued_at is absent"
           (* 12 60000)
           (mono-router-lib/oldest-actionable-waited-ms
            [{:enqueued-at nil :created-at "2026-08-01T11:48:00Z"}]
            now-ms))
  (assert= "empty coll -> nil, never zero"
           nil
           (mono-router-lib/oldest-actionable-waited-ms [] now-ms))
  (assert= "no parseable age source anywhere -> nil, fails closed"
           nil
           (mono-router-lib/oldest-actionable-waited-ms
            [{:enqueued-at nil :created-at nil}]
            now-ms))
  (assert= "one parseable source among unparseable ones still resolves"
           (* 12 60000)
           (mono-router-lib/oldest-actionable-waited-ms
            [{:enqueued-at "not-a-timestamp" :created-at nil}
             {:enqueued-at "2026-08-01T11:48:00Z" :created-at "2026-08-01T11:48:00Z"}]
            now-ms)))

;; preferred-rotate-target's starve override
(assert= "starved dormant role beats a fresher same-priority home role"
         "documenter"
         (mono-router-lib/preferred-rotate-target
          [{:role "documenter" :best-priority 0 :newest-created-at "2026-08-01T11:48:00Z"
            :actionable? true :oldest-actionable-waited-ms 720000}
           {:role "coder" :best-priority 0 :newest-created-at "2026-08-01T11:59:00Z"
            :actionable? true :oldest-actionable-waited-ms 60000}]
          600000))
(assert= "below the threshold, BL-636 newest-first ordering is unchanged"
         "coder"
         (mono-router-lib/preferred-rotate-target
          [{:role "documenter" :best-priority 0 :newest-created-at "2026-08-01T11:57:00Z"
            :actionable? true :oldest-actionable-waited-ms 180000}
           {:role "coder" :best-priority 0 :newest-created-at "2026-08-01T11:59:00Z"
            :actionable? true :oldest-actionable-waited-ms 60000}]
          600000))
(assert= "exactly at the threshold counts as starved (>= boundary, mirrors note-aged?)"
         "documenter"
         (mono-router-lib/preferred-rotate-target
          [{:role "documenter" :best-priority 0 :newest-created-at "2026-08-01T11:50:00Z"
            :actionable? true :oldest-actionable-waited-ms 600000}
           {:role "coder" :best-priority 0 :newest-created-at "2026-08-01T11:59:00Z"
            :actionable? true :oldest-actionable-waited-ms 60000}]
          600000))
(assert= "one second short of the threshold is not starved"
         "coder"
         (mono-router-lib/preferred-rotate-target
          [{:role "documenter" :best-priority 0 :newest-created-at "2026-08-01T11:50:00Z"
            :actionable? true :oldest-actionable-waited-ms 599999}
           {:role "coder" :best-priority 0 :newest-created-at "2026-08-01T11:59:00Z"
            :actionable? true :oldest-actionable-waited-ms 60000}]
          600000))
(assert= "two starved queues in the same band drain oldest first"
         "cleaner"
         (mono-router-lib/preferred-rotate-target
          [{:role "cleaner" :best-priority 0 :newest-created-at "2026-08-01T11:20:00Z"
            :actionable? true :oldest-actionable-waited-ms 2400000}
           {:role "documenter" :best-priority 0 :newest-created-at "2026-08-01T11:48:00Z"
            :actionable? true :oldest-actionable-waited-ms 720000}]
          600000))
(assert= "starve never crosses into a worse priority band (constraint 4: age breaks ties, never inverts priority)"
         "coder"
         (mono-router-lib/preferred-rotate-target
          [{:role "documenter" :best-priority 50 :newest-created-at "2026-08-01T11:48:00Z"
            :actionable? true :oldest-actionable-waited-ms 720000}
           {:role "coder" :best-priority 0 :newest-created-at "2026-08-01T11:59:00Z"
            :actionable? true :oldest-actionable-waited-ms 60000}]
          600000))
(assert= "rotation_starve_after_ms :off reproduces BL-636 ordering byte-for-byte"
         "coder"
         (mono-router-lib/preferred-rotate-target
          [{:role "documenter" :best-priority 0 :newest-created-at "2026-08-01T11:48:00Z"
            :actionable? true :oldest-actionable-waited-ms 720000}
           {:role "coder" :best-priority 0 :newest-created-at "2026-08-01T11:59:00Z"
            :actionable? true :oldest-actionable-waited-ms 60000}]
          :off))
(assert= "omitting starve-after-ms entirely (arity-1, every pre-BL-651 caller) is unaffected"
         "coder"
         (mono-router-lib/preferred-rotate-target
          [{:role "documenter" :best-priority 0 :newest-created-at "2026-08-01T11:48:00Z"
            :actionable? true :oldest-actionable-waited-ms 720000}
           {:role "coder" :best-priority 0 :newest-created-at "2026-08-01T11:59:00Z"
            :actionable? true :oldest-actionable-waited-ms 60000}]))
(assert= "a row missing :oldest-actionable-waited-ms is never treated as infinitely starved"
         "coder"
         (mono-router-lib/preferred-rotate-target
          [{:role "documenter" :best-priority 0 :newest-created-at "2026-08-01T11:48:00Z"
            :actionable? true}
           {:role "coder" :best-priority 0 :newest-created-at "2026-08-01T11:59:00Z"
            :actionable? true :oldest-actionable-waited-ms 60000}]
          600000))

;; ── BL-571: the single-resident predicate accepts every value the launcher does ──
;; is_sequential_dormant (swarmforge.sh) treats router AND sequential as the
;; same single-resident topology; ensure must agree. conf-rotation-router?
;; itself stays router-only (the ROTATE_HOME backstop consumes it - pinned).

(assert-true "BL-571: single-resident-rotation? accepts rotation router"
             (mono-router-lib/single-resident-rotation?
              "config active_backlog_max_depth 1\nconfig rotation router\n"))
(assert-true "BL-571: single-resident-rotation? accepts rotation sequential"
             (mono-router-lib/single-resident-rotation?
              "config rotation sequential\nwindow coder aider\n"))
(assert-true "BL-571: single-resident-rotation? accepts the prefix-less conf form"
             (mono-router-lib/single-resident-rotation? "rotation sequential\n"))
(assert-true "BL-571: single-resident-rotation? is false with no rotation line (classic pack)"
             (not (mono-router-lib/single-resident-rotation?
                   "config active_backlog_max_depth -1\nwindow coder aider\n")))
(assert-true "BL-571: single-resident-rotation? is false for nil conf"
             (not (mono-router-lib/single-resident-rotation? nil)))
(assert-true "BL-571: word boundary - 'rotation sequentially' does not match"
             (not (mono-router-lib/single-resident-rotation? "config rotation sequentially\n")))

;; Hardening (BL-571): the LINE ANCHOR is load-bearing and was untested.
;; rotation-declared-in-conf?'s docstring claims "a commented mention or a
;; longer word never matches" - the longer-word half is pinned above, the
;; commented half was not, and a mutant dropping the `^` from the pattern
;; agreed with the original on EVERY other fixture in this file (verified
;; 2026-08-19: the whole suite above is blind to it). A commented or
;; otherwise mid-line mention is the only shape that discriminates it, so
;; it is pinned here for both value-sets - the two pairs share one
;; mechanism, so an anchor mutant would otherwise survive on both sides.
(assert-true "BL-571: a COMMENTED rotation line does not declare a topology (pins the ^ anchor)"
             (not (mono-router-lib/single-resident-rotation? "# config rotation sequential\n")))
(assert-true "BL-571: a mid-line 'rotation router' mention does not declare a topology (pins the ^ anchor)"
             (not (mono-router-lib/single-resident-rotation? "see docs about rotation router here\n")))
(assert-true "BL-571 pin: conf-rotation-router? also ignores a commented rotation line"
             (not (mono-router-lib/conf-rotation-router? "# config rotation router\n")))
;; and the anchor must not over-reach: a real directive still matches when it
;; is not the first line of the file (guards a mutant swapping (?m) off).
(assert-true "BL-571: a real rotation directive on a later line still matches (pins the (?m) flag)"
             (mono-router-lib/single-resident-rotation?
              "# leading comment\nconfig active_backlog_max_depth 1\nconfig rotation sequential\n"))

(assert-true "BL-571: identity rotation=router is single-resident"
             (mono-router-lib/single-resident-rotation-from-identity? "rotation\trouter\n"))
(assert-true "BL-571: identity rotation=sequential is single-resident"
             (mono-router-lib/single-resident-rotation-from-identity? "rotation\tsequential\n"))
(assert-true "BL-571: identity with no rotation key is not single-resident"
             (not (mono-router-lib/single-resident-rotation-from-identity? "pack\tclassic\n")))
(assert-true "BL-571: identity rotation=classic is not single-resident"
             (not (mono-router-lib/single-resident-rotation-from-identity? "rotation\tclassic\n")))

;; the ROTATE_HOME consumer's own predicate is untouched by BL-571
(assert-true "BL-571 pin: conf-rotation-router? still rejects sequential"
             (not (mono-router-lib/conf-rotation-router? "config rotation sequential\n")))
(assert-true "BL-571 pin: rotation-router-from-identity? still rejects sequential"
             (not (mono-router-lib/rotation-router-from-identity? "rotation\tsequential\n")))

;; ── BL-571 D1 (BL-897 guardrail): bash<->Babashka rotation-value parity ──
;; single-resident-rotation-values mirrors swarmforge.sh's
;; is_sequential_dormant across a language boundary no import can bridge;
;; the docstring's "widen ONLY alongside the launcher" is a comment, not a
;; gate. This DERIVES the launcher's accepted set from swarmforge.sh itself
;; (the function body's own "$ROTATION_MODE" == "<value>" literals) and
;; asserts SET EQUALITY - drift in EITHER direction fails here, never
;; silently. A functional sweep then confirms every derived value is
;; genuinely accepted by the sourced launcher function and a control value
;; is rejected, so the textual derivation cannot rot into matching nothing.
;; Non-vacuity proven at authoring time (2026-08-19), each break restored:
;; a value added to the bash side only ('rotate') -> set-equality FAILED;
;; the same value added to the Babashka side only -> set-equality FAILED.
(def ^:private swarmforge-sh-path
  (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "swarmforge.sh")))

(let [src (slurp swarmforge-sh-path)
      body (second (re-find #"(?s)\nis_sequential_dormant\(\)\s*\{(.*?)\n\}" src))
      bash-set (set (map second (re-seq #"\"\$ROTATION_MODE\"\s*==\s*\"([^\"]+)\"" (or body ""))))
      bb-set (set @#'mono-router-lib/single-resident-rotation-values)]
  (assert-true "BL-571 D1: is_sequential_dormant found in swarmforge.sh and names at least one rotation value"
               (boolean (seq bash-set)))
  (assert= "BL-571 D1 parity gate: the launcher's accepted rotation-value set equals single-resident-rotation-values exactly (widen BOTH sides together - BL-897)"
           bash-set bb-set)
  ;; functional confirmation, against the REAL sourced function (short root:
  ;; swarmforge.sh derives a unix-socket path from its root at source time,
  ;; and long $TMPDIR roots overflow the 100-char socket-path limit)
  (let [short-root (str/trim (:out (process/sh ["mktemp" "-d" "/tmp/bl571p.XXXXXX"])))]
    (try
      (let [probe (fn [v]
                    (zero? (:exit (process/sh ["zsh" "-c" (str "source '" swarmforge-sh-path "' '" short-root "'\n"
                                                               "ROTATION_MODE='" v "'\n"
                                                               "ROLES=(one two three four)\n"
                                                               "is_sequential_dormant 2")]))))]
        (doseq [v bash-set]
          (assert-true (str "BL-571 D1: derived value '" v "' is genuinely accepted by the sourced launcher function")
                       (probe v)))
        (assert-true "BL-571 D1: a control value the launcher does not accept ('classic') is rejected by the sourced function"
                     (not (probe "classic"))))
      (finally (fs/delete-tree short-root)))))

;; ── Hotfix 2026-08-31: seated preferred must yield to other actionable mail ─
;; Live deadlock: QA held BL-1303 in_process (deliberate hold pending specifier
;; land-step ruling). Specifier had the priority-00 unblock note. preferred=
;; QA, every chase-rotate-to! poke at specifier redirected to QA, then
;; already-active — resident never left. BL-795 redirect must still fire when
;; preferred is NOT seated.
(assert= "seated preferred yields: poke specifier → rotate specifier (not redirect QA)"
         {:action :rotate :target "specifier"}
         (mono-router-lib/chase-rotate-decision
          {:preferred "QA" :poked-role "specifier"
           :active-role "QA" :poked-actionable? true}))
(assert= "BL-795 intact: unseated preferred still redirects away from poke"
         {:action :redirect :target "hardender"}
         (mono-router-lib/chase-rotate-decision
          {:preferred "hardender" :poked-role "specifier"
           :active-role "coder" :poked-actionable? true}))
(assert= "poke equals preferred → rotate preferred (already-active is downstream)"
         {:action :rotate :target "QA"}
         (mono-router-lib/chase-rotate-decision
          {:preferred "QA" :poked-role "QA"
           :active-role "QA" :poked-actionable? true}))
(assert= "non-actionable poke still skip-broadcast even when preferred seated"
         {:action :skip-broadcast :target nil}
         (mono-router-lib/chase-rotate-decision
          {:preferred "QA" :poked-role "specifier"
           :active-role "QA" :poked-actionable? false}))
(assert= "no preferred + actionable poke → rotate poked"
         {:action :rotate :target "specifier"}
         (mono-router-lib/chase-rotate-decision
          {:preferred nil :poked-role "specifier"
           :active-role "QA" :poked-actionable? true}))
(assert= "marker-active preferred yields even when live identity would be unreadable"
         {:action :rotate :target "specifier"}
         (mono-router-lib/chase-rotate-decision
          {:preferred "QA" :poked-role "specifier"
           :active-role "QA" :poked-actionable? true}))

(when (seq @failures)
  (binding [*out* *err*]
    (doseq [f @failures] (println f)))
  (System/exit 1))

(println "mono_router_lib_test_runner: ok")
