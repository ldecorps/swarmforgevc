#!/usr/bin/env bb
;; BL-1438: PROPERTY tests over the repoint verb (land_step_cli.bb) and its
;; wiring into land_main_publish.sh, covering the three invariants the
;; ticket YAML declares (coder-authored first, per BL-654). Seeded (not
;; wall-clock) randomness so failures reproduce: a fixed-seed
;; java.util.Random, never rand/rand-int's unseeded global generator.
;; Follows the established .bb property-runner precedent
;; (bl942_hardening_debt_ledger_property_runner.bb).
;;
;; Non-vacuity, checked by hand before landing (see
;; backlog/evidence/BL-1438-coder-pass-20260906.md for the exact breaks and
;; the failures each produced).
;;
;;   P1 (invariants 2 + 3): every generated worktree state's OWN expected
;;      outcome is decided by this runner's construction, not by calling
;;      post-land-repoint! as an oracle (the tautology BL-654 property
;;      tests must avoid) - a case that wrote a dirty file expects
;;      "an uncommitted change" LITERALLY, a case that wrote an in_process
;;      marker expects "a parcel in its in_process" LITERALLY, matching
;;      land_step_lib.bb's own string constants exactly. Drives the REAL
;;      `land_step_cli.bb repoint` subprocess - never a parallel
;;      reimplementation of its decision or output format.
;;   P2 (invariant 1): a handful of end-to-end land_main_publish.sh runs -
;;      a clean land (repoint appears exactly once, strictly after
;;      LAND_PUBLISHED) and an escalated land (a task name naming no
;;      ticket id - land_step_lib.bb's own simplest real escalation path -
;;      where NEITHER repoint line, nor LAND_PUBLISHED itself, ever
;;      appears), over several randomized ticket ids and file contents.

(ns bl1438-publish-repoints-qa-branch-property-runner
  (:require [babashka.fs :as fs]
            [babashka.process :as process]
            [clojure.string :as str]))

(def failures (atom []))
(defn assert-true [msg expr]
  (when-not expr (swap! failures conj (str "FAIL: " msg))))
(defn assert= [msg expected actual]
  (when (not= expected actual)
    (swap! failures conj (str "FAIL: " msg "\n  expected: " (pr-str expected) "\n  actual:   " (pr-str actual)))))

(def SCRIPT-DIR (str (fs/parent (fs/canonicalize *file*))))
(def SCRIPTS-DIR (str (fs/path SCRIPT-DIR "..")))
(def REPOINT-CLI (str (fs/path SCRIPTS-DIR "land_step_cli.bb")))
(def PUBLISH-SH (str (fs/path SCRIPTS-DIR "land_main_publish.sh")))

(def ^:private rng (java.util.Random. 1438))
(defn- rint [bound] (.nextInt rng (int bound)))
(defn- rchoice [coll] (nth coll (rint (count coll))))
(defn- rword [] (rchoice ["alpha" "bravo" "charlie" "delta" "echo" "foxtrot" "golf"]))

(defn- git! [root & args]
  (apply process/sh (into ["git" "-C" (str root)] args)))

;; A repo whose origin is a bare repo under the SAME temp root, .gitignore
;; carrying .swarmforge/ (the real repo's own top-level rule - without it a
;; fixture's own lock/log writes under .swarmforge/ would falsely trip the
;; dirty-tree guard, per the incident recorded in the coder evidence).
;; with-origin? false omits the remote entirely, simulating an
;; unresolvable origin/main.
(defn- mk-repo [{:keys [with-origin?] :or {with-origin? true}}]
  (let [root (str (fs/create-temp-dir {:prefix "bl1438-prop-"}))
        origin (str root "-origin.git")]
    (when with-origin?
      (process/sh ["git" "init" "-q" "--bare" origin])
      (process/sh ["git" "-C" origin "symbolic-ref" "HEAD" "refs/heads/main"]))
    (fs/create-dirs (fs/path root ".swarmforge"))
    (process/sh ["git" "init" "-q" "-b" "main" root])
    (git! root "config" "user.email" "t@t")
    (git! root "config" "user.name" "t")
    (spit (str (fs/path root ".gitignore")) ".swarmforge/\n")
    (spit (str (fs/path root "seed.txt")) (str "seed " (rword) "\n"))
    (git! root "add" "-A")
    (git! root "commit" "-q" "-m" "seed")
    (when with-origin?
      (git! root "remote" "add" "origin" origin)
      (git! root "push" "-q" "-u" "origin" "main"))
    {:root root :origin origin :with-origin? with-origin?}))

(defn- cleanup! [{:keys [root origin]}]
  (fs/delete-tree root)
  (when (fs/exists? origin) (fs/delete-tree origin)))

(defn- run-repoint-cli [root]
  (let [res (process/sh ["bb" REPOINT-CLI "repoint" (str root)])]
    {:exit (:exit res) :out (str (:out res) (:err res))}))

;; ── P1: invariants 2 + 3 - every generated worktree state's own expected
;;    outcome, decided by construction ─────────────────────────────────────
(def P1-RUNS 24)
(dotimes [n P1-RUNS]
  (let [kind (rchoice [:clean :dirty :in-process :no-origin])
        repo (mk-repo {:with-origin? (not= kind :no-origin)})
        root (:root repo)]
    (try
      (case kind
        :clean nil

        :dirty
        (spit (str (fs/path root (str "dirty-" (rword) ".txt"))) "uncommitted\n")

        :in-process
        (let [dir (fs/path root ".swarmforge" "handoffs" "inbox" "in_process")]
          (fs/create-dirs dir)
          (spit (str (fs/path dir (str "00_" (rword) ".handoff"))) "type: git_handoff\n"))

        :no-origin nil)

      (let [head-before (str/trim (:out (git! root "rev-parse" "HEAD")))
            {:keys [exit out]} (run-repoint-cli root)
            head-after (str/trim (:out (git! root "rev-parse" "HEAD")))]
        (assert-true (str "P1 case " n " (" kind "): the CLI exits 0") (zero? exit))
        (case kind
          :clean
          (let [origin-main (str/trim (:out (git! (:origin repo) "rev-parse" "main")))]
            (assert-true (str "P1 case " n " (clean): prints LAND_REPOINTED with the exact old and new tips")
                          (str/includes? out (str "LAND_REPOINTED " head-before " " origin-main)))
            (assert= (str "P1 case " n " (clean): the branch actually moved to origin/main") origin-main head-after))

          :dirty
          (do
            (assert-true (str "P1 case " n " (dirty): prints LAND_REPOINT_SKIPPED naming exactly \"an uncommitted change\"")
                          (str/includes? out "LAND_REPOINT_SKIPPED an uncommitted change"))
            (assert= (str "P1 case " n " (dirty): the branch did not move") head-before head-after))

          :in-process
          (do
            (assert-true (str "P1 case " n " (in-process): prints LAND_REPOINT_SKIPPED naming exactly \"a parcel in its in_process\"")
                          (str/includes? out "LAND_REPOINT_SKIPPED a parcel in its in_process"))
            (assert= (str "P1 case " n " (in-process): the branch did not move") head-before head-after))

          :no-origin
          (do
            (assert-true (str "P1 case " n " (no-origin): prints LAND_REPOINT_SKIPPED naming exactly the unresolvable-origin reason")
                          (str/includes? out "LAND_REPOINT_SKIPPED land-step: origin/main could not be resolved"))
            (assert= (str "P1 case " n " (no-origin): the branch did not move") head-before head-after))))
      (finally
        (cleanup! repo)))))

;; ── P2: invariant 1 - the re-point runs only after LAND_PUBLISHED, at
;;    most once, never on an escalated land ─────────────────────────────
(def P2-RUNS 8)
(dotimes [n P2-RUNS]
  (let [repo (mk-repo {})
        root (:root repo)
        ticket (str "BL-" (+ 9000 (rint 999)))
        escalate? (even? n)]
    (try
      (fs/create-dirs (fs/path root "swarmforge"))
      (try (fs/delete-tree (fs/path root "swarmforge" "scripts")) (catch Exception _ nil))
      (fs/create-sym-link (fs/path root "swarmforge" "scripts") (fs/canonicalize SCRIPTS-DIR))
      (spit (str (fs/path root (str (rword) ".txt"))) (str "work " (rword) "\n"))
      (git! root "add" "-A")
      (git! root "commit" "-q" "-m" (str ticket ": the approved work"))
      (let [sha (str/trim (:out (git! root "rev-parse" "HEAD")))
            task-name (if escalate? "not-a-ticket-name" (str ticket "-fixture-task"))
            res (process/sh ["bash" PUBLISH-SH (str root) "--land" task-name sha]
                             {:dir (str root) :env (assoc (into {} (System/getenv)) "LAND_LOCK_WAIT_SECONDS" "20")})
            out (str (:out res) (:err res))
            lines (str/split-lines out)
            idx-of (fn [prefix] (first (keep-indexed (fn [i l] (when (str/starts-with? l prefix) i)) lines)))
            published-idx (idx-of "LAND_PUBLISHED")
            repointed-idx (idx-of "LAND_REPOINTED")
            skipped-idx (idx-of "LAND_REPOINT_SKIPPED")
            repoint-idx (or repointed-idx skipped-idx)
            repoint-line-count (count (filter #(or (str/starts-with? % "LAND_REPOINTED") (str/starts-with? % "LAND_REPOINT_SKIPPED")) lines))]
        (if escalate?
          (do
            (assert-true (str "P2 case " n " (escalate): no LAND_PUBLISHED at all") (nil? published-idx))
            (assert-true (str "P2 case " n " (escalate): no re-point line at all") (nil? repoint-idx))
            (assert= (str "P2 case " n " (escalate): zero re-point lines") 0 repoint-line-count))
          (do
            (assert-true (str "P2 case " n " (clean): LAND_PUBLISHED appears") (some? published-idx))
            (assert-true (str "P2 case " n " (clean): exactly one re-point line") (= 1 repoint-line-count))
            (assert-true (str "P2 case " n " (clean): the re-point line comes strictly after LAND_PUBLISHED")
                          (and (some? repoint-idx) (< published-idx repoint-idx))))))
      (finally
        (cleanup! repo)))))

;; ── Hardener addition: the BL-1390 "prove the root before any mutating
;;    git call" precondition had zero coverage anywhere in the parcel ────
;; land_step_cli.bb's repoint verb runs `git -C <root> rev-parse
;; --git-common-dir` and refuses (exit 2, naming the root) BEFORE ever
;; calling post-land-repoint! (which does `git reset --hard` on a repoint).
;; Neither the acceptance feature nor P1/P2 above ever pass a root that
;; fails this check - every fixture is always a real git repository.
;; Confirmed by hand-mutation: deleting the whole guard (repoint-verb calls
;; post-land-repoint! unconditionally on whatever string it is given) left
;; every existing test green, because post-land-repoint! itself happens to
;; fail its own `git status --porcelain` and `git rev-parse HEAD` calls on
;; a non-repository path and returns a value the verb still prints and
;; exits 0 for - a SILENT behavior change (a bad root that should refuse
;; loudly instead gets folded into an ordinary "skipped" outcome), not a
;; crash, which is exactly why no existing assertion caught it.
(let [not-a-repo (str (fs/path (System/getProperty "java.io.tmpdir") (str "bl1438-prop-notrepo-" (rint 1000000000) "-does-not-exist")))
      res (run-repoint-cli not-a-repo)]
  (assert= "hardener addition: a root that is not a git repository exits 2" 2 (:exit res))
  (assert-true "hardener addition: the refusal names the offending root"
                (str/includes? (:out res) not-a-repo))
  (assert-true "hardener addition: the refusal never prints a repoint verdict line"
                (not (or (str/includes? (:out res) "LAND_REPOINTED")
                         (str/includes? (:out res) "LAND_REPOINT_SKIPPED")))))

;; ── report ────────────────────────────────────────────────────────────────
(if (seq @failures)
  (do
    (doseq [f @failures] (binding [*out* *err*] (println f)))
    (println (str "\n" (count @failures) " failure(s)"))
    (System/exit 1))
  (println (str "ALL PASS: bl1438_publish_repoints_qa_branch_property_runner.bb (" (+ P1-RUNS P2-RUNS) " generated cases + 1 hardener addition)")))
