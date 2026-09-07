#!/usr/bin/env bb
;; TDD runner for chase_sweep_lib.bb's BL-1479 parked-active-sweep
;; functions. parked-active-condition/parked-active-items are pure
;; assertions, no real I/O; read-park-candidates and park-ticket! get their
;; own fixture-based tests further down (real fs I/O against a mkdtemp dir,
;; park-ticket! against a REAL mkdtemp git repo of its own, BL-1390 - never
;; a live swarm/tmux/daemon) - mirrors dropped_parcel_test_runner.bb's own
;; pure/fixture split exactly.

(ns bl1479-parked-active-sweep-test-runner
  (:require [babashka.fs :as fs]
            [babashka.process :as process]
            [clojure.string :as str]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "chase_sweep_lib.bb")))

(def failures (atom []))

(defn assert= [msg expected actual]
  (when (not= expected actual)
    (swap! failures conj (str "FAIL: " msg "\n  expected: " (pr-str expected) "\n  actual:   " (pr-str actual)))))

(defn assert-nil [msg actual] (assert= msg nil actual))
(defn assert-includes [msg haystack needle]
  (when-not (str/includes? (str haystack) needle)
    (swap! failures conj (str "FAIL: " msg "\n  expected to include: " (pr-str needle) "\n  actual: " (pr-str haystack)))))

;; ── parked-active-condition (pure) ────────────────────────────────────────

(assert= "condition-01: status: blocked is the condition, whatever not_before says"
         "blocked"
         (chase-sweep-lib/parked-active-condition "blocked" "id: BL-1\nstatus: blocked\n" "2026-09-07"))

(assert-includes "condition-02: a future not_before is the condition when status is not blocked"
                  (chase-sweep-lib/parked-active-condition "todo" "id: BL-1\nnot_before: 2026-09-10\n" "2026-09-07")
                  "not_before: 2026-09-10")

(assert-nil "condition-03: not_before equal to today is workable (an EARLIEST date, not exclusive)"
            (chase-sweep-lib/parked-active-condition "todo" "id: BL-1\nnot_before: 2026-09-07\n" "2026-09-07"))

(assert-nil "condition-04: not_before in the past is workable"
            (chase-sweep-lib/parked-active-condition "todo" "id: BL-1\nnot_before: 2026-09-01\n" "2026-09-07"))

(assert-nil "condition-05: no status, no not_before - can advance"
            (chase-sweep-lib/parked-active-condition "todo" "id: BL-1\n" "2026-09-07"))

(assert-nil "condition-06: absent status field entirely - can advance"
            (chase-sweep-lib/parked-active-condition nil "id: BL-1\n" "2026-09-07"))

(assert-includes "condition-07: a malformed not_before is a condition too (the promotion gate would refuse it just the same)"
                  (chase-sweep-lib/parked-active-condition "todo" "id: BL-1\nnot_before: not-a-date\n" "2026-09-07")
                  "not_before: not-a-date")

;; ── parked-active-items (pure) ─────────────────────────────────────────────

(let [candidates [{:id "BL-1" :status "blocked" :content "id: BL-1\nstatus: blocked\n" :file "a.yaml"}
                  {:id "BL-2" :status "todo" :content "id: BL-2\nnot_before: 2026-09-10\n" :file "b.yaml"}
                  {:id "BL-3" :status "todo" :content "id: BL-3\n" :file "c.yaml"}]
      result (chase-sweep-lib/parked-active-items candidates #{} "2026-09-07")]
  (assert= "items-01: BL-1 (blocked, no live mail) is parked"
           [{:id "BL-1" :file "a.yaml" :condition "blocked"}]
           (filterv #(= "BL-1" (:id %)) (:to-park result)))
  (assert= "items-01: BL-2 (future not_before, no live mail) is ALSO parked"
           "BL-2" (:id (first (filter #(= "BL-2" (:id %)) (:to-park result)))))
  (assert= "items-01: both BL-1 and BL-2 are parked, nothing else"
           2 (count (:to-park result)))
  (assert= "items-01: BL-3 (can advance) is in neither set"
           false (boolean (some #(= "BL-3" (:id %)) (concat (:to-park result) (:refused result))))))

(let [candidates [{:id "BL-1" :status "blocked" :content "id: BL-1\nstatus: blocked\n" :file "a.yaml"}]
      result (chase-sweep-lib/parked-active-items candidates #{"BL-1"} "2026-09-07")]
  (assert= "items-02: a ticket with live mail is REFUSED, never parked, whatever its status"
           [] (:to-park result))
  (assert= "items-02: the refusal names the condition too"
           [{:id "BL-1" :condition "blocked"}] (:refused result)))

;; ── park-commit-message (pure) ─────────────────────────────────────────────

(assert= "commit message names id and condition, active -> paused"
         "Park BL-9001: active -> paused (status: blocked)"
         (chase-sweep-lib/park-commit-message "BL-9001" "status: blocked"))

;; ── read-park-candidates (fixture: real fs, no git) ────────────────────────

(defn- sh! [dir & args]
  (let [{:keys [exit out err]} (apply process/sh {:dir (str dir) :continue true} args)]
    {:exit exit :out (str/trim (or out "")) :err (str/trim (or err ""))}))

(defmacro with-tmp-dir [[root-sym] & body]
  `(let [~root-sym (str (fs/create-temp-dir {:prefix "bl1479-fixture-"}))]
     (try ~@body (finally (fs/delete-tree ~root-sym)))))

(with-tmp-dir [root]
  (let [active-dir (fs/path root "backlog" "active")]
    (fs/create-dirs active-dir)
    (spit (str (fs/path active-dir "BL-1-x.yaml")) "id: BL-1\nstatus: blocked\n")
    (spit (str (fs/path active-dir "BL-2-x.yaml")) "id: BL-2\nnot_before: 2026-09-10\n")
    (spit (str (fs/path active-dir "not-a-yaml.txt")) "ignore me")
    (let [candidates (chase-sweep-lib/read-park-candidates active-dir)]
      (assert= "read-park-candidates: only .yaml files, non-yaml ignored"
               2 (count candidates))
      (assert= "read-park-candidates: BL-1's status is read"
               "blocked" (:status (first (filter #(= "BL-1" (:id %)) candidates))))
      (assert-includes "read-park-candidates: the raw content is kept (for not-before-refusal to read)"
                        (:content (first (filter #(= "BL-2" (:id %)) candidates)))
                        "not_before: 2026-09-10"))))

(with-tmp-dir [root]
  (assert= "read-park-candidates: a missing active/ dir answers [] (fail-open on absence, same as read-active-items)"
           [] (chase-sweep-lib/read-park-candidates (fs/path root "backlog" "active"))))

;; ── park-ticket! (fixture: a REAL mkdtemp git repo, BL-1390) ──────────────

(defmacro with-git-fixture [[root-sym] & body]
  `(let [~root-sym (str (fs/create-temp-dir {:prefix "bl1479-git-"}))]
     (try
       (sh! ~root-sym "git" "init" "-q" "-b" "main" ".")
       (sh! ~root-sym "git" "config" "user.email" "t@t")
       (sh! ~root-sym "git" "config" "user.name" "t")
       (sh! ~root-sym "git" "config" "commit.gpgsign" "false")
       (fs/create-dirs (fs/path ~root-sym "backlog" "active"))
       (fs/create-dirs (fs/path ~root-sym "backlog" "paused"))
       ~@body
       (finally (fs/delete-tree ~root-sym)))))

(with-git-fixture [root]
  (let [content "id: BL-9001\ntitle: \"t\"\nstatus: blocked\npriority: 5\nassigned_to: coder\n"
        active-file (fs/path root "backlog" "active" "BL-9001-x.yaml")]
    (spit (str active-file) content)
    (sh! root "git" "add" "-A")
    (sh! root "git" "commit" "-q" "-m" "seed")
    (let [result (chase-sweep-lib/park-ticket! root {:id "BL-9001" :file active-file :condition "status: blocked"})]
      (assert= "park-ticket!: succeeds against a real git checkout" true (:success result))
      (assert= "park-ticket!: the file is gone from active/"
               false (fs/exists? active-file))
      (assert= "park-ticket!: the file exists, byte-identical, in paused/"
               content (slurp (str (fs/path root "backlog" "paused" "BL-9001-x.yaml"))))
      (assert-includes "park-ticket!: the commit subject names the ticket and the condition"
                        (:out (sh! root "git" "log" "-1" "--format=%s"))
                        "Park BL-9001: active -> paused (status: blocked)"))))

(with-tmp-dir [root]
  ;; Not a git repo at all - BL-1390's own fail-closed guard, verified
  ;; before any mutating command ever runs.
  (fs/create-dirs (fs/path root "backlog" "active"))
  (let [active-file (fs/path root "backlog" "active" "BL-1-x.yaml")]
    (spit (str active-file) "id: BL-1\nstatus: blocked\n")
    (let [result (chase-sweep-lib/park-ticket! root {:id "BL-1" :file active-file :condition "status: blocked"})]
      (assert= "park-ticket!: refuses against a non-git root rather than mutating anything"
               false (:success result))
      (assert= "park-ticket!: nothing moved - the file is still exactly where it was"
               true (fs/exists? active-file)))))

;; ── park-ticket!/D1 (architect bounce, BL-1479-bounce-20260907.md): a
;; commit refusal AFTER a successful git mv rolls back COMPLETELY ─────────
;; The original rollback (`git checkout -- old new`) reads from the INDEX,
;; not HEAD - after `git mv`, the old path has no index entry at all, so
;; the command errors on it and never even reaches the new path's staged
;; add, leaving the rename staged in the shared index indefinitely. Forced
;; here via a REAL lock-timeout (the lock directory
;; commit_integrity_lib.bb's own acquire-lock! uses is pre-occupied before
;; park-ticket! runs) - the exact "a concurrent writer is live" trigger the
;; function's own docstring names, never a stubbed CLI. Asserts the
;; checkout reads completely clean afterward (`git status --short` empty),
;; not merely that the function returned {:success false}.
(with-git-fixture [root]
  (let [content "id: BL-9002\ntitle: \"t\"\nstatus: blocked\npriority: 5\n"
        active-file (fs/path root "backlog" "active" "BL-9002-x.yaml")]
    (spit (str active-file) content)
    (sh! root "git" "add" "-A")
    (sh! root "git" "commit" "-q" "-m" "seed")
    (let [lock-dir (fs/path root ".git" "swarmforge-commit-integrity.lock")]
      (fs/create-dirs lock-dir)
      (let [result (try
                     (chase-sweep-lib/park-ticket! root {:id "BL-9002" :file active-file :condition "status: blocked"})
                     (finally (fs/delete lock-dir)))]
        (assert= "park-ticket!/D1: a commit refusal (lock-timeout) is reported as a failure"
                 false (:success result))
        (assert-includes "park-ticket!/D1: names the refusal"
                          (:reason result) "commit_integrity_cli.bb refused")
        (assert= "park-ticket!/D1: the checkout is CLEAN afterward - git status --short reads empty"
                 "" (:out (sh! root "git" "status" "--short")))
        (assert= "park-ticket!/D1: the file is back in active/, byte-identical"
                 content (slurp (str active-file)))
        (assert= "park-ticket!/D1: nothing left in paused/"
                 false (fs/exists? (fs/path root "backlog" "paused" "BL-9002-x.yaml")))))))

;; ── report ──────────────────────────────────────────────────────────────

(if (empty? @failures)
  (println "ALL PASS: chase_sweep_lib.bb (BL-1479 parked-active-sweep)")
  (do (doseq [f @failures] (println f))
      (println (str (count @failures) " failure(s)"))
      (System/exit 1)))
