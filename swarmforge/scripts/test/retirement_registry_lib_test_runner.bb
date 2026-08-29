#!/usr/bin/env bb
;; BL-1258: TDD runner for retirement_registry_lib.bb. Real git plumbing
;; against a throwaway scratch repo (there is no pure half to test in
;; isolation - the whole point is the git ref mechanism itself).
(ns retirement-registry-lib-test-runner
  (:require [babashka.fs :as fs]
            [babashka.process :as process]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "retirement_registry_lib.bb")))

(def failures (atom []))

(defn assert= [msg expected actual]
  (when (not= expected actual)
    (swap! failures conj (str "FAIL: " msg "\n  expected: " (pr-str expected) "\n  actual:   " (pr-str actual)))))

(defn assert-true [msg actual]
  (when-not actual
    (swap! failures conj (str "FAIL: " msg " (expected truthy, got " (pr-str actual) ")"))))

(defn- sh! [dir & args]
  (apply process/sh {:dir (str dir) :continue true} (map str args)))

(defn- mk-repo []
  (let [root (str (fs/create-temp-dir))]
    (sh! root "git" "init" "-q")
    (sh! root "git" "-c" "user.email=t@t" "-c" "user.name=t" "commit" "-q" "--allow-empty" "-m" "init")
    root))

;; ── read-registry: empty before any write ─────────────────────────────────

(let [root (mk-repo)]
  (assert= "read-registry: {} when the ref does not exist yet"
           {}
           (retirement-registry-lib/read-registry root)))

;; ── register-retirement! / read-registry round-trip ───────────────────────

(let [root (mk-repo)]
  (retirement-registry-lib/register-retirement! root "BL-1247" ["a.yaml" "b.feature"])
  (assert= "register-retirement! then read-registry round-trips the path set"
           {"BL-1247" #{"a.yaml" "b.feature"}}
           (retirement-registry-lib/read-registry root)))

;; ── a second ticket's registration does not clobber the first ────────────

(let [root (mk-repo)]
  (retirement-registry-lib/register-retirement! root "BL-1247" ["a.yaml"])
  (retirement-registry-lib/register-retirement! root "BL-9000" ["z.yaml"])
  (assert= "registering a second ticket keeps the first"
           {"BL-1247" #{"a.yaml"} "BL-9000" #{"z.yaml"}}
           (retirement-registry-lib/read-registry root)))

;; ── re-registering the SAME ticket REPLACES its path set, never unions ────

(let [root (mk-repo)]
  (retirement-registry-lib/register-retirement! root "BL-1247" ["a.yaml" "stale.yaml"])
  (retirement-registry-lib/register-retirement! root "BL-1247" ["a.yaml" "b.feature"])
  (assert= "re-registering a ticket replaces its path set, dropping stale paths"
           {"BL-1247" #{"a.yaml" "b.feature"}}
           (retirement-registry-lib/read-registry root)))

;; ── retired-path->ticket-id ────────────────────────────────────────────────

(assert= "retired-path->ticket-id: finds the owning ticket"
         "BL-1247"
         (retirement-registry-lib/retired-path->ticket-id {"BL-1247" #{"a.yaml"}} "a.yaml"))

(assert= "retired-path->ticket-id: nil for a path in no retirement"
         nil
         (retirement-registry-lib/retired-path->ticket-id {"BL-1247" #{"a.yaml"}} "unrelated.txt"))

;; ── the registry is visible from a SEPARATE worktree without merging ─────
;; The whole point of this lib (BL-1258): a record on `main` is invisible to
;; a branch that has not merged it. A linked worktree of the SAME repo,
;; checked out on a totally different, never-synced branch, must still read
;; the registry - it shares the object database and ref namespace directly.

(let [root (mk-repo)
      wt (str (fs/path (fs/parent (fs/path root)) (str (fs/file-name root) "-wt")))]
  (retirement-registry-lib/register-retirement! root "BL-1247" ["a.yaml"])
  (sh! root "git" "worktree" "add" "-q" "-b" "never-synced-branch" wt)
  (assert= "the registry is readable from a worktree on a never-synced branch, no merge required"
           {"BL-1247" #{"a.yaml"}}
           (retirement-registry-lib/read-registry wt)))

;; ── report ─────────────────────────────────────────────────────────────────

(if (seq @failures)
  (do
    (doseq [f @failures] (println f))
    (println (str (count @failures) " failure(s)"))
    (System/exit 1))
  (println "ALL PASS: retirement_registry_lib.bb"))
