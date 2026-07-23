#!/usr/bin/env bb
;; TDD runner for mono_router_lib.bb
(ns mono-router-lib-test-runner
  (:require [babashka.fs :as fs]
            [clojure.string :as str]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "mono_router_lib.bb")))

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
(assert= "dormant + already that role → wake resident"
         :wake-resident
         (mono-router-lib/dormant-mailbox-chase-action
          {:target-session-exists? false
           :resident-session-exists? true
           :active-role "cleaner"
           :target-role "cleaner"}))
(assert= "no resident degrades to own-session wake"
         :wake-own-session
         (mono-router-lib/dormant-mailbox-chase-action
          {:target-session-exists? false
           :resident-session-exists? false
           :active-role "coder"
           :target-role "cleaner"}))

(assert= "ensure restores cleaner when marker says cleaner"
         "cleaner"
         (mono-router-lib/resident-launch-role "coder" "cleaner"))
(assert= "ensure falls back to home when marker empty"
         "coder"
         (mono-router-lib/resident-launch-role "coder" "  "))
(assert= "ensure falls back to home when marker nil"
         "coder"
         (mono-router-lib/resident-launch-role "coder" nil))

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
(assert-true "empty mailbox is not actionable"
             (not (mono-router-lib/actionable-mail? {:in-process-count 0 :git-handoff-count 0})))

(assert= "newest actionable role wins"
         "architect"
         (mono-router-lib/preferred-rotate-target
          [{:role "coder" :newest-created-at "2026-07-22T01:00:00Z" :actionable? false}
           {:role "cleaner" :newest-created-at "2026-07-22T02:00:00Z" :actionable? true}
           {:role "architect" :newest-created-at "2026-07-22T03:00:00Z" :actionable? true}]))

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
(assert= "default is 20 minutes"
         1200000
         mono-router-lib/default-note-actionable-after-ms)

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

(when (seq @failures)
  (binding [*out* *err*]
    (doseq [f @failures] (println f)))
  (System/exit 1))

(println "mono_router_lib_test_runner: ok")
