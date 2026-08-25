#!/usr/bin/env bb
;; BL-111 feature-migration-01: migrates the inline Gherkin `acceptance: |`
;; block of every backlog/active/ and backlog/paused/ item into its own
;; .feature file under specs/features/, then replaces the YAML's
;; acceptance: field with a path reference to it. done/ items are never
;; touched - the feature file becomes the durable acceptance contract, the
;; backlog item is not.
;;
;; A ticket with no acceptance: field (a stub/epic with no concrete Gherkin
;; yet) is left alone entirely - there is nothing to migrate.
;;
;; This is a targeted TEXT transformation, not a full YAML parse/dump: only
;; the acceptance: block's line range is touched, so every other field
;; (id, title, description, notes, mutation_cost, comments, formatting)
;; passes through completely unchanged.
;;
;; The transformation logic itself lives in migrate_gherkin_to_features_lib.bb
;; (pure, directly testable); this file is only the thin CLI wrapper that
;; parses argv and drives it against the real repo.
;;
;; Usage: migrate_gherkin_to_features.bb <repo-root>

(ns migrate-gherkin-to-features
  (:require [babashka.fs :as fs]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "migrate_gherkin_to_features_lib.bb")))

(def repo-root (or (first *command-line-args*)
                    (do (binding [*out* *err*] (println "Usage: migrate_gherkin_to_features.bb <repo-root>"))
                        (System/exit 1))))

(migrate-gherkin-to-features-lib/run-migration! repo-root)
