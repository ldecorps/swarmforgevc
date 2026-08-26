#!/usr/bin/env bb
;; BL-809: PROPERTY tests over babysitter_assess_lib.bb, covering the two
;; invariants the ticket YAML declares (coder-authored first, per BL-654):
;;
;;   P1 successful-head-read-is-never-blank - worktree-head-commit-10 must
;;      never return a blank string when git actually answers the HEAD read
;;      (exit 0); a blank result is reserved for git genuinely failing. Across
;;      randomly generated real git worktrees with a random number of commits
;;      (1-5) and, separately, an unborn-HEAD repo (zero commits, where
;;      `git rev-parse HEAD` itself fails) - the generator must demonstrably
;;      reach both the success and the genuine-failure branch.
;;
;;   P2 sweep-writes-nothing-but-its-own-assessment-to-stdout - across many
;;      randomly varied real invocations (a successful read, a moved-head
;;      claim, an unreadable worktree, each of the three untracked-file
;;      states), the ENTIRE OS-level stdout of the process is exactly the
;;      assessment's own single JSON line - nothing else. Verified via a real
;;      subprocess boundary (bl809_claim_risk_sweep_harness.bb spawned fresh
;;      per case), because Clojure's with-out-str does NOT intercept a child
;;      process's INHERITED stdout - confirmed empirically:
;;      `(with-out-str (process/shell {} "echo" "x"))` still prints "x" to
;;      the real terminal and captures "". An in-process with-out-str
;;      capture would therefore be vacuous against exactly the regression
;;      this invariant guards: reverting worktree-head-commit-10 or
;;      list-untracked-files back to a bare process/shell call without
;;      :out :string.
;;
;; Seeded (not wall-clock) randomness so failures reproduce: a fixed-seed
;; java.util.Random, never rand/rand-int's unseeded global generator. Follows
;; the established .bb property-runner precedent (see
;; babysitterd_sweep_lib_property_runner.bb) - the "*.property.test.js" /
;; vitest.properties.config.mjs home is a TypeScript convention with no
;; Babashka equivalent (BL-472 tracks pinning real property tooling for .bb
;; scripts, deliberately deferred).

(ns bl809-worktree-head-property-runner
  (:require [babashka.fs :as fs]
            [babashka.process :as process]
            [clojure.string :as str]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "babysitter_assess_lib.bb")))

(def failures (atom []))

(defn assert-true [msg expr]
  (when-not expr
    (swap! failures conj (str "FAIL: " msg))))

(def created-temp-dirs (atom []))
;; BL-872: shutdown hook mirrors handoff_lib_test_runner.bb (BL-459) - fires
;; on both a clean run and an uncaught exception, never on SIGKILL/OOM
;; (BL-413's periodic /tmp sweep is the backstop for that).
(.addShutdownHook (Runtime/getRuntime)
                   (Thread. (fn [] (doseq [d @created-temp-dirs] (try (fs/delete-tree d) (catch Exception _ nil))))))

(defn- mk-tmp-dir [prefix]
  (let [d (fs/create-temp-dir {:prefix prefix})]
    (swap! created-temp-dirs conj d)
    d))

(def ^:private rng (java.util.Random. 809))
(defn- rbool [] (.nextBoolean rng))
(defn- rint [bound] (.nextInt rng (int bound)))
(defn- rchoice [coll] (nth coll (rint (count coll))))

;; ── P1: successful-head-read-is-never-blank ─────────────────────────────

(defn- make-git-worktree-with-commits [n]
  (let [dir (mk-tmp-dir "bl809-prop-")]
    (process/sh ["git" "init" "-q"] {:dir (str dir)})
    (process/sh ["git" "config" "user.email" "bl809@example.com"] {:dir (str dir)})
    (process/sh ["git" "config" "user.name" "BL-809"] {:dir (str dir)})
    (dotimes [i n]
      (spit (str (fs/path dir (str "file" i ".txt"))) (str "content " i "\n"))
      (process/sh ["git" "add" "."] {:dir (str dir)})
      (process/sh ["git" "commit" "-q" "-m" (str "commit " i)] {:dir (str dir)}))
    dir))

(defn- make-unborn-git-worktree []
  ;; git init with NO commits at all: `git rev-parse HEAD` genuinely fails
  ;; (unborn HEAD) — the real "git actually failed" case this invariant's
  ;; converse depends on.
  (mk-tmp-dir "bl809-prop-unborn-"))

(def p1-branches-hit (atom #{}))

(dotimes [_ 30]
  (if (rbool)
    (let [n (inc (rint 5))
          dir (make-git-worktree-with-commits n)
          head (babysitter-assess-lib/worktree-head-commit-10 (str dir))]
      (swap! p1-branches-hit conj :success)
      (assert-true (str "successful HEAD read on a " n "-commit repo is never blank")
                   (and (string? head) (not (str/blank? head)) (re-matches #"[0-9a-f]{1,10}" head)))
      (fs/delete-tree dir))
    (let [dir (make-unborn-git-worktree)
          head (babysitter-assess-lib/worktree-head-commit-10 (str dir))]
      (swap! p1-branches-hit conj :git-failure)
      (assert-true "a genuinely failing git HEAD read (unborn HEAD) degrades to blank, not an error value"
                   (= "" head))
      (fs/delete-tree dir))))

(assert-true "P1 generator reached both a successful HEAD read and a genuine git failure"
             (and (contains? @p1-branches-hit :success) (contains? @p1-branches-hit :git-failure)))

;; ── P2: sweep-writes-nothing-but-its-own-assessment-to-stdout ───────────

(def HARNESS (str (fs/path (fs/parent (fs/canonicalize *file*)) "bl809_claim_risk_sweep_harness.bb")))

(defn- run-harness-capturing-real-stdout [args]
  ;; :out :string genuinely captures the OS-level pipe babashka wires up for
  ;; the child `bb` process's stdout - unlike with-out-str, this also catches
  ;; a grandchild (git)'s inherited-fd writes, because they land in the SAME
  ;; pipe fd 1 this :out :string redirects.
  (:out (process/sh (into ["bb" HARNESS] args) {})))

(def p2-branches-hit (atom #{}))

(dotimes [_ 24]
  (let [choice (rint 4)
        args (case choice
               0 (do (swap! p2-branches-hit conj :head-read) ["head-read"])
               1 (do (swap! p2-branches-hit conj :severity)
                     ["severity" (rchoice ["none" "ordinary" "fixture-only"])])
               2 (do (swap! p2-branches-hit conj :moved-head) ["moved-head"])
               3 (do (swap! p2-branches-hit conj :unreadable-head) ["unreadable-head"]))
        out (run-harness-capturing-real-stdout args)
        lines (->> (str/split-lines out) (remove str/blank?))]
    (assert-true (str "harness " args " writes exactly one line (its own assessment JSON), no leaked git output")
                 (= 1 (count lines)))))

(assert-true "P2 generator reached every harness subcommand at least once"
             (= #{:head-read :severity :moved-head :unreadable-head} @p2-branches-hit))

(when (seq @failures)
  (binding [*out* *err*]
    (doseq [f @failures] (println f)))
  (System/exit 1))

(println "bl809_worktree_head_property_runner: ok")
