#!/usr/bin/env bb
;; BL-657: TDD runner for harness_env_scrub_lib.bb's pure harness-marker
;; decisions. No real tmux, no real processes - just data, so the deliberate-
;; passthrough exclusion and the marker-matching rules are deterministic and
;; instant.

(ns harness-env-scrub-lib-test-runner
  (:require [babashka.fs :as fs]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "harness_env_scrub_lib.bb")))

(def failures (atom []))

(defn assert= [msg expected actual]
  (when (not= expected actual)
    (swap! failures conj (str "FAIL: " msg "\n  expected: " (pr-str expected) "\n  actual:   " (pr-str actual)))))

;; ── harness-marker-var? ──────────────────────────────────────────────────

(assert= "the observed real leak (CLAUDE_CODE_CHILD_SESSION) is a marker"
         true
         (harness-env-scrub-lib/harness-marker-var? "CLAUDE_CODE_CHILD_SESSION"))

(assert= "the bare CLAUDECODE flag is a marker"
         true
         (harness-env-scrub-lib/harness-marker-var? "CLAUDECODE"))

(assert= "any other CLAUDE_CODE_-prefixed name is a marker by default"
         true
         (harness-env-scrub-lib/harness-marker-var? "CLAUDE_CODE_ENTRYPOINT"))

(assert= "CLAUDE_CODE_MAX_OUTPUT_TOKENS is the deliberate passthrough - never scrubbed"
         false
         (harness-env-scrub-lib/harness-marker-var? "CLAUDE_CODE_MAX_OUTPUT_TOKENS"))

(assert= "an unrelated provider var is never a marker"
         false
         (harness-env-scrub-lib/harness-marker-var? "OPENAI_API_KEY"))

(assert= "a name that merely CONTAINS the prefix mid-string is not a marker (prefix match, not substring)"
         false
         (harness-env-scrub-lib/harness-marker-var? "NOT_CLAUDE_CODE_REALLY"))

(assert= "nil is never a marker"
         false
         (harness-env-scrub-lib/harness-marker-var? nil))

(assert= "blank string is never a marker"
         false
         (harness-env-scrub-lib/harness-marker-var? ""))

;; ── env-var-name ─────────────────────────────────────────────────────────

(assert= "a set-var line yields its name"
         "CLAUDE_CODE_CHILD_SESSION"
         (harness-env-scrub-lib/env-var-name "CLAUDE_CODE_CHILD_SESSION=abc123"))

(assert= "a value containing '=' still yields only the name (split limit 2)"
         "SOME_VAR"
         (harness-env-scrub-lib/env-var-name "SOME_VAR=a=b=c"))

(assert= "a marked-unset line (`-NAME`, tmux's own unset marker syntax) yields nil - nothing to leak"
         nil
         (harness-env-scrub-lib/env-var-name "-SOME_UNSET_VAR"))

(assert= "a blank line yields nil"
         nil
         (harness-env-scrub-lib/env-var-name ""))

;; ── harness-marker-names ─────────────────────────────────────────────────

(assert= "the real observed leak plus noise: only the markers come back, MAX_OUTPUT_TOKENS excluded"
         ["CLAUDE_CODE_CHILD_SESSION" "CLAUDECODE"]
         (harness-env-scrub-lib/harness-marker-names
           "CLAUDE_CODE_CHILD_SESSION=abc123\nCLAUDECODE=1\nCLAUDE_CODE_MAX_OUTPUT_TOKENS=4096\nPATH=/usr/bin\nSOME_OTHER=1\n-UNSET_MARKER"))

(assert= "no markers present yields an empty vector, never nil (caller loops over this directly)"
         []
         (harness-env-scrub-lib/harness-marker-names "PATH=/usr/bin\nHOME=/root"))

(assert= "empty input yields an empty vector"
         []
         (harness-env-scrub-lib/harness-marker-names ""))

(assert= "nil input yields an empty vector, never raises"
         []
         (harness-env-scrub-lib/harness-marker-names nil))

(assert= "a duplicated marker line (tmux would not normally emit this, but never trust it) is deduped"
         ["CLAUDECODE"]
         (harness-env-scrub-lib/harness-marker-names "CLAUDECODE=1\nCLAUDECODE=1"))

;; ── report ────────────────────────────────────────────────────────────────
(if (empty? @failures)
  (println "harness_env_scrub_lib (BL-657): ALL TESTS PASSED")
  (do (println (str "harness_env_scrub_lib (BL-657): " (count @failures) " FAILURE(S):"))
      (doseq [f @failures] (println f))
      (System/exit 1)))
