#!/usr/bin/env bb
;; BL-276: acceptance runner for support_lib.bb's idle-nudge-decision,
;; driven against the REAL support_thread_store.bb fs adapters (a real
;; fixture .swarmforge/support/threads/ directory) - proves the pure
;; decision against a thread as actually persisted on disk, not just an
;; in-memory fixture (support_lib_test_runner.bb already covers that with
;; exhaustively injected clocks).
;;
;; Usage: idle_nudge_acceptance_runner.bb <target-path> <thread-id> <now-ms>

(ns idle-nudge-acceptance-runner
  (:require [babashka.fs :as fs]
            [cheshire.core :as json]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "support_lib.bb")))
(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "support_thread_store.bb")))

(def target-path (nth *command-line-args* 0))
(def thread-id (nth *command-line-args* 1))
(def now-ms (parse-long (nth *command-line-args* 2)))
(def state-dir (fs/path target-path ".swarmforge"))

(def thread (support-thread-store/read-thread! state-dir thread-id))

(println (json/generate-string {:decision (name (support-lib/idle-nudge-decision thread now-ms))}))
