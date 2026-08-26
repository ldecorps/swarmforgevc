#!/usr/bin/env bb
;; BL-809: acceptance harness driving the REAL babysitter-assess-lib
;; functions (worktree-head-commit-10, assess-one-claim) against a real git
;; worktree — no reimplementation of the fix, just wiring for the Gherkin
;; step handlers. Every subcommand prints exactly one JSON line; the step
;; handlers treat any OTHER content on stdout as a leak (scenario-02).
;;
;; Usage: bl809_claim_risk_sweep_harness.bb <subcommand> [args...]
;;   head-read
;;   severity <untracked-mode: none|ordinary|fixture-only>
;;   moved-head
;;   unreadable-head

(ns bl809-claim-risk-sweep-harness
  (:require [babashka.fs :as fs]
            [babashka.process :as process]
            [cheshire.core :as json]
            [clojure.string :as str]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "babysitter_assess_lib.bb")))

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

(defn- make-git-worktree []
  (let [dir (mk-tmp-dir "bl809-acceptance-")]
    (process/sh ["git" "init" "-q"] {:dir (str dir)})
    (process/sh ["git" "config" "user.email" "bl809@example.com"] {:dir (str dir)})
    (process/sh ["git" "config" "user.name" "BL-809"] {:dir (str dir)})
    (spit (str (fs/path dir "README.md")) "bl809 fixture\n")
    (process/sh ["git" "add" "."] {:dir (str dir)})
    (process/sh ["git" "commit" "-q" "-m" "init"] {:dir (str dir)})
    dir))

(defn- real-head [dir]
  (str/trim (:out (process/sh ["git" "rev-parse" "--short=10" "HEAD"] {:dir (str dir)}))))

(defn- seed-untracked! [dir mode]
  (case mode
    "none" nil
    "ordinary" (spit (str (fs/path dir "scratch.txt")) "untracked work\n")
    "fixture-only" (spit (str (fs/path dir "calls.log")) "fixture dropping\n")))

(def idle-ms (claim-progress-lib/resolve-claim-idle-timeout-ms
              "coder" claim-progress-lib/default-config))
(def now (System/currentTimeMillis))
(def aged-claim-at-ms (- now (long (* 0.8 idle-ms))))

(defn- assess [worktree-dir claim-commit]
  (babysitter-assess-lib/assess-one-claim
   {:role "coder"
    :worktree-path (str worktree-dir)
    :sidecar-path (str (fs/path worktree-dir "x.handoff.claim-progress.json"))
    :now-ms now
    :config claim-progress-lib/default-config
    :progress {:claimCommit claim-commit :claimAtMs aged-claim-at-ms :reclaims 0}}))

(let [[subcommand & args] *command-line-args*]
  (case subcommand
    "head-read"
    (let [dir (make-git-worktree)
          expected (real-head dir)
          actual (babysitter-assess-lib/worktree-head-commit-10 (str dir))]
      (fs/delete-tree dir)
      (println (json/generate-string {:headCommit actual :expectedHeadCommit expected})))

    "severity"
    (let [[untracked-mode] args
          dir (make-git-worktree)
          head (real-head dir)]
      (seed-untracked! dir untracked-mode)
      (let [assessment (assess dir head)]
        (fs/delete-tree dir)
        (println (json/generate-string {:severity (:severity assessment)
                                        :untrackedFiles (:untracked-files assessment)}))))

    "moved-head"
    (let [dir (make-git-worktree)
          assessment (assess dir "deadbeef00")]
      (fs/delete-tree dir)
      (println (json/generate-string {:severity (:severity assessment)})))

    "unreadable-head"
    (let [broken-dir (mk-tmp-dir "bl809-nongit-")
          broken (assess broken-dir "deadbeef00")
          healthy-dir (make-git-worktree)
          healthy-head (real-head healthy-dir)
          healthy (assess healthy-dir healthy-head)]
      (fs/delete-tree broken-dir)
      (fs/delete-tree healthy-dir)
      (println (json/generate-string {:brokenHeadCommit (:head-commit broken)
                                      :brokenSeverity (:severity broken)
                                      :healthySeverity (:severity healthy)})))

    (do
      (binding [*out* *err*]
        (println (str "unknown subcommand: " subcommand)))
      (System/exit 1))))
