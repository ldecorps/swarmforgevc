#!/usr/bin/env bb
;; BL-2044 (coder.prompt's Invariants section - first authorship rests with
;; the coder): PROPERTY tests over parcel_line_lib.bb's take-up!, encoding
;; both declared invariants against REAL git fixtures - cherry-pick and
;; branch-move behaviour cannot be reduced to a pure truth table the way
;; e.g. bl1213's invariant 2 was.
;;
;; Invariant 1 - "A take-up never leaves the ticket's own unlanded commits
;;   reachable only from a backup ref: they are on the new line, or the
;;   line did not move": for a randomized count (1-3) of the ticket's own
;;   commits, each touching its OWN file so a re-apply of one never
;;   conflicts with another, interleaved with a randomized count (1-2) of
;;   an unlanded OTHER ticket's commits (which makes own-line? false, so
;;   the line always moves in this generator's non-conflicting runs),
;;   every own commit's file is present on the new HEAD afterward.
;;
;; Invariant 2 - "A take-up never leaves a worktree mid-merge or mid-
;;   cherry-pick": across EVERY generated run - including runs where the
;;   own commit is made to conflict with origin/main's own advance (same
;;   line of the same shared file, picked at random) - neither
;;   CHERRY_PICK_HEAD nor MERGE_HEAD is left in the worktree's own
;;   --git-dir afterward (per-worktree state; a linked worktree's
;;   --git-common-dir never holds them, so checking that one would pass
;;   vacuously - the exact mistake this property's own acceptance step
;;   handler made and was caught making, 2026-10-06).
;;
;; Same seeded-LCG convention as this directory's other property runners
;; (e.g. bl1213_parcel_rollback_guard_property_runner.bb) - deterministic,
;; never rand.
;;
;; Generator-reach: both branches (a clean run that moves and re-applies,
;; and a conflicting run that refuses and leaves the line exactly where it
;; was) are asserted to have actually been generated at least once; a
;; property that only ever exercised one branch would be a floor nobody
;; checked, not a passing property.
;;
;; Non-vacuity proven by hand at authoring time: restoring take-up! to the
;; pre-BL-2044 switch-only move (no re-apply) fails invariant 1 on its
;; first generated own-commit (the own file is simply absent from the new
;; HEAD); dropping reapply-commits!'s `git cherry-pick --abort` on a
;; conflicting run fails invariant 2 (CHERRY_PICK_HEAD is left in the
;; worktree's --git-dir) on the first generated conflicting run. Both
;; restored before landing.

(ns bl2044-seat-commits-survive-line-move-property-runner
  (:require [babashka.fs :as fs]
            [babashka.process :as process]
            [clojure.string :as str]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "parcel_line_lib.bb")))

(def runs (or (some-> (System/getenv "PROPERTY_RUNS") parse-long) 60))
(def failures (atom []))
(def ^:private rng (java.util.Random. 2044))
(defn- rint [n] (.nextInt rng (int n)))
(defn- rbool [] (.nextBoolean rng))

(defn- git [dir & args]
  (let [r (apply process/sh "git" "-C" (str dir) args)]
    (when-not (zero? (:exit r)) (throw (ex-info (str "git " (str/join " " args) ": " (:err r)) {})))
    (str/trim (:out r))))

(defn- commit! [dir file content msg]
  (spit (str (fs/path dir file)) content)
  (git dir "add" file)
  (git dir "-c" "user.email=t@t" "-c" "user.name=t" "commit" "-q" "-m" msg)
  (git dir "rev-parse" "HEAD"))

;; Per-worktree state (CHERRY_PICK_HEAD, MERGE_HEAD) lives under --git-dir,
;; never --git-common-dir, for a LINKED worktree - see the comment block
;; above.
(defn- worktree-git-dir [wt]
  (let [raw (git wt "rev-parse" "--git-dir")]
    (str (if (fs/absolute? (fs/path raw)) (fs/path raw) (fs/path wt raw)))))

(def clean-runs-reached (atom 0))
(def conflict-runs-reached (atom 0))

(dotimes [run runs]
  (let [root (str (fs/create-temp-dir {:prefix "bl2044-prop-"}))]
    (try
      (git root "init" "-q" "-b" "main")
      ;; parcel_line_lib.bb's own git calls (the BL-2044 cherry-pick among
      ;; them) carry no -c user.* flags - production worktrees already
      ;; have identity configured locally (shared via the common .git dir
      ;; across every linked worktree), so this fixture needs the same
      ;; LOCAL config on root, inherited by wt below, rather than relying
      ;; on a -c flag only commit!'s own calls pass.
      (git root "config" "user.email" "t@t")
      (git root "config" "user.name" "t")
      (git root "config" "commit.gpgsign" "false")
      (commit! root "a.txt" "a\n" "init")
      (git root "update-ref" "refs/remotes/origin/main" "HEAD")
      (let [wt (str (fs/path root "wt"))
            _ (git root "worktree" "add" "-q" "-b" "swarmforge-coder" wt)
            n-own (inc (rint 3))    ; 1..3 own commits, never conflicting with each other
            n-other (inc (rint 2))  ; 1..2 unlanded foreign commits -> own-line? false, always moves
            conflict? (rbool)
            own-files (mapv #(str "own" % ".txt") (range n-own))]
        (doseq [[i f] (map-indexed vector own-files)]
          (commit! wt f (str "own" i "\n") (str "BL-9002: own work " i)))
        (when conflict?
          ;; one more own commit, deliberately on the file origin/main will
          ;; independently change below, so its re-apply conflicts.
          (commit! wt "shared.txt" "coder-change\n" "BL-9002: own work (conflicting)"))
        (dotimes [i n-other]
          (commit! wt (str "other" i ".txt") (str "other" i "\n") (str "BL-9000: unlanded work " i)))
        (if conflict?
          (commit! root "shared.txt" "main-change\n" "main advances the shared file")
          (commit! root "main-advance.txt" "advance\n" "main moves on"))
        (git root "update-ref" "refs/remotes/origin/main" "HEAD")
        (let [before (git wt "rev-parse" "HEAD")
              facts {:root wt :project-root root :role "coder" :intent {:intent :start :ticket "BL-9002"}}
              out (with-out-str (parcel-line-lib/take-up! facts))
              git-dir (worktree-git-dir wt)]
          ;; invariant 2, every run regardless of outcome
          (doseq [marker ["CHERRY_PICK_HEAD" "MERGE_HEAD"]]
            (when (fs/exists? (fs/path git-dir marker))
              (swap! failures conj (str "FAIL invariant 2 (run " run ", conflict? " conflict? "): "
                                         marker " left in " git-dir "\noutput:\n" out))))
          (if conflict?
            (do
              (swap! conflict-runs-reached inc)
              (when (not= before (git wt "rev-parse" "HEAD"))
                (swap! failures conj (str "FAIL (run " run "): HEAD moved despite a conflicting re-apply\noutput:\n" out)))
              (when-not (str/includes? out "not taken up")
                (swap! failures conj (str "FAIL (run " run "): expected a refusal, got:\n" out))))
            (do
              (swap! clean-runs-reached inc)
              ;; own-line? is false (a foreign commit is present) so the
              ;; generator's clean runs must always move.
              (when (= before (git wt "rev-parse" "HEAD"))
                (swap! failures conj (str "FAIL reachability (run " run "): expected a move, HEAD stayed\noutput:\n" out)))
              (doseq [f own-files]
                (when-not (fs/exists? (fs/path wt f))
                  (swap! failures conj (str "FAIL invariant 1 (run " run "): " f " missing after take-up!\noutput:\n" out))))))))
      (finally (fs/delete-tree root)))))

(when (zero? @clean-runs-reached)
  (swap! failures conj "FAIL reachability: the clean move-and-re-apply branch was never generated"))
(when (zero? @conflict-runs-reached)
  (swap! failures conj "FAIL reachability: the conflicting-refusal branch was never generated"))

(println (str "parcel_line_lib.bb (BL-2044) property: " runs " runs ("
              @clean-runs-reached " clean, " @conflict-runs-reached " conflicting)"))
(if (seq @failures)
  (do (doseq [f (take 10 @failures)] (binding [*out* *err*] (println f)))
      (println (str (count @failures) " PROPERTY FAILURE(S)"))
      (System/exit 1))
  (println "ALL PROPERTIES HOLD"))
