#!/usr/bin/env bb
;; TDD runner for land_step_lib.bb (BL-1241) - the land step's own remedy
;; for an entangled tip: detect which sibling tickets' unlanded work is an
;; ancestor, and (when any is) build a tip-pure replay commit off
;; origin/main, never a bounce to the parcel's author.

(ns land-step-lib-test-runner
  (:require [babashka.fs :as fs]
            [babashka.process :as process]
            [clojure.string :as str]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "land_step_lib.bb")))

(def failures (atom []))
(defn assert= [msg expected actual]
  (when (not= expected actual)
    (swap! failures conj (str "FAIL: " msg "\n  expected: " (pr-str expected) "\n  actual:   " (pr-str actual)))))
(defn assert-true [msg actual] (assert= msg true actual))
(defn assert-includes [msg haystack needle]
  (when-not (str/includes? (str haystack) needle)
    (swap! failures conj (str "FAIL: " msg "\n  expected to include: " (pr-str needle) "\n  actual: " (pr-str haystack)))))

(defn- sh! [dir & args]
  (let [{:keys [exit out err]} (apply process/sh {:dir (str dir) :continue true} args)]
    {:exit exit :out (str/trim (or out "")) :err (str/trim (or err ""))}))

(defmacro with-fixture [[root-sym] & body]
  `(let [~root-sym (str (fs/create-temp-dir {:prefix "bl1241-fixture-"}))]
     (try
       (sh! ~root-sym "git" "init" "-q" "-b" "main" ".")
       (sh! ~root-sym "git" "config" "user.email" "t@t")
       (sh! ~root-sym "git" "config" "user.name" "t")
       (sh! ~root-sym "git" "config" "commit.gpgsign" "false")
       (sh! ~root-sym "git" "commit" "-q" "--allow-empty" "-m" "seed")
       ~@body
       (finally (fs/delete-tree ~root-sym)))))

(defn- commit! [root path content message]
  (fs/create-dirs (fs/parent (fs/path root path)))
  (spit (str (fs/path root path)) content)
  (sh! root "git" "add" "-A")
  (sh! root "git" "commit" "-q" "-m" message))

(defn- mark-origin-main-here! [root]
  (sh! root "git" "update-ref" "refs/remotes/origin/main" (:out (sh! root "git" "rev-parse" "HEAD"))))

;; ── entangled-siblings ───────────────────────────────────────────────────

(with-fixture [root]
  (mark-origin-main-here! root)
  (commit! root "backlog/active/BL-9002-x.yaml" "id: BL-9002\n" "BL-9002: sibling unlanded work")
  (commit! root "backlog/active/BL-9001-x.yaml" "id: BL-9001\n" "BL-9001: own work")
  (let [commit (:out (sh! root "git" "rev-parse" "HEAD"))
        result (land-step-lib/entangled-siblings root commit "BL-9001")]
    (assert= "entangled-siblings: finds the sibling ticket" #{"BL-9002"} (:entangled result))
    (assert= "entangled-siblings: no warning on a clean read" nil (:warning result))))

(with-fixture [root]
  (mark-origin-main-here! root)
  (commit! root "backlog/active/BL-9001-x.yaml" "id: BL-9001\n" "BL-9001: own work only")
  (let [commit (:out (sh! root "git" "rev-parse" "HEAD"))
        result (land-step-lib/entangled-siblings root commit "BL-9001")]
    (assert= "entangled-siblings: empty when only the task's own commit is in range" #{} (:entangled result))))

(with-fixture [root]
  (mark-origin-main-here! root)
  ;; A commit naming no ticket at all (e.g. a bare bookkeeping/merge commit
  ;; with no attributable subject) never counts as entanglement - positive
  ;; identification only, task_scope_gate_lib.bb's own posture.
  (commit! root "unrelated.txt" "x\n" "unattributed bookkeeping commit")
  (commit! root "backlog/active/BL-9001-x.yaml" "id: BL-9001\n" "BL-9001: own work")
  (let [commit (:out (sh! root "git" "rev-parse" "HEAD"))
        result (land-step-lib/entangled-siblings root commit "BL-9001")]
    (assert= "entangled-siblings: an unattributed commit is never counted as entanglement"
             #{} (:entangled result))))

;; ── own-paths ────────────────────────────────────────────────────────────

(with-fixture [root]
  (mark-origin-main-here! root)
  (commit! root "backlog/active/BL-9002-x.yaml" "id: BL-9002\n" "BL-9002: sibling")
  (commit! root "backlog/active/BL-9001-x.yaml" "id: BL-9001\n" "BL-9001: own work")
  (let [commit (:out (sh! root "git" "rev-parse" "HEAD"))
        paths (land-step-lib/own-paths root commit "BL-9001")]
    (assert= "own-paths: only the task's own path" ["backlog/active/BL-9001-x.yaml"] paths)))

;; ── land-plan ────────────────────────────────────────────────────────────

(with-fixture [root]
  (mark-origin-main-here! root)
  (commit! root "backlog/active/BL-9001-x.yaml" "id: BL-9001\n" "BL-9001: own work only")
  (let [commit (:out (sh! root "git" "rev-parse" "HEAD"))
        plan (land-step-lib/land-plan {:root root :commit commit :task-ticket-id "BL-9001"})]
    (assert= "land-plan: no entanglement -> :land" {:action :land} plan)))

(with-fixture [root]
  (mark-origin-main-here! root)
  (commit! root "backlog/active/BL-9002-x.yaml" "id: BL-9002\n" "BL-9002: sibling")
  (commit! root "backlog/active/BL-9001-x.yaml" "id: BL-9001\n" "BL-9001: own work")
  (let [commit (:out (sh! root "git" "rev-parse" "HEAD"))
        plan (land-step-lib/land-plan {:root root :commit commit :task-ticket-id "BL-9001"})]
    (assert= "land-plan: entanglement -> :replay" :replay (:action plan))
    (assert= "land-plan: names the sibling" #{"BL-9002"} (:entangled plan))
    (assert= "land-plan: own-paths is just the task's own file" ["backlog/active/BL-9001-x.yaml"] (:own-paths plan))))

(with-fixture [root]
  (let [plan (land-step-lib/land-plan {:root root :commit "deadbeef" :task-ticket-id nil})]
    (assert= "land-plan: no task ticket id -> :escalate" :escalate (:action plan))))

;; ── replay!: builds a real tip-pure commit, never touches the caller's
;;    own checkout ─────────────────────────────────────────────────────────

(with-fixture [root]
  (mark-origin-main-here! root)
  (commit! root "backlog/active/BL-9002-x.yaml" "id: BL-9002\n" "BL-9002: sibling unlanded work")
  (commit! root "backlog/active/BL-9001-x.yaml" "id: BL-9001\n" "BL-9001: own work")
  (let [commit (:out (sh! root "git" "rev-parse" "HEAD"))
        before-branch (:out (sh! root "git" "rev-parse" "--abbrev-ref" "HEAD"))
        before-status (:out (sh! root "git" "status" "--porcelain"))
        result (land-step-lib/replay! {:root root :commit commit :task-ticket-id "BL-9001"
                                        :own-paths ["backlog/active/BL-9001-x.yaml"]})]
    (assert-true "replay!: reports success" (:success result))
    (assert= "replay!: never moves the caller's own branch"
             before-branch (:out (sh! root "git" "rev-parse" "--abbrev-ref" "HEAD")))
    (assert= "replay!: never dirties the caller's own working tree"
             before-status (:out (sh! root "git" "status" "--porcelain")))
    (let [tip-paths (:out (sh! root "git" "diff-tree" "-r" "--no-commit-id" "--name-only" (:commit result)))]
      (assert= "replay!: the built commit contains ONLY the task's own path"
               "backlog/active/BL-9001-x.yaml" tip-paths))
    (let [parent (:out (sh! root "git" "rev-parse" (str (:commit result) "^")))
          origin-main (:out (sh! root "git" "rev-parse" "origin/main"))]
      (assert= "replay!: the built commit's parent is origin/main, not the entangled tip"
               origin-main parent))))

(with-fixture [root]
  (mark-origin-main-here! root)
  (commit! root "backlog/active/BL-9002-x.yaml" "id: BL-9002\n" "BL-9002: sibling unlanded work")
  (commit! root "backlog/active/BL-9001-x.yaml" "id: BL-9001\n" "BL-9001: own work")
  (let [commit (:out (sh! root "git" "rev-parse" "HEAD"))
        before-count (count (str/split-lines (:out (sh! root "git" "worktree" "list"))))
        _ (land-step-lib/replay! {:root root :commit commit :task-ticket-id "BL-9001"
                                   :own-paths ["backlog/active/BL-9001-x.yaml"]})
        after-count (count (str/split-lines (:out (sh! root "git" "worktree" "list"))))]
    (assert= "replay!: no extra worktree left registered after a successful replay"
             before-count after-count)))

;; ── entanglement-note ────────────────────────────────────────────────────

(let [msg (land-step-lib/entanglement-note "BL-9001-fixture" #{"BL-9002" "BL-9003"})]
  (assert-includes "entanglement-note: names the task" msg "BL-9001-fixture")
  (assert-includes "entanglement-note: names a sibling" msg "BL-9002")
  (assert-includes "entanglement-note: names the other sibling" msg "BL-9003"))

;; ── report ─────────────────────────────────────────────────────────────────

(if (seq @failures)
  (do
    (doseq [f @failures] (println f))
    (println (str (count @failures) " failure(s)"))
    (System/exit 1))
  (println "ALL PASS: land_step_lib.bb"))
