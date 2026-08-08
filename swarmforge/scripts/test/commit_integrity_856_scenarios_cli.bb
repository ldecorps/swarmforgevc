#!/usr/bin/env bb
;; BL-856 acceptance test seam: drives the REAL commit_integrity_lib.bb's
;; commit-with-integrity! against a REAL git fixture repo, injecting only
;; the ONE seam needed to deterministically reproduce a named failure
;; reason - every other seam (add/commit/rev-parse/show/snapshot/restore)
;; is the real git-backed implementation, so the restore behavior under
;; test is the REAL restore-index!, never a stand-in.
;;
;; Usage: commit_integrity_856_scenarios_cli.bb <project-root>
;;          --message <msg> --path <path> [--path <path> ...]
;;          --reason <commit-failure|verify-mismatch|staging-failure|lock-timeout|none>
;;          [--restore-fails]
;;
;; Prints one JSON line: the raw commit-with-integrity! result.

(ns commit-integrity-856-scenarios-cli
  (:require [babashka.fs :as fs]
            [cheshire.core :as json]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "commit_integrity_lib.bb")))

(def project-root (first *command-line-args*))

(defn parse-args [args]
  (loop [args args opts {:paths []}]
    (if (empty? args)
      opts
      (let [flag (first args)]
        (case flag
          "--message" (recur (drop 2 args) (assoc opts :message (second args)))
          "--path" (recur (drop 2 args) (update opts :paths conj (second args)))
          "--reason" (recur (drop 2 args) (assoc opts :reason (second args)))
          "--restore-fails" (recur (drop 1 args) (assoc opts :restore-fails true))
          (recur (drop 1 args) opts))))))

(def opts (parse-args (rest *command-line-args*)))

(def seams
  (merge
   (case (:reason opts)
     "commit-failure" {:commit-fn! (fn [& _] {:exit 1})}
     "verify-mismatch" {:max-retries 0 :show-fn (fn [& _] "definitely-not-what-was-staged")}
     "staging-failure" {:add-fn! (fn [& _] {:exit 1})}
     "lock-timeout" {:lock-fn! (fn [_] false)}
     "none" {}
     {})
   (when (:restore-fails opts)
     {:restore-index-fn! (fn [& _] false)})))

(def result
  (commit-integrity-lib/commit-with-integrity!
   (merge {:project-root project-root
           :paths (:paths opts)
           :message (:message opts)}
          seams)))

(println (json/generate-string result))

;; Mirrors the production CLI's own exit-code contract: never exit 0 on a
;; dropped edit, so a step handler can assert against the real subprocess
;; exit code the same way it would against production.
(when-not (:success result)
  (System/exit 1))
