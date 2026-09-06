#!/usr/bin/env bb
;; TDD runner for epic_backfill_proposals_lib.bb (BL-676).

(ns epic-backfill-proposals-lib-test-runner
  (:require [babashka.fs :as fs]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "epic_backfill_proposals_lib.bb")))

(def failures (atom []))

(defn assert= [msg expected actual]
  (when (not= expected actual)
    (swap! failures conj (str "FAIL: " msg "\n  expected: " (pr-str expected) "\n  actual:   " (pr-str actual)))))

(defn assert-true [msg actual] (assert= msg true (boolean actual)))

;; ── epic-roster / clean-milestone-map ────────────────────────────────────

(def epic-console
  "id: BL-100\ntitle: \"EPIC - console\"\nmilestone: M3\ntype: epic\nepic: console\ndecomposes_into: [BL-010]\n")
(def epic-reliability
  "id: BL-200\ntitle: \"EPIC - reliability layer\"\nmilestone: M5\ntype: epic\nepic: reliability\n")
(def epic-shared-milestone-a
  "id: BL-300\ntitle: \"EPIC - shared A\"\nmilestone: M6\ntype: epic\nepic: shared-a\n")
(def epic-shared-milestone-b
  "id: BL-301\ntitle: \"EPIC - shared B\"\nmilestone: M6\ntype: epic\nepic: shared-b\n")

(def roster (epic-backfill-proposals-lib/epic-roster
             [epic-console epic-reliability epic-shared-milestone-a epic-shared-milestone-b]))

(assert= "roster has all four epics" 4 (count roster))

(assert= "clean-milestone-map keeps an unambiguous milestone"
         "console"
         (get (epic-backfill-proposals-lib/clean-milestone-map roster) "M3"))

(assert= "clean-milestone-map drops an ambiguous (shared) milestone entirely"
         nil
         (get (epic-backfill-proposals-lib/clean-milestone-map roster) "M6"))

;; ── roster-match ─────────────────────────────────────────────────────────

(assert= "decomposes_into membership wins over any keyword overlap"
         {:epic "console" :evidence "listed in console's decomposes_into"}
         (epic-backfill-proposals-lib/roster-match "BL-010" "totally unrelated title" roster))

(assert-true "a title keyword overlap with an epic's own title matches"
             (= "reliability" (:epic (epic-backfill-proposals-lib/roster-match "BL-999" "reliability layer hardening" roster))))

(assert= "no overlap and no decomposes_into membership: no match"
         nil
         (epic-backfill-proposals-lib/roster-match "BL-999" "zzz qqq xyz" roster))

;; ── predates-earliest-epic? ──────────────────────────────────────────────

(assert-true "M1 predates the earliest roster epic (M3)"
             (epic-backfill-proposals-lib/predates-earliest-epic? "M1" roster))
(assert-true "M3 (the earliest epic's own milestone) does NOT predate it"
             (not (epic-backfill-proposals-lib/predates-earliest-epic? "M3" roster)))

;; ── propose-for-ticket / build-rows (scenario shapes) ────────────────────

(def milestone-map (epic-backfill-proposals-lib/clean-milestone-map roster))

(assert= "milestone-map tier: BL-010 (given a clean M3 -> console mapping)"
         {:id "BL-010" :tier "milestone-map" :proposal "console" :evidence "milestone M3"}
         (epic-backfill-proposals-lib/propose-for-ticket
          {:id "BL-010" :title "some done ticket" :milestone "M3" :epic nil}
          roster milestone-map))

(assert= "roster-match tier: title overlap, no clean milestone map for its own milestone"
         {:id "BL-011" :tier "roster-match" :proposal "reliability" :evidence "slug keyword(s): reliability"}
         (epic-backfill-proposals-lib/propose-for-ticket
          {:id "BL-011" :title "reliability fix" :milestone "M4" :epic nil}
          roster milestone-map))

(assert= "needs-judgment tier: no signal, milestone does not predate the epic system"
         {:id "BL-012" :tier "needs-judgment" :proposal "" :evidence ""}
         (epic-backfill-proposals-lib/propose-for-ticket
          {:id "BL-012" :title "zzz qqq xyz" :milestone "M4" :epic nil}
          roster milestone-map))

(assert= "pre-epic-era tier: no signal, milestone predates the earliest epic"
         {:id "BL-002" :tier "pre-epic-era" :proposal "pre-epic-era"
          :evidence "milestone M1 predates the earliest roster epic's milestone"}
         (epic-backfill-proposals-lib/propose-for-ticket
          {:id "BL-002" :title "zzz qqq xyz" :milestone "M1" :epic nil}
          roster milestone-map))

(assert= "already-tagged ticket: nil, excluded entirely"
         nil
         (epic-backfill-proposals-lib/propose-for-ticket
          {:id "BL-020" :title "already has an epic" :milestone "M4" :epic "console"}
          roster milestone-map))

;; ── render-report is pure and deterministic ──────────────────────────────

(def rendered
  (epic-backfill-proposals-lib/render-report
   [{:id "BL-010" :tier "milestone-map" :proposal "console" :evidence "milestone M3"}]))

(assert-true "rendered report names the ticket id" (re-find #"BL-010" rendered))
(assert-true "rendered report names the tier" (re-find #"milestone-map" rendered))
(assert= "render-report is a pure function of its rows - byte-identical on repeat calls"
         rendered
         (epic-backfill-proposals-lib/render-report
          [{:id "BL-010" :tier "milestone-map" :proposal "console" :evidence "milestone M3"}]))

(when (seq @failures)
  (doseq [f @failures] (println f))
  (System/exit 1))

(println "ALL PASS: epic_backfill_proposals_lib.bb")
