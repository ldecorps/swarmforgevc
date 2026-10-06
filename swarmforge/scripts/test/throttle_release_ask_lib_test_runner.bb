#!/usr/bin/env bb
;; TDD runner for throttle_release_ask_lib.bb (BL-1982) - pure assertions
;; over provided recommendation maps/reply text. The CLI's own IO
;; orchestration (role_ask.bb, deliver-role-answer.js, release-intake-
;; throttle.js) is proven end to end by the acceptance feature instead
;; (specs/features/BL-1982-...feature) - see this lib's own file header.
(ns throttle-release-ask-lib-test-runner
  (:require [babashka.fs :as fs]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "throttle_release_ask_lib.bb")))

(def failures (atom []))

(defn assert= [msg expected actual]
  (when (not= expected actual)
    (swap! failures conj (str "FAIL: " msg "\n  expected: " (pr-str expected) "\n  actual:   " (pr-str actual)))))

;; ── episode-awaiting-release? (pure) ───────────────────────────────────────

(assert= "nil rec never awaits release"
         false
         (throttle-release-ask-lib/episode-awaiting-release? nil))

(assert= "a rec with no episode never awaits release"
         false
         (throttle-release-ask-lib/episode-awaiting-release? {:episode nil}))

(assert= "an open episode whose raw signal has not cleared yet does not await release"
         false
         (throttle-release-ask-lib/episode-awaiting-release? {:episode {:answer nil :clearedAtIso nil}}))

(assert= "an open, unanswered episode whose signal has cleared awaits release"
         true
         (throttle-release-ask-lib/episode-awaiting-release? {:episode {:answer nil :clearedAtIso "2026-01-01T00:00:00Z"}}))

(assert= "an already-answered episode never awaits release, however it cleared"
         false
         (throttle-release-ask-lib/episode-awaiting-release?
          {:episode {:answer {:kind "release"} :clearedAtIso "2026-01-01T00:00:00Z"}}))

;; ── question-already-asked? (pure, invariant 1) ────────────────────────────

(assert= "an episode carrying no releaseAskedAtMs has not been asked"
         false
         (throttle-release-ask-lib/question-already-asked? {:episode {}}))

(assert= "an episode carrying a releaseAskedAtMs has already been asked"
         true
         (throttle-release-ask-lib/question-already-asked? {:episode {:releaseAskedAtMs 1700000000000}}))

(assert= "a nil rec has not been asked"
         false
         (throttle-release-ask-lib/question-already-asked? nil))

;; ── release-reply-kind (pure) ───────────────────────────────────────────────

(assert= "the exact release option text is a :release reply"
         :release
         (throttle-release-ask-lib/release-reply-kind "Release the cap"))

(assert= "the exact keep option text is a :keep reply"
         :keep
         (throttle-release-ask-lib/release-reply-kind "Keep the throttle"))

(assert= "any other text is a :typed reply, kept rather than acted on"
         :typed
         (throttle-release-ask-lib/release-reply-kind "wait until the reds are under five"))

(assert= "a near-miss on the exact option wording is still :typed, never fuzzy-matched"
         :typed
         (throttle-release-ask-lib/release-reply-kind "release the cap"))

(assert= "nil text is :typed, never a crash"
         :typed
         (throttle-release-ask-lib/release-reply-kind nil))

;; ── release-options (the exact two buttons role_ask.bb offers) ─────────────

(assert= "the release options are exactly the two the ticket names, in order"
         ["Release the cap" "Keep the throttle"]
         throttle-release-ask-lib/release-options)

;; ── format-release-question (pure) ──────────────────────────────────────────

(let [cleared-ms (.toEpochMilli (java.time.Instant/parse "2026-01-01T00:00:00Z"))
      ep {:openingSignal "the red count" :clearedAtIso "2026-01-01T00:00:00Z" :configuredCapAtOpen 6}]
  (assert= "names the opening signal, the cleared duration and the cap a release restores"
           "the red count has read normal for 1m 5s - the swarm looks healthy. Safe to release the cap back to 6?"
           (throttle-release-ask-lib/format-release-question {:episode ep} (+ cleared-ms 65000)))

  (assert= "a sub-minute duration reads in seconds"
           "the red count has read normal for 5s - the swarm looks healthy. Safe to release the cap back to 6?"
           (throttle-release-ask-lib/format-release-question {:episode ep} (+ cleared-ms 5000))))

;; ── report ────────────────────────────────────────────────────────────────
(if (seq @failures)
  (do
    (doseq [f @failures] (binding [*out* *err*] (println f)))
    (println (str "\n" (count @failures) " failure(s)"))
    (System/exit 1))
  (println "ALL PASS: throttle_release_ask_lib.bb"))
