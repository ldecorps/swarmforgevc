#!/usr/bin/env bb
;; BL-281: acceptance runner for telegram_topic_lib.bb's reply-context-for,
;; driven against the REAL support_thread_store.bb fs adapters (a real
;; fixture .swarmforge/support/threads/ directory) - proves telegram-
;; topic-04's independence guarantee end-to-end, not just against an
;; in-memory fake (telegram_topic_lib_test_runner.bb already covers that).
;;
;; Usage: telegram_reply_context_acceptance_runner.bb <target-path> <thread-id>

(ns telegram-reply-context-acceptance-runner
  (:require [babashka.fs :as fs]
            [cheshire.core :as json]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "telegram_topic_lib.bb")))
(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "support_thread_store.bb")))

(def target-path (nth *command-line-args* 0))
(def thread-id (nth *command-line-args* 1))
(def state-dir (fs/path target-path ".swarmforge"))

(println (json/generate-string (telegram-topic-lib/reply-context-for thread-id (support-thread-store/adapters-for state-dir))))
