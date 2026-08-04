#!/usr/bin/env bb
;; TDD runner for provider_auth_observe_lib.bb — pure, no filesystem / tmux
;; / network. Covers BL-536 acceptance scenarios auth-error-triggers-
;; respawn-01, healthy-pane-not-respawned-02, persistent-auth-failure-
;; alerts-03, plus config parsing and edge cases.

(ns provider-auth-observe-lib-test-runner
  (:require [babashka.fs :as fs]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "provider_auth_observe_lib.bb")))

(def failures (atom []))

(defn assert= [msg expected actual]
  (when (not= expected actual)
    (swap! failures conj (str "FAIL: " msg "\n  expected: " (pr-str expected) "\n  actual:   " (pr-str actual)))))

(defn assert-true [msg actual] (assert= msg true (boolean actual)))
(defn assert-false [msg actual] (assert= msg false (boolean actual)))

(def auth-text "AuthenticationError: Invalid API key provided\n")
(def unauthorized-text "Error: 401 Unauthorized\n")
(def healthy-text "some normal Claude Code turn output\n$ ")

;; ── classify-auth-signal ──────────────────────────────────────────────────

(assert= "classify: auth-class text is :auth"
         :auth (provider-auth-observe-lib/classify-auth-signal auth-text))

(assert= "classify: 'Unauthorized' text is :auth"
         :auth (provider-auth-observe-lib/classify-auth-signal unauthorized-text))

(assert= "classify: healthy pane text is :healthy"
         :healthy (provider-auth-observe-lib/classify-auth-signal healthy-text))

(assert= "classify: empty pane is :healthy"
         :healthy (provider-auth-observe-lib/classify-auth-signal ""))

(assert= "classify: nil pane is :healthy"
         :healthy (provider-auth-observe-lib/classify-auth-signal nil))

;; ── BL-536 auth-error-triggers-respawn-01 ────────────────────────────────

(let [r (provider-auth-observe-lib/decide-auth-observation nil auth-text)]
  (assert= "01: first auth-class observation respawns" :respawn (:action r))
  (assert= "01: attempts advances to 1" 1 (get-in r [:state :attempts])))

;; ── BL-536 healthy-pane-not-respawned-02 ─────────────────────────────────

(let [r (provider-auth-observe-lib/decide-auth-observation nil healthy-text)]
  (assert= "02: healthy pane observation is not respawned" :none (:action r))
  (assert= "02: healthy observation state is a clean episode" {:attempts 0 :alerted false} (:state r)))

(let [after-respawn (:state (provider-auth-observe-lib/decide-auth-observation nil auth-text))
      r (provider-auth-observe-lib/decide-auth-observation after-respawn healthy-text)]
  (assert= "02b: a healthy tick after a respawn ends the episode (no action, reset state)"
           :none (:action r))
  (assert= "02b: episode reset clears attempts/alerted"
           {:attempts 0 :alerted false} (:state r)))

;; ── BL-536 persistent-auth-failure-alerts-03 ─────────────────────────────

(let [config {:max-attempts 3}
      r1 (provider-auth-observe-lib/decide-auth-observation nil auth-text config)
      r2 (provider-auth-observe-lib/decide-auth-observation (:state r1) auth-text config)
      r3 (provider-auth-observe-lib/decide-auth-observation (:state r2) auth-text config)
      r4 (provider-auth-observe-lib/decide-auth-observation (:state r3) auth-text config)
      r5 (provider-auth-observe-lib/decide-auth-observation (:state r4) auth-text config)]
  (assert= "03: respawn 1/3" :respawn (:action r1))
  (assert= "03: respawn 2/3" :respawn (:action r2))
  (assert= "03: respawn 3/3 (cap reached)" :respawn (:action r3))
  (assert= "03: 4th tick at cap alerts, does not respawn" :alert (:action r4))
  (assert= "03: 5th tick past cap is quiet — no duplicate alert" :none (:action r5))
  (assert= "03: 5th tick does not respawn beyond the cap" :none (:action r5))
  (assert-true "03: alerted flag stays set after the quiet tick" (get-in r5 [:state :alerted])))

;; ── decide-episode-action edge cases ──────────────────────────────────────

(assert= "episode-action: attempts below cap respawns and increments"
         {:state {:attempts 1 :alerted false} :action :respawn}
         (provider-auth-observe-lib/decide-episode-action {:attempts 0 :alerted false} 3))

(assert= "episode-action: attempts at cap, not alerted, alerts once"
         {:state {:attempts 3 :alerted true} :action :alert}
         (provider-auth-observe-lib/decide-episode-action {:attempts 3 :alerted false} 3))

(assert= "episode-action: attempts at cap, already alerted, stays quiet"
         {:state {:attempts 3 :alerted true} :action :none}
         (provider-auth-observe-lib/decide-episode-action {:attempts 3 :alerted true} 3))

(assert= "episode-action: max-attempts=1 alerts on the very next tick"
         :alert (:action (provider-auth-observe-lib/decide-episode-action {:attempts 1 :alerted false} 1)))

;; ── next-episode-state ─────────────────────────────────────────────────────

(assert= "next-episode: nil prev + :healthy is a clean episode"
         {:attempts 0 :alerted false} (provider-auth-observe-lib/next-episode-state nil :healthy))

(assert= "next-episode: nil prev + :auth defaults to a fresh episode"
         {:attempts 0 :alerted false} (provider-auth-observe-lib/next-episode-state nil :auth))

(assert= "next-episode: :auth leaves existing state untouched"
         {:attempts 2 :alerted false}
         (provider-auth-observe-lib/next-episode-state {:attempts 2 :alerted false} :auth))

(assert= "next-episode: :healthy always resets regardless of prior state"
         {:attempts 0 :alerted false}
         (provider-auth-observe-lib/next-episode-state {:attempts 3 :alerted true} :healthy))

;; ── parse-max-attempts ─────────────────────────────────────────────────────

(assert= "parse-max-attempts: absent config line degrades to default 3"
         3 (provider-auth-observe-lib/parse-max-attempts ""))

(assert= "parse-max-attempts: nil conf-text degrades to default"
         3 (provider-auth-observe-lib/parse-max-attempts nil))

(assert= "parse-max-attempts: configured positive value wins"
         5 (provider-auth-observe-lib/parse-max-attempts "config auth_respawn_max_attempts 5\n"))

(assert= "parse-max-attempts: zero degrades to default (never a zero-attempt cap)"
         3 (provider-auth-observe-lib/parse-max-attempts "config auth_respawn_max_attempts 0\n"))

(assert= "parse-max-attempts: negative degrades to default"
         3 (provider-auth-observe-lib/parse-max-attempts "config auth_respawn_max_attempts -1\n"))

(assert= "parse-max-attempts: unrelated config lines are ignored"
         3 (provider-auth-observe-lib/parse-max-attempts "config active_backlog_max_depth 5\n"))

;; ── format-* helpers ───────────────────────────────────────────────────────

(assert-true "format-alert-reason names the role and BL-536"
             (let [s (provider-auth-observe-lib/format-alert-reason "coder" 3)]
               (boolean (and (re-find #"coder" s) (re-find #"BL-536" s)))))

(assert-true "format-telegram-alert names the role"
             (boolean (re-find #"coder" (provider-auth-observe-lib/format-telegram-alert "coder" 3))))

(assert-true "format-email-subject names the role"
             (boolean (re-find #"coder" (provider-auth-observe-lib/format-email-subject "coder"))))

(when (seq @failures)
  (doseq [f @failures] (println f))
  (System/exit 1))
(println "PASS provider_auth_observe_lib assertions")
