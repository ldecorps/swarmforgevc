#!/usr/bin/env bb
;; Acceptance runner for BL-934: takes one JSON arg {"original": "...",
;; "worktree": "..."} and prints {"wrapper": "<the generated wrapper
;; source>"} - drives the REAL build-healing-wrapper-command, never a JS
;; reimplementation, so the Node acceptance step handlers inspect the
;; actual product's static source text (what Claude Code's own classifier
;; sees before anything executes), same JSON-bridge pattern as
;; tool_miss_heal_acceptance_runner.bb (BL-913).
(ns bl934-heal-wrapper-source-runner
  (:require [babashka.fs :as fs]
            [cheshire.core :as json]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "tool_miss_heal_lib.bb")))

(def payload (json/parse-string (first *command-line-args*) true))

(println
 (json/generate-string
  {:wrapper (tool-miss-heal-lib/build-healing-wrapper-command (:original payload) (:worktree payload))}))
