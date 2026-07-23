#!/usr/bin/env bb
;; BL-283: acceptance runner for support_lib.bb's check-linked-ticket-status!,
;; driven against the REAL support_thread_store.bb (a real fixture
;; .swarmforge/support/threads/ directory) and the REAL ticket_status_lib.bb
;; (a real fixture backlog/ directory) - mirrors
;; idle_nudge_acceptance_runner.bb's own "prove the pure/adapter-injected
;; decision against real persisted state" pattern. The reply-outbox write
;; mirrors operator_runtime.bb's own append-to-reply-outbox! exactly.
;;
;; Usage: linked_ticket_status_acceptance_runner.bb <target-path> <thread-id> <linked-ticket-id>

(ns linked-ticket-status-acceptance-runner
  (:require [babashka.fs :as fs]
            [cheshire.core :as json]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "support_lib.bb")))
(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "support_thread_store.bb")))
(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "ticket_status_lib.bb")))

(def target-path (nth *command-line-args* 0))
(def thread-id (nth *command-line-args* 1))
(def linked-ticket-id (nth *command-line-args* 2))
(def state-dir (fs/path target-path ".swarmforge"))
(def reply-outbox-file (fs/path state-dir "operator" "telegram-reply-outbox.jsonl"))

;; A fixed instant, never the real clock (de0991e) - this runner's own
;; now-iso! adapter, injected exactly like operator_runtime.bb's real one.
(defn now-iso [] "2026-07-11T12:00:00Z")

(defn append-to-outbox! [tid text]
  (fs/create-dirs (fs/parent reply-outbox-file))
  (spit (str reply-outbox-file) (str (json/generate-string {"threadId" tid "text" text}) "\n") :append true))

(def adapters (support-thread-store/adapters-for state-dir))
(def thread ((:read-thread! adapters) thread-id))
(def linked (first (filter #(= (:id %) linked-ticket-id) (:linked-tickets thread))))
(def current (ticket-status-lib/current-status target-path linked-ticket-id))

(def result
  (support-lib/check-linked-ticket-status!
   thread linked
   {:current-status! (fn [_id] current)
    :now-iso! now-iso
    :post-notice! append-to-outbox!
    :write-thread! (:write-thread! adapters)}))

(println (json/generate-string result))
