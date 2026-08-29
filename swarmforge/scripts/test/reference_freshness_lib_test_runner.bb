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

;; ── BL-1237: direction-aware stale-paths (3-arity) ─────────────────────────
;; Invariant 1: refuse only for content the worktree is MISSING relative to
;; main - never for content it carries that main does not yet have.

(assert= "a differing path the worktree has already absorbed via ancestry (AHEAD) is not stale"
         []
         (reference-freshness-lib/stale-paths
          {"workflow-detailed.prompt" "worktree-own-newer-sha"}
          {"workflow-detailed.prompt" "main-older-sha"}
          {"workflow-detailed.prompt" true}))

(assert= "a differing path the worktree has NOT absorbed (BEHIND, BL-640's own case) stays stale - scenario 03 must not weaken"
         ["workflow-detailed.prompt"]
         (reference-freshness-lib/stale-paths
          {"workflow-detailed.prompt" "worktree-old-sha"}
          {"workflow-detailed.prompt" "main-new-sha"}
          {"workflow-detailed.prompt" false}))

(assert= "a path absent from the ancestry map defaults to false - fail closed, still refused"
         ["workflow-detailed.prompt"]
         (reference-freshness-lib/stale-paths
          {"workflow-detailed.prompt" "worktree-old-sha"}
          {"workflow-detailed.prompt" "main-new-sha"}
          {}))

(assert= "the 2-arity call is unchanged - pre-BL-1237 callers keep refusing on any difference"
         ["workflow-detailed.prompt"]
         (reference-freshness-lib/stale-paths
          {"workflow-detailed.prompt" "worktree-old-sha"}
          {"workflow-detailed.prompt" "main-new-sha"}))

(assert= "mixed: one path absorbed (allowed), one not (still refused) - only the genuinely-missing one is reported"
         ["genuinely-behind.prompt"]
         (reference-freshness-lib/stale-paths
          {"ahead-of-main.prompt" "worktree-newer-sha" "genuinely-behind.prompt" "worktree-old-sha"}
          {"ahead-of-main.prompt" "main-older-sha" "genuinely-behind.prompt" "main-new-sha"}
          {"ahead-of-main.prompt" true "genuinely-behind.prompt" false}))

(assert= "a path present only in the worktree is never reported even with an ancestry map supplied"
         []
         (reference-freshness-lib/stale-paths
          {"worktree-only.prompt" "sha-x"}
          {}
          {"worktree-only.prompt" true}))

(assert-true "fresh? still works via the pure 2-arity stale-paths default"
             (reference-freshness-lib/fresh?
              {"a" "sha-a"}
              {"a" "sha-a"}))

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

;; ── BL-1266: stale-paths-multi-ref / fresh-multi-ref? / report ─────────────
;; Invariant 1: verdict computed per path from that path's own history in
;; each ref, never from a repo-wide count. Invariant 2: every ref that
;; carries a path is consulted, and a refusal is never suppressed because a
;; different ref happened to agree. Invariant 3: a refusal names the
;; specific ref whose amendment is missing.

(assert= "identical content on every ref is fresh, no stale entries"
         []
         (reference-freshness-lib/stale-paths-multi-ref
          {"a.prompt" "sha-a"}
          {"main" {"a.prompt" "sha-a"} "origin/main" {"a.prompt" "sha-a"}}))

(assert-true "identical content on every ref reports fresh-multi-ref?"
             (reference-freshness-lib/fresh-multi-ref?
              {"a.prompt" "sha-a"}
              {"main" {"a.prompt" "sha-a"} "origin/main" {"a.prompt" "sha-a"}}))

(assert= "missing only origin/main's amendment is reported against origin/main, even though main agrees with the worktree"
         [{:path "a.prompt" :ref "origin/main"}]
         (reference-freshness-lib/stale-paths-multi-ref
          {"a.prompt" "old-sha"}
          {"main" {"a.prompt" "old-sha"} "origin/main" {"a.prompt" "new-sha"}}))

(assert= "missing only local main's amendment is reported against main, even though origin/main agrees with the worktree"
         [{:path "a.prompt" :ref "main"}]
         (reference-freshness-lib/stale-paths-multi-ref
          {"a.prompt" "old-sha"}
          {"main" {"a.prompt" "new-sha"} "origin/main" {"a.prompt" "old-sha"}}))

(assert= "missing both refs' amendments on the same path reports both, sorted"
         [{:path "a.prompt" :ref "main"} {:path "a.prompt" :ref "origin/main"}]
         (reference-freshness-lib/stale-paths-multi-ref
          {"a.prompt" "old-sha"}
          {"main" {"a.prompt" "main-sha"} "origin/main" {"a.prompt" "origin-sha"}}))

(assert= "content absorbed via ancestry from BOTH refs is allowed even though the refs disagree with each other"
         []
         (reference-freshness-lib/stale-paths-multi-ref
          {"a.prompt" "worktree-own-sha"}
          {"main" {"a.prompt" "main-sha"} "origin/main" {"a.prompt" "origin-sha"}}
          {["main" "a.prompt"] true ["origin/main" "a.prompt"] true}))

(assert= "absorbed from main but not origin/main - still stale against the one not absorbed"
         [{:path "a.prompt" :ref "origin/main"}]
         (reference-freshness-lib/stale-paths-multi-ref
          {"a.prompt" "worktree-own-sha"}
          {"main" {"a.prompt" "main-sha"} "origin/main" {"a.prompt" "origin-sha"}}
          {["main" "a.prompt"] true ["origin/main" "a.prompt"] false}))

(assert= "a (ref, path) pair absent from the ancestry map defaults to false - fail closed"
         [{:path "a.prompt" :ref "main"}]
         (reference-freshness-lib/stale-paths-multi-ref
          {"a.prompt" "worktree-old-sha"}
          {"main" {"a.prompt" "main-new-sha"}}
          {}))

(assert= "a repository with no origin/main is judged against main alone"
         []
         (reference-freshness-lib/stale-paths-multi-ref
          {"a.prompt" "sha-a"}
          {"main" {"a.prompt" "sha-a"}}))

(assert= "a path present only in the worktree is never reported"
         []
         (reference-freshness-lib/stale-paths-multi-ref
          {"worktree-only.prompt" "sha-x"}
          {"main" {}}))

(let [report (reference-freshness-lib/staleness-report-multi-ref
              [{:path "a.prompt" :ref "origin/main"}])]
  (assert-true "the multi-ref report names the stale path"
               (str/includes? report "a.prompt"))
  (assert-true "the multi-ref report names the SPECIFIC missing ref, not a generic 'main'"
               (str/includes? report "origin/main"))
  (assert-true "the multi-ref report's remedy names origin/main to merge"
               (str/includes? report "Merge origin/main"))
  (assert-true "the multi-ref report is tagged for easy grep/alerting"
               (str/starts-with? report "STALE_REFERENCE_ELABORATION:")))

(let [report (reference-freshness-lib/staleness-report-multi-ref
              [{:path "a.prompt" :ref "main"} {:path "b.prompt" :ref "origin/main"}])]
  (assert-true "a report spanning both refs names both remedies"
               (str/includes? report "Merge main and origin/main")))

;; ── report ────────────────────────────────────────────────────────────────

(if (seq @failures)
  (do
    (doseq [f @failures] (binding [*out* *err*] (println f)))
    (println (str "\n" (count @failures) " failure(s)"))
    (System/exit 1))
  (println "ALL PASS: reference_freshness_lib.bb"))
