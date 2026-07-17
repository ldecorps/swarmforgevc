#!/usr/bin/env bb
;; BL-419: TDD runner for commit_integrity_lib.bb's commit-with-integrity! -
;; the shared, locked, pathspec-scoped, verify+retry commit helper for
;; writers on a checkout that may be concurrently committed to by other
;; processes. Two testing postures, matching the ticket's own Testability
;; note (the race is timing-dependent, so no sleep/poll test):
;;   (a) the verify/retry/fail-loud machinery - proven with INJECTED
;;       add/commit/show seams returning scripted results, no real
;;       concurrency, no real git process at all;
;;   (b) the pathspec-scoping guarantee - proven against a REAL git
;;       fixture: stage two paths, commit one by pathspec, assert the
;;       other is untouched.

(ns commit-integrity-lib-test-runner
  (:require [babashka.fs :as fs]
            [babashka.process :as process]
            [clojure.string :as str]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "commit_integrity_lib.bb")))

(def failures (atom []))

(defn assert= [msg expected actual]
  (when (not= expected actual)
    (swap! failures conj (str "FAIL: " msg "\n  expected: " (pr-str expected) "\n  actual:   " (pr-str actual)))))

(defn assert-true [msg actual] (assert= msg true (boolean actual)))
(defn assert-false [msg actual] (assert= msg false (boolean actual)))

(def created-temp-dirs (atom []))
;; Same cleanup-on-exit posture as handoff_lib_test_runner.bb (BL-459): a
;; shutdown hook removes every fixture this runner creates, on both a clean
;; run and an uncaught exception unwinding to the top level.
(.addShutdownHook (Runtime/getRuntime)
                   (Thread. (fn [] (doseq [d @created-temp-dirs] (try (fs/delete-tree d) (catch Exception _ nil))))))

(defn mk-tmp-dir []
  (let [d (str (fs/create-temp-dir {:prefix "sfvc-commit-integrity-"}))]
    (swap! created-temp-dirs conj d)
    d))

(defn sh! [dir & args]
  (let [res (process/sh (into ["git" "-C" dir] args))]
    (when-not (zero? (:exit res))
      (throw (ex-info (str "git fixture setup failed: " (str/join " " args)) res)))
    res))

(defn real-git-repo []
  (let [dir (mk-tmp-dir)]
    (sh! dir "init" "-q")
    (sh! dir "config" "user.email" "t@t")
    (sh! dir "config" "user.name" "t")
    (sh! dir "commit" "-q" "-m" "init" "--allow-empty")
    dir))

;; ── caller-shape validation ─────────────────────────────────────────────

(let [threw? (atom false)]
  (try
    (commit-integrity-lib/commit-with-integrity! {:project-root "" :paths ["a"] :message "m"})
    (catch clojure.lang.ExceptionInfo _ (reset! threw? true)))
  (assert-true "a blank project-root throws (caller-shape error, not a git failure)" @threw?))

(let [threw? (atom false)]
  (try
    (commit-integrity-lib/commit-with-integrity! {:project-root "/tmp/x" :paths [] :message "m"})
    (catch clojure.lang.ExceptionInfo _ (reset! threw? true)))
  (assert-true "empty paths throws" @threw?))

(let [threw? (atom false)]
  (try
    (commit-integrity-lib/commit-with-integrity! {:project-root "/tmp/x" :paths ["a"] :message ""})
    (catch clojure.lang.ExceptionInfo _ (reset! threw? true)))
  (assert-true "a blank message throws" @threw?))

;; ── :no-git-dir short-circuit (not a repo at all) ───────────────────────

(let [dir (mk-tmp-dir)
      add-called? (atom false)
      result (commit-integrity-lib/commit-with-integrity!
              {:project-root dir :paths ["notes.txt"] :message "m"
               :add-fn! (fn [& _] (reset! add-called? true) {:exit 0})})]
  (assert= "a non-git-repo project-root reports :no-git-dir" {:success false :reason :no-git-dir :attempts 0} result)
  (assert-false "add-fn! is never called when no git-dir can be resolved (short-circuits before staging)" @add-called?))

;; ── lock is always acquired and released, even on failure paths ────────

(let [dir (real-git-repo)
      lock-calls (atom []) ]
  (commit-integrity-lib/commit-with-integrity!
   {:project-root dir :paths ["notes.txt"] :message "m"
    :add-fn! (fn [& _] {:exit 1 :err "simulated add failure"})
    :lock-fn! (fn [lock-dir] (swap! lock-calls conj [:lock lock-dir]))
    :unlock-fn! (fn [lock-dir] (swap! lock-calls conj [:unlock lock-dir]))})
  (assert= "lock is acquired exactly once and released exactly once, even when add fails"
           [:lock :unlock] (mapv first @lock-calls))
  (assert= "the same lock path is used for both acquire and release"
           (second (first @lock-calls)) (second (second @lock-calls))))

;; ── lock acquisition is BOUNDED: a lock-fn! that gives up (returns
;;    false) fails loudly with :lock-timeout, never hangs, and never
;;    proceeds to stage/commit/unlock (there is nothing to unlock - the
;;    lock was never acquired) ─────────────────────────────────────────

(let [dir (real-git-repo)
      add-called? (atom false)
      unlock-called? (atom false)
      result (commit-integrity-lib/commit-with-integrity!
              {:project-root dir :paths ["notes.txt"] :message "m"
               :lock-fn! (fn [_lock-dir] false)
               :unlock-fn! (fn [_lock-dir] (reset! unlock-called? true))
               :add-fn! (fn [& _] (reset! add-called? true) {:exit 0})})]
  (assert= "a lock-fn! that gives up reports :lock-timeout, not a hang" {:success false :reason :lock-timeout :attempts 0} result)
  (assert-false "add-fn! is never called when the lock could not be acquired" @add-called?)
  (assert-false "unlock-fn! is never called when the lock was never acquired" @unlock-called?))

;; the REAL default acquire-lock! mechanism (not a seam) is itself bounded:
;; against a lock-dir already held by someone else, it gives up after
;; max-attempts and returns false rather than spinning forever. Driven
;; directly (not through commit-with-integrity!) with poll-delay-ms 0 so
;; this stays instant - a bounded LOOP COUNT is what's under test here,
;; not a real time delay (the no-real-timers rule bans waiting on the
;; clock, not a zero-delay poll count).
(let [dir (real-git-repo)
      lock-dir (str (fs/path dir ".git" "sfvc-test.lock"))]
  (fs/create-dirs lock-dir)
  (let [acquired? (commit-integrity-lib/acquire-lock! lock-dir 3 0)]
    (assert-false "acquire-lock! gives up (returns false) against an already-held lock instead of spinning forever" acquired?))
  (fs/delete lock-dir))

;; and it succeeds (returns true) once the lock is actually free.
(let [dir (real-git-repo)
      lock-dir (str (fs/path dir ".git" "sfvc-test-free.lock"))]
  (let [acquired? (commit-integrity-lib/acquire-lock! lock-dir 3 0)]
    (assert-true "acquire-lock! succeeds against a free lock path" acquired?)
    (assert-true "acquire-lock! actually created the lock dir" (fs/exists? lock-dir)))
  (fs/delete lock-dir))

;; ── :add-failed / :commit-failed short-circuit before any verify ───────

(let [dir (real-git-repo)
      show-called? (atom false)
      result (commit-integrity-lib/commit-with-integrity!
              {:project-root dir :paths ["notes.txt"] :message "m"
               :add-fn! (fn [& _] {:exit 1})
               :show-fn (fn [& _] (reset! show-called? true) "unused")})]
  (assert= "an add failure is reported as :add-failed on attempt 1" {:success false :reason :add-failed :attempts 1} result)
  (assert-false "show-fn is never called when add itself fails" @show-called?))

(let [dir (real-git-repo)
      result (commit-integrity-lib/commit-with-integrity!
              {:project-root dir :paths ["notes.txt"] :message "m"
               :add-fn! (fn [& _] {:exit 0})
               :commit-fn! (fn [& _] {:exit 1})})]
  (assert= "a commit failure is reported as :commit-failed on attempt 1" {:success false :reason :commit-failed :attempts 1} result))

;; ── (a) verify + bounded retry, injected seams, no real concurrency ────

;; scenario 2: mismatch on attempt 1, matches on attempt 2 - re-stages and
;; re-commits (a fresh commit each time) within the retry budget, then
;; succeeds.
(let [dir (real-git-repo)
      add-calls (atom 0)
      commit-calls (atom 0)
      delay-calls (atom [])
      result (commit-integrity-lib/commit-with-integrity!
              {:project-root dir :paths ["notes.txt"] :message "m" :max-retries 3
               :add-fn! (fn [& _] (swap! add-calls inc) {:exit 0})
               :commit-fn! (fn [& _] (swap! commit-calls inc) {:exit 0})
               :rev-parse-fn (fn [_] (str "sha-" @commit-calls))
               :read-fn (fn [_ _] "approved")
               :show-fn (fn [_ sha _] (if (= 1 @commit-calls) "pending" "approved"))
               :retry-delay-fn! (fn [attempt] (swap! delay-calls conj attempt))})]
  (assert= "a mismatch on attempt 1 that matches on attempt 2 succeeds" true (:success result))
  (assert= "the succeeding attempt number is reported" 2 (:attempts result))
  (assert= "the successful sha is reported" "sha-2" (:sha result))
  (assert= "add is re-run for the retry (re-staged), not skipped" 2 @add-calls)
  (assert= "commit is re-run for the retry (a fresh commit, never an amend)" 2 @commit-calls)
  (assert= "exactly one retry delay was taken, for the one mismatch" [1] @delay-calls))

;; scenario 3: every attempt mismatches - exhausts the retry cap and fails
;; loudly, never reporting success.
(let [dir (real-git-repo)
      commit-calls (atom 0)
      result (commit-integrity-lib/commit-with-integrity!
              {:project-root dir :paths ["notes.txt"] :message "m" :max-retries 2
               :add-fn! (fn [& _] {:exit 0})
               :commit-fn! (fn [& _] (swap! commit-calls inc) {:exit 0})
               :rev-parse-fn (fn [_] (str "sha-" @commit-calls))
               :read-fn (fn [_ _] "approved")
               :show-fn (fn [_ _ _] "pending")
               :retry-delay-fn! (fn [_] nil)})]
  (assert= "exhausting the retry cap reports failure, never success" false (:success result))
  (assert= "the reason is :verify-mismatch" :verify-mismatch (:reason result))
  (assert= "attempts = max-retries + 1 (the initial attempt plus every retry)" 3 (:attempts result))
  (assert= "the mismatched path is named in the result" ["notes.txt"] (:mismatched-paths result))
  (assert= "a fresh commit was attempted on every retry, up to the cap" 3 @commit-calls))

;; multi-path: only the genuinely mismatched path is reported, and a
;; matching path never blocks success.
(let [dir (real-git-repo)
      result (commit-integrity-lib/commit-with-integrity!
              {:project-root dir :paths ["a.txt" "b.txt"] :message "m" :max-retries 0
               :add-fn! (fn [& _] {:exit 0})
               :commit-fn! (fn [& _] {:exit 0})
               :rev-parse-fn (fn [_] "sha-1")
               :read-fn (fn [_ path] (if (= path "a.txt") "A" "B"))
               :show-fn (fn [_ _ path] (if (= path "a.txt") "A" "WRONG"))})]
  (assert= "only the actually-mismatched path is named" false (:success result))
  (assert= "the matching path is excluded from mismatched-paths" ["b.txt"] (:mismatched-paths result)))

;; ── (a continued) real end-to-end success, no seams at all ─────────────

(let [dir (real-git-repo)
      target (str (fs/path dir "approval.yaml"))]
  (spit target "human_approval: approved\n")
  (let [result (commit-integrity-lib/commit-with-integrity!
                {:project-root dir :paths ["approval.yaml"] :message "Approve BL-000"})]
    (assert-true "a real, uncontended commit succeeds" (:success result))
    (assert= "attempts is 1 when nothing mismatches" 1 (:attempts result))
    (let [shown (:out (process/sh ["git" "-C" dir "show" (str (:sha result) ":approval.yaml")]))]
      (assert= "the real committed content matches what was on disk" "human_approval: approved\n" shown))
    (assert= "the working tree is clean for that path after commit"
             "" (str/trim (:out (process/sh ["git" "-C" dir "status" "--porcelain" "--" "approval.yaml"]))))))

;; ── (b) pathspec-scoping, real git fixture: stage two paths, commit one
;;    by pathspec, assert the other is not swept into the commit and is
;;    left exactly as it was staged ─────────────────────────────────────

(let [dir (real-git-repo)
      writer-path "approval.yaml"
      other-path "unrelated.yaml"
      writer-abs (str (fs/path dir writer-path))
      other-abs (str (fs/path dir other-path))]
  (spit writer-abs "human_approval: approved\n")
  (spit other-abs "some: other-content\n")
  ;; Simulates "another process staged an unrelated path during the
  ;; stage-to-commit window": the unrelated path sits staged in the SAME
  ;; shared index our own add/commit will operate against, but is never
  ;; itself committed by us.
  (sh! dir "add" "--" other-path)
  (let [result (commit-integrity-lib/commit-with-integrity!
                {:project-root dir :paths [writer-path] :message "Approve BL-000"})]
    (assert-true "the pathspec-scoped commit succeeds despite an unrelated staged path" (:success result))
    (let [stat (:out (process/sh ["git" "-C" dir "show" "--stat" "--format=" (:sha result)]))]
      (assert-true "the commit touches the writer's own path" (str/includes? stat writer-path))
      (assert-false "the commit does NOT sweep in the unrelated staged path" (str/includes? stat other-path)))
    (let [dirty (:out (process/sh ["git" "-C" dir "status" "--porcelain" "--" other-path]))]
      (assert-false "the unrelated path remains staged (untouched), not committed and not lost" (str/blank? (str/trim dirty))))))

;; ── report ────────────────────────────────────────────────────────────────
(if (empty? @failures)
  (println "commit_integrity_lib (BL-419): ALL TESTS PASSED")
  (do (println (str "commit_integrity_lib (BL-419): " (count @failures) " FAILURE(S):"))
      (doseq [f @failures] (println f))
      (System/exit 1)))
