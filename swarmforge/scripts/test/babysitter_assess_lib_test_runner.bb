#!/usr/bin/env bb
;; TDD runner for babysitter_assess_lib.bb — no tmux, no network.
(ns babysitter-assess-lib-test-runner
  (:require [babashka.fs :as fs]
            [babashka.process :as process]
            [clojure.string :as str]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "babysitter_assess_lib.bb")))

(def failures (atom []))

(defn assert= [msg expected actual]
  (when (not= expected actual)
    (swap! failures conj (str "FAIL: " msg "\n  expected: " (pr-str expected) "\n  actual:   " (pr-str actual)))))

(defn assert-true [msg expr]
  (when-not expr
    (swap! failures conj (str "FAIL: " msg))))

(def created-temp-dirs (atom []))
;; BL-872: shutdown hook mirrors handoff_lib_test_runner.bb (BL-459) - fires
;; on both a clean run and an uncaught exception, never on SIGKILL/OOM
;; (BL-413's periodic /tmp sweep is the backstop for that).
(.addShutdownHook (Runtime/getRuntime)
                   (Thread. (fn [] (doseq [d @created-temp-dirs] (try (fs/delete-tree d) (catch Exception _ nil))))))

(let [now 1000000
      cfg claim-progress-lib/default-config
      base {:role "coder"
            :worktree-path "/tmp"
            :sidecar-path "/tmp/x.handoff.claim-progress.json"
            :now-ms now
            :config cfg}]
  (assert= "ok when fresh claim"
           "ok"
           (:severity (babysitter-assess-lib/assess-one-claim
                        (assoc base
                               :progress {:claimCommit "aaaa" :claimAtMs (- now 1000) :reclaims 0}
                               :worktree-path "/nonexistent"))))

  (assert-true "warn at reclaims=4"
               (= "warn"
                  (:severity (babysitter-assess-lib/assess-one-claim
                              (assoc base
                                     :progress {:claimCommit "aaaa" :claimAtMs (- now 100000) :reclaims 4}
                                     :worktree-path "/nonexistent")))))

  (assert-true "critical at bounce threshold"
               (= "critical"
                  (:severity (babysitter-assess-lib/assess-one-claim
                              (assoc base
                                     :progress {:claimCommit "aaaa" :claimAtMs (- now 100000) :reclaims 6}
                                     :worktree-path "/nonexistent")))))

  (assert-true "alert-severity filters ok"
               (and (babysitter-assess-lib/alert-severity? "warn")
                    (babysitter-assess-lib/alert-severity? "critical")
                    (babysitter-assess-lib/alert-severity? "warn-fixture-droppings")
                    (not (babysitter-assess-lib/alert-severity? "ok"))
                    (not (babysitter-assess-lib/alert-severity? "watch"))))

  ;; BL-646: flip babysitter hint for pure test-fixture droppings
  (let [assessment (babysitter-assess-lib/assess-one-claim
                      (assoc base
                             :progress {:claimCommit "aaaa" :claimAtMs (- now 900000) :reclaims 0}
                             :worktree-path "/nonexistent"
                             :head-commit "aaaa"
                             :untracked-paths ["calls.log" "email-text.txt" "failure.log" "status.json"]))]
    (assert= "BL-646 fixture droppings severity"
             "warn-fixture-droppings"
             (:severity assessment))
    (assert-true "BL-646 fixture droppings hint forbids commit"
                 (and (string? (:hint assessment))
                      (re-find #"do NOT git add/commit" (:hint assessment))
                      (not (re-find #"nudge role to git add/commit" (:hint assessment)))))
    (println "PASS: BL-646 fixture droppings hint forbids commit")))

;; ── BL-646: pure fixture-droppings predicate ────────────────────────────────
(assert-true "only-known-fixture-droppings? true for the four fixture names"
             (babysitter-assess-lib/only-known-fixture-droppings?
              ["calls.log" "email-text.txt" "failure.log" "status.json"]))
(assert-true "only-known-fixture-droppings? false when mixed with real work"
             (not (babysitter-assess-lib/only-known-fixture-droppings?
                   ["calls.log" "extension/src/draft.ts"])))
(assert-true "only-known-fixture-droppings? false when empty"
             (not (babysitter-assess-lib/only-known-fixture-droppings? [])))

;; ── BL-809: worktree-head-commit-10 must read a real HEAD without leaking
;; stdout, and the fallback path it feeds must restore the stall severities ──

(defn- bl809-make-git-worktree []
  (let [dir (fs/create-temp-dir {:prefix "bl809-worktree-"})]
    (swap! created-temp-dirs conj dir)
    (process/sh ["git" "init" "-q"] {:dir (str dir)})
    (process/sh ["git" "config" "user.email" "bl809@example.com"] {:dir (str dir)})
    (process/sh ["git" "config" "user.name" "BL-809"] {:dir (str dir)})
    (spit (str (fs/path dir "README.md")) "bl809 fixture\n")
    (process/sh ["git" "add" "."] {:dir (str dir)})
    (process/sh ["git" "commit" "-q" "-m" "init"] {:dir (str dir)})
    dir))

(let [worktree (bl809-make-git-worktree)
      expected-head (str/trim (:out (process/sh ["git" "rev-parse" "--short=10" "HEAD"]
                                                 {:dir (str worktree)})))
      captured (with-out-str
                 (def bl809-head (babysitter-assess-lib/worktree-head-commit-10 (str worktree))))]
  ;; scenario-01: a successful HEAD read yields the commit, not a blank
  (assert= "BL-809 scenario-01: worktree-head-commit-10 returns the real HEAD"
           expected-head bl809-head)
  (assert-true "BL-809 scenario-01: the returned HEAD is non-blank"
               (not (str/blank? bl809-head)))
  ;; scenario-02: the sweep does not print raw git output
  (assert= "BL-809 scenario-02: no raw git output leaks to stdout" "" captured)

  ;; scenarios 03/04/05: exercised through assess-one-claim WITHOUT :head-commit,
  ;; so it falls through to worktree-head-commit-10 exactly like scan-claim-risks'
  ;; production call — a fix that only fixed the hash while leaving this fallback
  ;; dark would not pass these.
  (let [now (System/currentTimeMillis)
        cfg claim-progress-lib/default-config
        idle-ms (claim-progress-lib/resolve-claim-idle-timeout-ms "coder" cfg)
        aged-claim-at (- now (long (* 0.8 idle-ms)))
        base {:role "coder"
              :worktree-path (str worktree)
              :sidecar-path (str (fs/path worktree "x.handoff.claim-progress.json"))
              :now-ms now
              :config cfg
              :progress {:claimCommit bl809-head :claimAtMs aged-claim-at :reclaims 0}}]

    (assert= "BL-809 scenario-03: unchanged HEAD, clean tree -> watch"
             "watch" (:severity (babysitter-assess-lib/assess-one-claim base)))

    (let [ordinary (fs/path worktree "scratch.txt")]
      (spit (str ordinary) "untracked work\n")
      (let [assessment (babysitter-assess-lib/assess-one-claim base)]
        (assert= "BL-809 scenario-03: unchanged HEAD, ordinary untracked -> warn-uncommitted"
                 "warn-uncommitted" (:severity assessment))
        (assert-true "BL-809 scenario-04: list-untracked-files is genuinely called (non-zero count)"
                     (pos? (long (:untracked-files assessment)))))
      (fs/delete ordinary))

    (let [fixture (fs/path worktree "calls.log")]
      (spit (str fixture) "fixture dropping\n")
      (assert= "BL-809 scenario-03: unchanged HEAD, only fixture droppings -> warn-fixture-droppings"
               "warn-fixture-droppings" (:severity (babysitter-assess-lib/assess-one-claim base)))
      (fs/delete fixture))

    ;; scenario-05: a claim whose HEAD has moved is not reported as a stall
    (let [moved (assoc-in base [:progress :claimCommit] "deadbeef00")
          severity (:severity (babysitter-assess-lib/assess-one-claim moved))]
      (assert-true "BL-809 scenario-05: moved HEAD reports no stall severity"
                   (not (contains? #{"watch" "warn-uncommitted" "warn-fixture-droppings"} severity)))))

  (fs/delete-tree worktree))

;; scenario-06: an unreadable HEAD degrades to blank rather than raising
(assert= "BL-809 scenario-06: non-git worktree degrades to blank, not nil/throw"
         "" (babysitter-assess-lib/worktree-head-commit-10 "/nonexistent-bl809-worktree-path"))
(assert-true "BL-809 scenario-06: assess-one-claim on an unreadable worktree still returns an assessment"
             (some? (babysitter-assess-lib/assess-one-claim
                     {:role "coder"
                      :worktree-path "/nonexistent-bl809-worktree-path"
                      :sidecar-path "/tmp/bl809-nonexistent.claim-progress.json"
                      :now-ms (System/currentTimeMillis)
                      :config claim-progress-lib/default-config
                      :progress {:claimCommit "aaaa" :claimAtMs (System/currentTimeMillis) :reclaims 0}})))

(when (seq @failures)
  (binding [*out* *err*]
    (doseq [f @failures] (println f)))
  (System/exit 1))

(println "babysitter_assess_lib_test_runner: ok")
