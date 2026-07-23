#!/usr/bin/env bb
;; TDD runner for banked_briefing_lib.bb (BL-308) - pure assertions only,
;; no real fs/git/clock.
(ns banked-briefing-test-runner
  (:require [babashka.fs :as fs]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "banked_briefing_lib.bb")))

(def failures (atom []))

(defn assert= [msg expected actual]
  (when (not= expected actual)
    (swap! failures conj (str "FAIL: " msg "\n  expected: " (pr-str expected) "\n  actual:   " (pr-str actual)))))

(defn assert-includes [msg needle haystack]
  (when-not (clojure.string/includes? haystack needle)
    (swap! failures conj (str "FAIL: " msg "\n  expected to find: " (pr-str needle) "\n  in: " (pr-str haystack)))))

;; ── profile-name-from-config-path (pure) ─────────────────────────────────

(assert= "extracts the pack name from a full config path"
         "concierge-banked"
         (banked-briefing-lib/profile-name-from-config-path
          "/home/dev/repo/swarmforge/packs/concierge-banked.conf"))

(assert= "a blank config path falls back to \"unknown\", never a crash"
         "unknown"
         (banked-briefing-lib/profile-name-from-config-path ""))

(assert= "a nil config path falls back to \"unknown\", never a crash"
         "unknown"
         (banked-briefing-lib/profile-name-from-config-path nil))

;; ── prior-day-key (pure) ──────────────────────────────────────────────────

(assert= "the day immediately before day-key, mid-month"
         "2026-07-11"
         (banked-briefing-lib/prior-day-key "2026-07-12"))

(assert= "crosses a month boundary correctly"
         "2026-06-30"
         (banked-briefing-lib/prior-day-key "2026-07-01"))

;; ── compose-banked-briefing (pure) ───────────────────────────────────────

(let [content (banked-briefing-lib/compose-banked-briefing
               {:day-key "2026-07-12"
                :profile-name "concierge-banked"
                :hibernated-at-ms (.toEpochMilli (java.time.Instant/parse "2026-07-12T08:00:00Z"))
                :backlog-counts {:active 0 :paused 3 :done 42}
                :git-activity-lines ["abc1234 Fix thing" "def5678 Add other thing"]
                :daemon-health-lines ["chases=1 nudges=0 respawns=0 failedDeliveries=0"]})]
  (assert-includes "the first line labels the briefing as a parked/lightweight briefing"
                    "Swarm parked - lightweight briefing"
                    (first (clojure.string/split-lines content)))
  (assert-includes "the subject line names the day" "2026-07-12" (first (clojure.string/split-lines content)))
  (assert-includes "includes a recent git activity section" "## Recent git activity" content)
  (assert-includes "includes the git activity lines given" "abc1234 Fix thing" content)
  (assert-includes "includes a backlog counts section" "## Backlog counts" content)
  (assert-includes "backlog counts reflect the given active/paused/done numbers"
                    "active: 0" content)
  (assert-includes "backlog counts reflect the given active/paused/done numbers"
                    "paused: 3" content)
  (assert-includes "backlog counts reflect the given active/paused/done numbers"
                    "done: 42" content)
  (assert-includes "includes a parked profile section" "## Parked profile" content)
  (assert-includes "names the parked profile" "concierge-banked" content)
  (assert-includes "names when the swarm hibernated" "hibernated since 2026-07-12T08:00:00Z" content)
  (assert-includes "includes a daemon health section" "## Daemon health" content)
  (assert-includes "includes the given daemon health line" "chases=1" content))

;; Empty git-activity/daemon-health degrade to a clear fallback line, never
;; a blank/missing section (the section heading must still be present so
;; the acceptance's per-section check always finds it).
(let [content (banked-briefing-lib/compose-banked-briefing
               {:day-key "2026-07-12"
                :profile-name "concierge-banked"
                :hibernated-at-ms nil
                :backlog-counts {:active 0 :paused 0 :done 0}
                :git-activity-lines []
                :daemon-health-lines []})]
  (assert-includes "an empty git-activity input still renders the section heading"
                    "## Recent git activity" content)
  (assert-includes "an empty git-activity input renders a clear fallback line"
                    "No recent git activity." content)
  (assert-includes "an empty daemon-health input still renders the section heading"
                    "## Daemon health" content)
  (assert-includes "an empty daemon-health input renders a clear fallback line"
                    "Daemon health unavailable this run." content)
  (assert-includes "a nil hibernated-at-ms is tolerated, never a crash" "concierge-banked" content))

;; ── report ────────────────────────────────────────────────────────────────
(if (seq @failures)
  (do
    (doseq [f @failures] (binding [*out* *err*] (println f)))
    (println (str "\n" (count @failures) " failure(s)"))
    (System/exit 1))
  (println "ALL PASS: banked_briefing_lib.bb"))
