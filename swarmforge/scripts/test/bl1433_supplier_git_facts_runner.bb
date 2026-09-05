#!/usr/bin/env bb
;; BL-1433 scenario 03: proves the daemon's fact-supplier composition (two
;; ancestor checks, in OPPOSITE argument order, against the ROLE's own
;; worktree dir) against a REAL git fixture - never handoffd.bb itself
;; (never load-file handoffd.bb: it boots daemon machinery as a side
;; effect). The git-is-ancestor? shell-out below is a deliberate, minimal
;; duplicate of handoffd.bb's own (three lines, `git merge-base
;; --is-ancestor`) - the same precedent test_invariant2_qa_definition_lib.sh
;; already uses for testing supplier-shaped git logic without loading the
;; daemon file whole.
;;
;; Fixture: a bare "origin", a role worktree cloned from it, one commit on
;; origin's main, then one commit made ONLY on the role's own branch on top
;; of that - the role's branch is "origin/main plus one commit of its own",
;; exactly the scenario's Given. Every mkdtemp root this runner creates is
;; verified via `git rev-parse --git-common-dir` to resolve INSIDE that
;; same root before any mutating command runs (BL-1390) - this fixture
;; never touches the real checkout.
(ns bl1433-supplier-git-facts-runner
  (:require [babashka.fs :as fs]
            [babashka.process :as process]
            [clojure.string :as str]
            [cheshire.core :as json]))

(defn- sh! [dir & args]
  (apply process/shell {:dir dir :out :string :err :string :continue true} args))

(defn- git [dir & args]
  (apply sh! dir "git" args))

(defn- git-is-ancestor? [dir ancestor descendant]
  (zero? (:exit (sh! dir "git" "merge-base" "--is-ancestor" ancestor descendant))))

(defn- assert-fixture-root-is-own! [dir root]
  (let [common-dir (str/trim (:out (git dir "rev-parse" "--git-common-dir")))
        resolved (str (fs/canonicalize (fs/path dir common-dir)))]
    (when-not (str/starts-with? resolved (str (fs/canonicalize root)))
      (throw (ex-info "fixture git-common-dir resolves OUTSIDE the mkdtemp root - refusing to run a mutating command"
                       {:dir dir :resolved resolved :root root})))))

(def root (str (fs/create-temp-dir {:prefix "bl1433-supplier-"})))
(.addShutdownHook (Runtime/getRuntime)
                   (Thread. (fn [] (try (fs/delete-tree root) (catch Exception _ nil)))))

(def origin (str (fs/path root "origin.git")))
(def role-wt (str (fs/path root "role")))

(sh! root "git" "init" "--bare" "-q" (str origin))
(sh! root "git" "clone" "-q" (str origin) (str role-wt))
(assert-fixture-root-is-own! role-wt root)

(git role-wt "config" "user.email" "bl1433@test")
(git role-wt "config" "user.name" "BL-1433 fixture")
(spit (str (fs/path role-wt "seed.txt")) "seed\n")
(git role-wt "add" "seed.txt")
(git role-wt "commit" "-q" "-m" "origin main commit")
(git role-wt "push" "-q" "origin" "HEAD:main")
(def landed (str/trim (:out (git role-wt "rev-parse" "HEAD"))))

;; The role's own commit, on top of that landed commit - "origin/main plus
;; one commit of its own".
(spit (str (fs/path role-wt "role-work.txt")) "role work\n")
(git role-wt "add" "role-work.txt")
(git role-wt "commit" "-q" "-m" "role's own commit")
(def role-head (str/trim (:out (git role-wt "rev-parse" "HEAD"))))

(def facts
  {:can-ff? (and role-head landed (git-is-ancestor? role-wt role-head landed))
   :contains-landed? (and role-head landed (git-is-ancestor? role-wt landed role-head))})

(println (json/generate-string (assoc facts :head-sha role-head :landed-sha landed)))
