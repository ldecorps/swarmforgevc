#!/usr/bin/env bb
;; TDD runner for reference_freshness_lib.bb (BL-640) - pure assertions, no git.
(ns reference-freshness-lib-test-runner
  (:require [babashka.fs :as fs]
            [clojure.string :as str]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "reference_freshness_lib.bb")))

(def failures (atom []))

(defn assert= [msg expected actual]
  (when (not= expected actual)
    (swap! failures conj (str "FAIL: " msg "\n  expected: " (pr-str expected) "\n  actual:   " (pr-str actual)))))

(defn assert-true [msg expr]
  (when-not expr
    (swap! failures conj (str "FAIL: " msg))))

;; ── stale-paths / fresh? (feature scenarios 01/02) ─────────────────────────

(assert= "identical maps are fresh, no stale paths"
         []
         (reference-freshness-lib/stale-paths
          {"a" "sha-a" "b" "sha-b"}
          {"a" "sha-a" "b" "sha-b"}))

(assert-true "identical maps report fresh"
             (reference-freshness-lib/fresh?
              {"a" "sha-a" "b" "sha-b"}
              {"a" "sha-a" "b" "sha-b"}))

(assert= "a differing sha on main is reported stale (scenario 02: amended, not merged)"
         ["workflow-detailed.prompt"]
         (reference-freshness-lib/stale-paths
          {"workflow-detailed.prompt" "old-sha"}
          {"workflow-detailed.prompt" "new-sha"}))

(assert-true "a differing sha is not fresh"
             (not (reference-freshness-lib/fresh?
                   {"workflow-detailed.prompt" "old-sha"}
                   {"workflow-detailed.prompt" "new-sha"})))

(assert= "a path entirely missing from the worktree is stale (never merged at all)"
         ["new-file.prompt"]
         (reference-freshness-lib/stale-paths
          {}
          {"new-file.prompt" "new-sha"}))

(assert= "a path present only in the worktree (deleted upstream, or scratch) is never reported"
         []
         (reference-freshness-lib/stale-paths
          {"worktree-only.prompt" "sha-x"}
          {}))

(assert= "stale paths come back sorted, regardless of input map iteration order"
         ["a-file.prompt" "z-file.prompt"]
         (reference-freshness-lib/stale-paths
          {}
          {"z-file.prompt" "sha-z" "a-file.prompt" "sha-a"}))

(assert= "mixed: only the files that actually differ are reported, matching files are silent"
         ["changed.prompt"]
         (reference-freshness-lib/stale-paths
          {"unchanged.prompt" "same-sha" "changed.prompt" "old-sha"}
          {"unchanged.prompt" "same-sha" "changed.prompt" "new-sha"}))

(assert= "both empty is trivially fresh (no reference/ dir on either side)"
         []
         (reference-freshness-lib/stale-paths {} {}))

;; ── sha256-hex ──────────────────────────────────────────────────────────

(assert= "sha256-hex of empty string is the well-known SHA-256 empty digest"
         "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
         (reference-freshness-lib/sha256-hex ""))

(assert= "sha256-hex is deterministic for identical content"
         (reference-freshness-lib/sha256-hex "hello")
         (reference-freshness-lib/sha256-hex "hello"))

(assert-true "sha256-hex differs for different content"
             (not= (reference-freshness-lib/sha256-hex "hello")
                   (reference-freshness-lib/sha256-hex "goodbye")))

;; ── staleness-report ────────────────────────────────────────────────────

(let [report (reference-freshness-lib/staleness-report ["workflow-detailed.prompt" "engineering-detailed.prompt"])]
  (assert-true "the report names every stale path"
               (and (str/includes? report "workflow-detailed.prompt")
                    (str/includes? report "engineering-detailed.prompt")))
  (assert-true "the report instructs merging main"
               (str/includes? report "main"))
  (assert-true "the report is tagged for easy grep/alerting"
               (str/starts-with? report "STALE_REFERENCE_ELABORATION:")))

;; ── report ────────────────────────────────────────────────────────────────

(if (seq @failures)
  (do
    (doseq [f @failures] (binding [*out* *err*] (println f)))
    (println (str "\n" (count @failures) " failure(s)"))
    (System/exit 1))
  (println "ALL PASS: reference_freshness_lib.bb"))
