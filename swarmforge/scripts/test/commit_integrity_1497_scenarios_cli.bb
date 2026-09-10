#!/usr/bin/env bb
;; BL-1497 acceptance test seam (scenario 04): drives the REAL
;; commit_integrity_lib.bb's commit-with-integrity! against a REAL git
;; fixture, injecting ONLY :commit-fn! - mirrors the BL-856/BL-1475
;; acceptance seam precedent for this same library: inject the ONE thing
;; needed to observe a moment that would otherwise require real
;; concurrency, every other seam (add/rev-parse/show/snapshot/restore, and
;; the real acquire-lock!/release-lock! pair) is the real implementation.
;;
;; The injected :commit-fn! runs strictly BETWEEN acquire-lock! and
;; release-lock! (commit-with-integrity!'s own finally), so reading the
;; lock directory's owner.json from inside it captures exactly what "while
;; the commit step is held" means - no thread, no sleep, no race.
;;
;; Usage: commit_integrity_1497_scenarios_cli.bb <project-root>
;;          --message <msg> --path <path> --snapshot-path <path>
;;
;; Writes the mid-commit snapshot (the lock directory's owner.json content,
;; plus this process's own pid for the step handler to compare against) as
;; one JSON object to --snapshot-path, then prints the raw
;; commit-with-integrity! result as its own JSON line.

(ns commit-integrity-1497-scenarios-cli
  (:require [babashka.fs :as fs]
            [cheshire.core :as json]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "commit_integrity_lib.bb")))

(def project-root (first *command-line-args*))

(defn parse-args [args]
  (loop [args args opts {}]
    (if (empty? args)
      opts
      (let [flag (first args)]
        (case flag
          "--message" (recur (drop 2 args) (assoc opts :message (second args)))
          "--path" (recur (drop 2 args) (assoc opts :path (second args)))
          "--snapshot-path" (recur (drop 2 args) (assoc opts :snapshot-path (second args)))
          (recur (drop 1 args) opts))))))

(def opts (parse-args (rest *command-line-args*)))

(defn snapshotting-commit-fn! [snapshot-path]
  (fn [pr message paths]
    (let [git-dir (commit-integrity-lib/absolute-git-dir pr)
          lock-dir (str (fs/path git-dir "swarmforge-commit-integrity.lock"))
          owner-record (try
                         (json/parse-string
                          (slurp (str (fs/path lock-dir "owner.json"))) true)
                         (catch Exception _ nil))]
      (spit snapshot-path
            (json/generate-string
             {:self-pid (.pid (java.lang.ProcessHandle/current))
              :lock-dir-exists (fs/exists? lock-dir)
              :owner-record owner-record})))
    (commit-integrity-lib/default-commit! pr message paths)))

(def result
  (commit-integrity-lib/commit-with-integrity!
   {:project-root project-root
    :paths [(:path opts)]
    :message (:message opts)
    :commit-fn! (snapshotting-commit-fn! (:snapshot-path opts))}))

(println (json/generate-string result))

(when-not (:success result)
  (System/exit 1))
